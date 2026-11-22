//! SQLite persistence for the AI chat (chat-next).
//!
//! The chat domain model (conversation trees, assistants, providers) is owned
//! by the frontend (`src/features/chat-next/core/types.ts`): no Rust service
//! computes on it. This store therefore keeps each record as an opaque JSON
//! document, indexed only by the columns it needs (ids, parent links,
//! timestamps) — the same approach the settings store uses for opaque tool
//! blobs such as `imageConverterOptions`. API keys never come through here;
//! they live in the OS keychain (see `secrets`).

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

const CHAT_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS chat_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_conversations (
    id          TEXT PRIMARY KEY,
    updated_at  INTEGER NOT NULL,
    doc         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_nodes (
    conversation_id TEXT NOT NULL,
    id              TEXT NOT NULL,
    parent_id       TEXT,
    created_at      INTEGER NOT NULL,
    doc             TEXT NOT NULL,
    PRIMARY KEY (conversation_id, id)
);
CREATE INDEX IF NOT EXISTS chat_nodes_by_conversation ON chat_nodes (conversation_id, created_at);
"#;

/// Schema version recorded in `chat_meta` for future migrations.
pub const CHAT_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, thiserror::Error)]
pub enum ChatStoreError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid chat document: {0}")]
    Invalid(String),
}

/// Everything the chat page needs on startup.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDump {
    /// Newest first.
    pub conversations: Vec<Value>,
    /// Conversation id → nodes, oldest first.
    pub nodes: BTreeMap<String, Vec<Value>>,
    /// Folders, assistants, providers (secret-free), settings, ...
    pub meta: BTreeMap<String, Value>,
}

#[derive(Clone)]
pub struct ChatStore {
    conn: Arc<Mutex<Connection>>,
}

fn str_field<'a>(doc: &'a Value, key: &str) -> Option<&'a str> {
    doc.get(key).and_then(Value::as_str).filter(|s| !s.is_empty())
}

fn time_field(doc: &Value, key: &str) -> i64 {
    doc.get(key).and_then(Value::as_i64).unwrap_or(0)
}

impl ChatStore {
    fn init(conn: Connection) -> Result<Self, ChatStoreError> {
        conn.execute_batch(CHAT_SCHEMA_SQL)?;
        conn.execute(
            "INSERT INTO chat_meta (key, value) VALUES ('schemaVersion', ?1)
             ON CONFLICT(key) DO NOTHING",
            params![CHAT_SCHEMA_VERSION.to_string()],
        )?;
        Ok(Self { conn: Arc::new(Mutex::new(conn)) })
    }

