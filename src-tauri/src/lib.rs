//! Mynx (next) application shell: plugin registration, native menu, window
//! event handling and the task-center event bridge.

mod commands;
mod error;
mod state;

use state::AppState;
use std::sync::Arc;
use tauri::{
    menu::{AboutMetadata, MenuBuilder, SubmenuBuilder},
    DragDropEvent, Emitter, Manager, RunEvent, WebviewEvent, WindowEvent,
};
use tauri_plugin_fs::FsExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::app::cleanup_update_bak,
            commands::app::open_path,
            commands::app::resource_r_path,
            commands::app::is_always_on_top,
            commands::settings::settings_load,
            commands::settings::settings_save,
            commands::settings::settings_migrate_legacy,
            commands::settings::tasks_list,
            commands::settings::tasks_cancel,
            commands::settings::home_data,
            commands::settings::projects_touch,
            commands::settings::projects_remove,
            commands::r_runtime::r_status,
            commands::r_runtime::r_check_dependencies,
            commands::r_runtime::r_install_runtime,
            commands::r_runtime::r_install_packages,
            commands::image::image_collect_files,
            commands::image::image_convert_start,
            commands::image::image_convert_cancel,
            commands::image::image_thumbnail,
            commands::qpcr::qpcr_transform,
            commands::qpcr::qpcr_audit,
            commands::qpcr::qpcr_calculate,
            commands::qpcr::qpcr_plot_run,
            commands::qpcr::qpcr_inject_charts,
            commands::rnaseq::rnaseq_default_config,
            commands::rnaseq::rnaseq_merge_config,
            commands::rnaseq::rnaseq_import_counts,
            commands::rnaseq::rnaseq_run,
            commands::rnaseq::rnaseq_cancel,
            commands::rnaseq::rnaseq_list_runs,
            commands::rnaseq::rnaseq_load_params,
            commands::rnaseq::rnaseq_read_de_summary,
            commands::rnaseq::rnaseq_list_result_files,
            commands::charts::charts_import_data,
            commands::charts::charts_read_manifest,
            commands::charts::charts_list_templates,
            commands::charts::charts_export_zip,
            commands::charts::charts_install_template_package,
            commands::charts::charts_run,
            commands::charts::charts_cancel,
        ])
        .setup(|app| {
            let handle = app.handle();

            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                disable_dwm_window_border(&window);
            }

            // SQLite-backed settings store in the app config directory.
            let config_dir = handle
                .path()
                .app_config_dir()
                .map_err(|e| format!("config dir: {e}"))?;
            std::fs::create_dir_all(&config_dir).map_err(|e| format!("config dir create: {e}"))?;
            let store =
                mynx_core::settings::SettingsStore::open(config_dir.join("settings.sqlite3"))
                    .map_err(|e| format!("settings store: {e}"))?;

            // Migrate the legacy config.json (tauri-plugin-store file) once;
            // keys are identical so this is lossless.
            migrate_legacy_store(&store, &config_dir);

            let app_state = Arc::new(AppState {
                settings: store,
                jobs: Arc::new(mynx_jobs::JobManager::new()),
                r: mynx_core::r::RRuntime::new(),
            });
            app.manage(app_state.clone());

            // Task-center bridge: job changes → `mynx://task-changed`
            // events + SQLite history for terminal states.
            let mut rx = app_state.jobs.subscribe();
            let bridge_state = app_state.clone();
            let bridge_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(record) = rx.recv().await {
                    if record.status.is_terminal() {
                        bridge_state.settings.record_task(&record);
                    }
                    let _ = bridge_handle.emit_to("main", "mynx://task-changed", &record);
                }
            });

            build_menu(handle)?;
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "file-home" | "view-home" => {
                let _ = app.emit_to("main", "mynx://navigate", "/");
            }
            "window-always-on-top" => {
                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(is_on_top) = window.is_always_on_top() {
                        let _ = window.set_always_on_top(!is_on_top);
                        let _ = app.emit_to("main", "mynx://always-on-top", !is_on_top);
                    }
                }
            }
            "app-toggle-language" => {
                let _ = app.emit_to("main", "mynx://toggle-language", ());
            }
            "help-guide" => {
                let _ = app.emit_to("main", "mynx://help", ());
            }
            "help-about" => {
                let _ = app.emit_to("main", "mynx://about", ());
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .unwrap_or_else(|error| {
            eprintln!("[mynx] fatal: {error}");
            std::process::exit(1);
        })
        .run(|app, event| {
            // With the `unstable` feature, the main webview is a WindowChild,
            // so drag-drop arrives as RunEvent::WebviewEvent — a route the fs
            // plugin's own auto-grant (which only watches WindowEvent) misses.
            // Grant dropped paths on the fs scope so readFile on e.g. a USB
            // drive succeeds, mirroring what dialog-opened files already get.
            match event {
                RunEvent::WebviewEvent {
                    event: WebviewEvent::DragDrop(DragDropEvent::Drop { paths, .. }),
                    ..
                }
                | RunEvent::WindowEvent {
                    event: WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }),
                    ..
                } => {
                    let scope = app.fs_scope();
                    for path in paths {
                        if path.is_file() {
                            let _ = scope.allow_file(path);
                        } else {
                            let _ = scope.allow_directory(path, true);
                        }
                    }
                }
                _ => {}
            }
        });
}

