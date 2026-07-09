// lib.rs — Tauri 命令 + 入口(支持 install / uninstall 两种模式)
mod elevate;
mod install;

use serde::Serialize;

#[derive(Debug, Serialize)]
struct InstallContext {
    mode: String, // "install" | "uninstall"
    app_name: String,
    app_version: String,
    publisher: String,
    default_install_path: String,
    installed_path: Option<String>,
    installed_version: Option<String>,
    payload_size_mb: u32,
    is_admin: bool,
}

#[tauri::command]
fn get_install_context(app: tauri::AppHandle) -> InstallContext {
    let program_files =
        std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string());

    let mode = if std::env::args().any(|a| a == "--uninstall") {
        "uninstall"
    } else {
        "install"
    };

    let (installed_path, installed_version) = if mode == "uninstall" {
        install::read_install_info().unwrap_or((None, None))
    } else {
        (None, None)
    };

    let _ = app;

    InstallContext {
        mode: mode.to_string(),
        app_name: "Mynx".into(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        publisher: "Han".into(),
        default_install_path: format!(r"{}\Mynx", program_files),
        installed_path,
        installed_version,
        payload_size_mb: (install::PAYLOAD_SIZE / 1024 / 1024) as u32,
        is_admin: elevate::is_elevated(),
    }
}

#[tauri::command]
async fn perform_install(
    app: tauri::AppHandle,
    opts: install::InstallOptions,
) -> Result<install::InstallResult, String> {
    install::perform_install(&app, opts)
}

#[tauri::command]
async fn perform_uninstall(app: tauri::AppHandle) -> Result<(), String> {
    install::perform_uninstall(&app)
}

/// 启动已安装的 Mynx(exe 绝对路径)
#[tauri::command]
fn launch_app(path: String) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    Command::new(&path)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("启动失败: {e}"))
}

/// 用 tauri-plugin-dialog 打开原生文件夹选择对话框
#[tauri::command]
async fn pick_install_dir(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title("选择 Mynx 安装目录")
        .pick_folder(move |folder| {
            let _ = tx.send(folder.map(|f| f.to_string()));
        });
    rx.recv().ok().flatten()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 若非管理员 → 用 runas 重新启动并退出当前进程
    if !elevate::is_elevated() {
        elevate::relaunch_as_admin();
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_install_context,
            perform_install,
            perform_uninstall,
            launch_app,
            pick_install_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}