    /// Open (creating if needed) the chat database at `path`.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, ChatStoreError> {
        Self::init(Connection::open(path)?)
    }

    /// In-memory database (tests).
    pub fn open_in_memory() -> Result<Self, ChatStoreError> {
        Self::init(Connection::open_in_memory()?)
    }

    /// True until the first conversation or meta document is written.
    pub fn is_empty(&self) -> Result<bool, ChatStoreError> {
        let conn = self.conn.lock().unwrap();
        let conversations: i64 = conn.query_row("SELECT COUNT(*) FROM chat_conversations", [], |r| r.get(0))?;
        let meta: i64 = conn.query_row(
            "SELECT COUNT(*) FROM chat_meta WHERE key <> 'schemaVersion'",
            [],
            |r| r.get(0),
        )?;
        Ok(conversations == 0 && meta == 0)
    }

    pub fn load_all(&self) -> Result<ChatDump, ChatStoreError> {
        let conn = self.conn.lock().unwrap();
        let mut dump = ChatDump::default();

        let mut stmt = conn.prepare("SELECT doc FROM chat_conversations ORDER BY updated_at DESC, id")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        for row in rows {
            // A corrupt row must not hide the rest of the history.
            if let Ok(doc) = serde_json::from_str::<Value>(&row?) {
                dump.conversations.push(doc);
            }
        }

        let mut stmt =
            conn.prepare("SELECT conversation_id, doc FROM chat_nodes ORDER BY conversation_id, created_at, id")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        for row in rows {
            let (conversation_id, raw) = row?;
            if let Ok(doc) = serde_json::from_str::<Value>(&raw) {
                dump.nodes.entry(conversation_id).or_default().push(doc);
            }
        }

        let mut stmt = conn.prepare("SELECT key, value FROM chat_meta WHERE key <> 'schemaVersion' ORDER BY key")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        for row in rows {
            let (key, raw) = row?;
            if let Ok(doc) = serde_json::from_str::<Value>(&raw) {
                dump.meta.insert(key, doc);
            }
        }
        Ok(dump)
    }

    /// Upsert a conversation and REPLACE its node set (handles deletions and
    /// branch edits in one transaction).
    pub fn put_conversation(&self, conversation: &Value, nodes: &[Value]) -> Result<(), ChatStoreError> {
        let id = str_field(conversation, "id")
            .ok_or_else(|| ChatStoreError::Invalid("conversation without id".into()))?
            .to_string();
        let mut rows = Vec::with_capacity(nodes.len());
        for node in nodes {
            let node_id = str_field(node, "id")
                .ok_or_else(|| ChatStoreError::Invalid("node without id".into()))?;
            if str_field(node, "conversationId") != Some(id.as_str()) {
                return Err(ChatStoreError::Invalid(format!("node {node_id} belongs to another conversation")));
            }
            rows.push((
                node_id.to_string(),
                str_field(node, "parentId").map(str::to_string),
                time_field(node, "createdAt"),
                serde_json::to_string(node)?,
            ));
        }
        let doc = serde_json::to_string(conversation)?;

        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO chat_conversations (id, updated_at, doc) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, doc = excluded.doc",
            params![id, time_field(conversation, "updatedAt"), doc],
        )?;
        tx.execute("DELETE FROM chat_nodes WHERE conversation_id = ?1", params![id])?;
        {
            let mut insert = tx.prepare(
                "INSERT INTO chat_nodes (conversation_id, id, parent_id, created_at, doc) VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            for (node_id, parent_id, created_at, doc) in &rows {
                insert.execute(params![id, node_id, parent_id, created_at, doc])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Returns whether a conversation was removed.
    pub fn delete_conversation(&self, id: &str) -> Result<bool, ChatStoreError> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM chat_nodes WHERE conversation_id = ?1", params![id])?;
        let removed = tx.execute("DELETE FROM chat_conversations WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(removed > 0)
    }

    pub fn put_meta(&self, key: &str, value: &Value) -> Result<(), ChatStoreError> {
        if key.is_empty() || key == "schemaVersion" {
            return Err(ChatStoreError::Invalid(format!("reserved meta key {key:?}")));
        }
        let raw = serde_json::to_string(value)?;
        self.conn.lock().unwrap().execute(
            "INSERT INTO chat_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, raw],
        )?;
        Ok(())
    }

    pub fn get_meta(&self, key: &str) -> Result<Option<Value>, ChatStoreError> {
        let raw: Option<String> = self
            .conn
            .lock()
            .unwrap()
            .query_row("SELECT value FROM chat_meta WHERE key = ?1", params![key], |row| row.get(0))
            .optional()?;
        Ok(match raw {
            Some(raw) => Some(serde_json::from_str(&raw)?),
            None => None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn node(id: &str, parent: Option<&str>, at: i64) -> Value {
        json!({ "id": id, "conversationId": "c1", "parentId": parent, "createdAt": at, "role": "user", "content": id })
    }

    #[test]
    fn starts_empty_and_round_trips() {
        let store = ChatStore::open_in_memory().unwrap();
        assert!(store.is_empty().unwrap());
        let conversation = json!({ "id": "c1", "title": "T", "updatedAt": 5, "activeLeafId": "b" });
        store
            .put_conversation(&conversation, &[node("b", Some("a"), 2), node("a", None, 1)])
            .unwrap();
        store.put_meta("providers", &json!([{ "id": "p1" }])).unwrap();
        assert!(!store.is_empty().unwrap());

        let dump = store.load_all().unwrap();
        assert_eq!(dump.conversations, vec![conversation]);
        let ids: Vec<&str> = dump.nodes["c1"].iter().map(|n| n["id"].as_str().unwrap()).collect();
        assert_eq!(ids, vec!["a", "b"]);
        assert_eq!(dump.meta["providers"], json!([{ "id": "p1" }]));
        assert!(!dump.meta.contains_key("schemaVersion"));
    }

    #[test]
    fn replaces_nodes_and_orders_conversations_newest_first() {
        let store = ChatStore::open_in_memory().unwrap();
        store.put_conversation(&json!({ "id": "c1", "updatedAt": 1 }), &[node("a", None, 1), node("b", Some("a"), 2)]).unwrap();
        store.put_conversation(&json!({ "id": "c1", "updatedAt": 9 }), &[node("a", None, 1)]).unwrap();
        store.put_conversation(&json!({ "id": "c2", "updatedAt": 3 }), &[]).unwrap();
        let dump = store.load_all().unwrap();
        assert_eq!(dump.nodes["c1"].len(), 1);
        let order: Vec<&str> = dump.conversations.iter().map(|c| c["id"].as_str().unwrap()).collect();
        assert_eq!(order, vec!["c1", "c2"]);
    }

    #[test]
    fn rejects_foreign_nodes_and_missing_ids() {
        let store = ChatStore::open_in_memory().unwrap();
        let foreign = json!({ "id": "x", "conversationId": "other", "createdAt": 1 });
        assert!(store.put_conversation(&json!({ "id": "c1" }), &[foreign]).is_err());
        assert!(store.put_conversation(&json!({ "title": "no id" }), &[]).is_err());
        assert!(store.put_meta("schemaVersion", &json!(2)).is_err());
        // A rejected write leaves nothing behind.
        assert!(store.is_empty().unwrap());
    }

    #[test]
    fn deletes_conversations_with_their_nodes() {
        let store = ChatStore::open_in_memory().unwrap();
        store.put_conversation(&json!({ "id": "c1", "updatedAt": 1 }), &[node("a", None, 1)]).unwrap();
        assert!(store.delete_conversation("c1").unwrap());
        assert!(!store.delete_conversation("c1").unwrap());
        let dump = store.load_all().unwrap();
        assert!(dump.conversations.is_empty() && dump.nodes.is_empty());
    }

    #[test]
    fn reads_single_meta_values() {
        let store = ChatStore::open_in_memory().unwrap();
        assert_eq!(store.get_meta("settings").unwrap(), None);
        store.put_meta("settings", &json!({ "params": {} })).unwrap();
        assert_eq!(store.get_meta("settings").unwrap(), Some(json!({ "params": {} })));
    }
}