#[cfg(target_os = "windows")]
fn disable_dwm_window_border(window: &tauri::WebviewWindow) {
    use windows::Win32::{
        Graphics::Dwm::{
            DwmExtendFrameIntoClientArea, DwmSetWindowAttribute, DWMWA_BORDER_COLOR,
            DWMWA_COLOR_NONE,
        },
        UI::Controls::MARGINS,
    };

    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    // Extend the DWM frame through the client area to hide its visible border while
    // retaining the native shadow. The app shell paints an opaque surface over it.
    let margins = MARGINS {
        cxLeftWidth: -1,
        cxRightWidth: -1,
        cyTopHeight: -1,
        cyBottomHeight: -1,
    };
    let _ = unsafe { DwmExtendFrameIntoClientArea(hwnd, &margins) };

    // Windows 11 can explicitly suppress the DWM border. On older Windows versions
    // this call fails harmlessly; the frame extension above remains the fallback.
    let border_color = DWMWA_COLOR_NONE;
    let _ = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &border_color as *const u32 as *const std::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        )
    };
}

fn build_menu(handle: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let app_menu = SubmenuBuilder::new(handle, "Mynx")
        .about(Some(AboutMetadata {
            name: Some("Mynx".into()),
            version: Some(env!("CARGO_PKG_VERSION").into()),
            ..Default::default()
        }))
        .separator()
        .text("app-toggle-language", "Switch Language")
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let file_menu = SubmenuBuilder::new(handle, "File")
        .text("file-home", "Home")
        .separator()
        .close_window()
        .build()?;
    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view_menu = SubmenuBuilder::new(handle, "View")
        .text("view-home", "Show Home")
        .separator()
        .fullscreen()
        .build()?;
    let window_menu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .maximize()
        .separator()
        .text("window-always-on-top", "Keep Window on Top")
        .build()?;
    let help_menu = SubmenuBuilder::new(handle, "Help")
        .text("help-guide", "User Guide")
        .text("help-about", "About Mynx")
        .build()?;
    let menu = MenuBuilder::new(handle)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()?;
    handle.set_menu(menu)?;
    Ok(())
}

/// Read the legacy `config.json` store file (written by tauri-plugin-store in
/// the previous app) and merge its values into SQLite. The legacy store lives
/// in the same app identifier directory, so the file is shared.
fn migrate_legacy_store(store: &mynx_core::settings::SettingsStore, config_dir: &std::path::Path) {
    let legacy_path = config_dir.join("config.json");
    let Ok(raw) = std::fs::read_to_string(&legacy_path) else {
        return;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };
    // tauri-plugin-store v2 writes `{"key": value, ...}` (default serializer).
    let get = |key: &str| value.get(key).cloned();
    let as_string = |v: Option<serde_json::Value>| -> Option<String> {
        v.and_then(|v| v.as_str().map(|s| s.to_string()))
    };
    store.migrate_legacy(&mynx_contracts::settings::LegacySettings {
        v: mynx_contracts::WIRE_VERSION,
        theme: as_string(get("theme")),
        always_on_top: get("alwaysOnTop").and_then(|v| v.as_bool()),
        chart_color: as_string(get("chartColor")),
        language: None, // language lived in localStorage, migrated by the frontend
        search_engine: None,
        home_header_height: None,
        image_converter_options: get("imageConverterOptions"),
        chart_studio_presets: get("chartStudioPresets"),
    });
}
