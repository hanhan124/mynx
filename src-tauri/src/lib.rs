mod commands;
mod error;
mod services;
mod tasks;

use error::CommandError;
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
            let handle = app.handle();
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
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| match event.id().as_ref() {
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
            });
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
