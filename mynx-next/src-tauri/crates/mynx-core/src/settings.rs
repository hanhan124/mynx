//! SQLite persistence for settings, task history and recently-used outputs.
//! Replaces the legacy browser/store persistence while keeping the exact
//! legacy config keys (`theme`, `alwaysOnTop`, `chartColor`,
//! `imageConverterOptions`, `chartStudioPresets`, …) so user files migrate
//! losslessly.

use mynx_contracts::settings::{ChartPreset, LegacySettings, SettingsDoc, ThemeId};
use mynx_contracts::task::{TaskKind, TaskStatus};
use mynx_contracts::WIRE_VERSION;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::sync::{Arc, Mutex};

pub struct SettingsStore {
    conn: Arc<Mutex<Connection>>,
}

/// Cheap shared handle for spawn_blocking closures.
pub type SharedSettingsStore = Arc<SettingsStore>;

const SETTINGS_TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_history (
    id              INTEGER PRIMARY KEY,
    kind            TEXT NOT NULL,
    label           TEXT NOT NULL,
    status          TEXT NOT NULL,
    created_at_ms   INTEGER NOT NULL,
    finished_at_ms  INTEGER,
    error           TEXT,
    output_dir      TEXT
);
CREATE TABLE IF NOT EXISTS recent_outputs (
    path         TEXT NOT NULL,
    kind         TEXT NOT NULL,
    last_used_ms INTEGER NOT NULL,
    PRIMARY KEY (path, kind)
);
"#;

