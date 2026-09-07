mod commands;
mod error;
mod services;
mod tasks;

use error::CommandError;
use tauri::{DragDropEvent, RunEvent, WebviewEvent, WindowEvent};
use tauri_plugin_fs::FsExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::app::app_exe_path,
            commands::app::is_portable,
            commands::app::cleanup_update_bak,
            commands::search::open_search_window,
            commands::search::search_new_tab,
            commands::search::search_switch_tab,
            commands::search::search_close_tab,
            commands::search::navigate_search_window,
            commands::search::search_content_action,
            commands::weather::weather_by_ip
        ])
        .setup(|app| {
            // Command state is currently stateless. Future long-running work
            // can be registered here through app.manage(...).
            let _ = app;
            Ok(())
        })
        .build(tauri::generate_context!())
        .map_err(|error| CommandError::Builder(error.to_string()))
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