impl SettingsStore {
    /// Open (creating if needed) the SQLite file at `path`.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;
        conn.execute_batch(SETTINGS_TABLE_SQL)?;
        Ok(Self { conn: Arc::new(Mutex::new(conn)) })
    }

    /// Clone an owned handle for use in blocking closures.
    pub fn clone_store_handle(&self) -> Arc<Self> {
        Arc::new(SettingsStore { conn: self.conn.clone() })
    }

    fn get_raw(&self, key: &str) -> Option<String> {
        self.conn
            .lock()
            .unwrap()
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten()
    }

    fn set_raw(&self, key: &str, value: &str) {
        let _ = self.conn.lock().unwrap().execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        );
    }

    fn get_bool(&self, key: &str, default: bool) -> bool {
        self.get_raw(key).and_then(|v| serde_json::from_str(&v).ok()).unwrap_or(default)
    }

    fn get_string(&self, key: &str, default: &str) -> String {
        self.get_raw(key)
            .and_then(|v| serde_json::from_str::<String>(&v).ok())
            .unwrap_or_else(|| default.to_string())
    }

    fn get_value(&self, key: &str) -> Option<serde_json::Value> {
        self.get_raw(key).and_then(|v| serde_json::from_str(&v).ok())
    }

    /// Normalize a legacy theme value the same way the old UI did
    /// (`dark`→`graphite`, `light`→`pearl`, unknown→`pearl`).
    fn normalize_theme(raw: Option<String>) -> ThemeId {
        match raw.as_deref() {
            Some("system") => ThemeId::System,
            Some("graphite") | Some("dark") => ThemeId::Graphite,
            Some("pearl") | Some("light") => ThemeId::Pearl,
            Some(other) if matches!(other, "System" | "Graphite" | "Pearl") => {
                match other {
                    "System" => ThemeId::System,
                    "Graphite" => ThemeId::Graphite,
                    _ => ThemeId::Pearl,
                }
            }
            _ => ThemeId::Pearl,
        }
    }

    /// Load the full settings document.
    pub fn load(&self) -> SettingsDoc {
        SettingsDoc {
            theme: Self::normalize_theme(
                self.get_raw("theme").and_then(|v| serde_json::from_str::<String>(&v).ok()),
            ),
            always_on_top: self.get_bool("alwaysOnTop", false),
            chart_color: self.get_string("chartColor", "#3C9FDF"),
            language: self.get_string("language", "zh"),
            search_engine: self.get_string("searchEngine", ""),
            home_header_height: self
                .get_raw("homeHeaderHeight")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(0),
            image_converter_options: self.get_value("imageConverterOptions"),
            chart_studio_presets: self
                .get_value("chartStudioPresets")
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default(),
        }
    }

    /// Persist the full settings document under the legacy key names.
    pub fn save(&self, doc: &SettingsDoc) {
        self.set_raw("theme", &serde_json::to_string(&doc.theme).unwrap());
        self.set_raw("alwaysOnTop", &serde_json::to_string(&doc.always_on_top).unwrap());
        self.set_raw("chartColor", &serde_json::to_string(&doc.chart_color).unwrap());
        self.set_raw("language", &serde_json::to_string(&doc.language).unwrap());
        self.set_raw("searchEngine", &serde_json::to_string(&doc.search_engine).unwrap());
        self.set_raw(
            "homeHeaderHeight",
            &serde_json::to_string(&doc.home_header_height).unwrap(),
        );
        if let Some(opts) = &doc.image_converter_options {
            self.set_raw("imageConverterOptions", &serde_json::to_string(opts).unwrap());
        }
        self.set_raw(
            "chartStudioPresets",
            &serde_json::to_string(&doc.chart_studio_presets).unwrap(),
        );
    }

    /// One-time migration: legacy store/localStorage values forwarded by the
    /// frontend. Only fills keys the user actually had; explicit stored
    /// values win, so this is idempotent.
    pub fn migrate_legacy(&self, legacy: &LegacySettings) {
        let mut doc = self.load();
        if let Some(theme) = &legacy.theme {
            doc.theme = Self::normalize_theme(Some(theme.clone()));
        }
        if let Some(top) = legacy.always_on_top {
            doc.always_on_top = top;
        }
        if let Some(color) = &legacy.chart_color {
            if is_valid_chart_color(color) {
                doc.chart_color = normalize_chart_color(color);
            }
        }
        if let Some(lang) = &legacy.language {
            doc.language = lang.clone();
        }
        if let Some(engine) = &legacy.search_engine {
            doc.search_engine = engine.clone();
        }
        if let Some(height) = legacy.home_header_height {
            doc.home_header_height = height;
        }
        if let Some(opts) = &legacy.image_converter_options {
            doc.image_converter_options = Some(opts.clone());
        }
        if let Some(presets) = &legacy.chart_studio_presets {
            if let Ok(list) = serde_json::from_value::<Vec<ChartPreset>>(presets.clone()) {
                doc.chart_studio_presets = list;
            }
        }
        self.save(&doc);
    }

    /// Append a terminal task record to history (recent runs on the home page).
    pub fn record_task(&self, record: &mynx_contracts::task::TaskRecord) {
        if !record.status.is_terminal() {
            return;
        }
        let _ = self.conn.lock().unwrap().execute(
            "INSERT OR REPLACE INTO task_history
             (id, kind, label, status, created_at_ms, finished_at_ms, error, output_dir)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                record.id as i64,
                serde_json::to_string(&record.kind).unwrap_or_default().trim_matches('"'),
                record.label,
                serde_json::to_string(&record.status).unwrap_or_default().trim_matches('"'),
                record.created_at_ms,
                record.finished_at_ms,
                record.error,
                record.output_dir,
            ],
        );
    }

    /// Recent task history, newest first.
    pub fn recent_tasks(&self, limit: u32) -> Vec<serde_json::Value> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT id, kind, label, status, created_at_ms, finished_at_ms, error, output_dir
             FROM task_history ORDER BY created_at_ms DESC LIMIT ?1",
        ) {
            Ok(stmt) => stmt,
            Err(_) => return Vec::new(),
        };
        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "kind": row.get::<_, String>(1)?,
                    "label": row.get::<_, String>(2)?,
                    "status": row.get::<_, String>(3)?,
                    "createdAtMs": row.get::<_, i64>(4)?,
                    "finishedAtMs": row.get::<_, Option<i64>>(5)?,
                    "error": row.get::<_, Option<String>>(6)?,
                    "outputDir": row.get::<_, Option<String>>(7)?,
                }))
            })
            .ok();
        match rows {
            Some(iter) => iter.filter_map(|r| r.ok()).collect(),
            None => Vec::new(),
        }
    }

    /// Failed tasks the home page should surface.
    pub fn recent_failures(&self, limit: u32) -> Vec<serde_json::Value> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT id, kind, label, status, created_at_ms, finished_at_ms, error, output_dir
             FROM task_history WHERE status = 'failed'
             ORDER BY created_at_ms DESC LIMIT ?1",
        ) {
            Ok(stmt) => stmt,
            Err(_) => return Vec::new(),
        };
        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "kind": row.get::<_, String>(1)?,
                    "label": row.get::<_, String>(2)?,
                    "status": row.get::<_, String>(3)?,
                    "createdAtMs": row.get::<_, i64>(4)?,
                    "finishedAtMs": row.get::<_, Option<i64>>(5)?,
                    "error": row.get::<_, Option<String>>(6)?,
                    "outputDir": row.get::<_, Option<String>>(7)?,
                }))
            })
            .ok();
        match rows {
            Some(iter) => iter.filter_map(|r| r.ok()).collect(),
            None => Vec::new(),
        }
    }

    /// Remember an output directory for the home page's recent-outputs list.
    pub fn touch_output(&self, path: &str, kind: TaskKind) {
        let now = now_ms();
        let kind_str =
            serde_json::to_string(&kind).unwrap_or_default().trim_matches('"').to_string();
        let _ = self.conn.lock().unwrap().execute(
            "INSERT INTO recent_outputs (path, kind, last_used_ms) VALUES (?1, ?2, ?3)
             ON CONFLICT(path, kind) DO UPDATE SET last_used_ms = excluded.last_used_ms",
            params![path, kind_str, now],
        );
    }

    /// Recently-used output directories, newest first.
    pub fn recent_outputs(&self, limit: u32) -> Vec<serde_json::Value> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT path, kind, last_used_ms FROM recent_outputs
             ORDER BY last_used_ms DESC LIMIT ?1",
        ) {
            Ok(stmt) => stmt,
            Err(_) => return Vec::new(),
        };
        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(serde_json::json!({
                    "path": row.get::<_, String>(0)?,
                    "kind": row.get::<_, String>(1)?,
                    "lastUsedMs": row.get::<_, i64>(2)?,
                }))
            })
            .ok();
        match rows {
            Some(iter) => iter.filter_map(|r| r.ok()).collect(),
            None => Vec::new(),
        }
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Legacy chart-color validation (`#RRGGBB[AA]`).
fn is_valid_chart_color(value: &str) -> bool {
    let trimmed = value.trim();
    let body = trimmed.strip_prefix('#').unwrap_or(trimmed);
    (body.len() == 6 || body.len() == 8)
        && body.chars().all(|c| c.is_ascii_hexdigit())
}

/// Normalize to `#RRGGBB[AA]`; invalid input falls back to the default.
fn normalize_chart_color(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.starts_with('#') {
        trimmed.to_string()
    } else {
        format!("#{trimmed}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> (tempdir::TempDir, SettingsStore) {
        let dir = tempdir::TempDir::new("mynx-settings-test").unwrap();
        let store = SettingsStore::open(dir.path().join("test.sqlite3")).unwrap();
        (dir, store)
    }

    #[test]
    fn defaults_round_trip() {
        let (_dir, store) = temp_store();
        let doc = store.load();
        assert_eq!(doc.theme, ThemeId::Pearl);
        assert!(!doc.always_on_top);
        assert_eq!(doc.chart_color, "#3C9FDF");
        assert_eq!(doc.language, "zh");

        let mut doc = store.load();
        doc.theme = ThemeId::Graphite;
        doc.always_on_top = true;
        doc.language = "en".into();
        store.save(&doc);

        let reloaded = store.load();
        assert_eq!(reloaded.theme, ThemeId::Graphite);
        assert!(reloaded.always_on_top);
        assert_eq!(reloaded.language, "en");
    }

    #[test]
    fn legacy_theme_values_normalize() {
        assert_eq!(SettingsStore::normalize_theme(Some("dark".into())), ThemeId::Graphite);
        assert_eq!(SettingsStore::normalize_theme(Some("light".into())), ThemeId::Pearl);
        assert_eq!(SettingsStore::normalize_theme(Some("system".into())), ThemeId::System);
        assert_eq!(SettingsStore::normalize_theme(Some("bogus".into())), ThemeId::Pearl);
    }

    #[test]
    fn migration_and_task_history() {
        let (_dir, store) = temp_store();
        store.migrate_legacy(&LegacySettings {
            v: WIRE_VERSION,
            theme: Some("dark".into()),
            always_on_top: Some(true),
            chart_color: Some("00FF00".into()),
            language: Some("en".into()),
            search_engine: Some("bing".into()),
            home_header_height: Some(180),
            image_converter_options: Some(serde_json::json!({"mode": "lossy"})),
            chart_studio_presets: Some(serde_json::json!([
                {"id": "p1", "name": "preset", "config": {}, "updatedAt": 1}
            ])),
        });
        let doc = store.load();
        assert_eq!(doc.theme, ThemeId::Graphite);
        assert!(doc.always_on_top);
        assert_eq!(doc.chart_color, "#00FF00");
        assert_eq!(doc.language, "en");
        assert_eq!(doc.home_header_height, 180);
        assert_eq!(doc.image_converter_options.unwrap()["mode"], "lossy");
        assert_eq!(doc.chart_studio_presets.len(), 1);

        store.record_task(&mynx_contracts::task::TaskRecord {
            v: WIRE_VERSION,
            id: 7,
            kind: TaskKind::RnaseqRun,
            label: "run".into(),
            status: TaskStatus::Failed,
            created_at_ms: 1,
            started_at_ms: None,
            finished_at_ms: Some(2),
            progress: None,
            detail: None,
            error: Some("boom".into()),
            output_dir: Some("/tmp/run".into()),
        });
        let failures = store.recent_failures(10);
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0]["error"], "boom");
        assert_eq!(failures[0]["kind"], "rnaseqRun");
    }

    // Minimal scoped temp-dir helper (no external test dependency).
    mod tempdir {
        use std::fs;
        use std::path::{Path, PathBuf};
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);

        pub struct TempDir(PathBuf);
        impl TempDir {
            pub fn new(prefix: &str) -> std::io::Result<Self> {
                let n = SEQ.fetch_add(1, Ordering::SeqCst);
                let dir = std::env::temp_dir().join(format!(
                    "{prefix}_{}_{}",
                    std::process::id(),
                    n
                ));
                fs::create_dir_all(&dir)?;
                Ok(TempDir(dir))
            }
            pub fn path(&self) -> &Path {
                &self.0
            }
        }
        impl Drop for TempDir {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
    }
}
