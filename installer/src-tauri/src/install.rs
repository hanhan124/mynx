// install.rs — 实际安装 / 卸载逻辑
//   install:
//     - 复制主程序(mynx.exe,从编译期嵌入)到目标目录
//     - 创建开始菜单 + 桌面快捷方式(PowerShell COM)
//     - 写注册表:卸载项
//     - 可选:启动应用
//   uninstall:
//     - 读取已安装位置(注册表)
//     - 删除安装目录 + 快捷方式 + 注册表项

// 编译期把主程序二进制嵌入到 installer.exe 里 → 单文件分发
const MYNX_PAYLOAD: &[u8] = include_bytes!("../resources/mynx.exe");
/// 主程序大小(字节),提供给前端显示 + 写 EstimatedSize
pub const PAYLOAD_SIZE: u64 = MYNX_PAYLOAD.len() as u64;

use std::fs;
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

// 隐藏子进程窗口的 flag(Win32 CREATE_NO_WINDOW)
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 静默执行 PowerShell(无 CMD 弹窗)
fn silent_powershell(script: &str) -> Result<std::process::Output, String> {
    Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("启动 PowerShell 失败: {e}"))
}

#[derive(Debug, Clone, Deserialize)]
pub struct InstallOptions {
    pub install_path: String,
    pub create_desktop_icon: bool,
    pub create_start_menu: bool,
    #[serde(default)]
    pub launch_after: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstallProgress {
    pub stage: String,
    pub message: String,
    pub percent: u8,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstallResult {
    pub install_path: String,
    pub launched: bool,
}

const UNINSTALL_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Mynx";

/// 把嵌入的 mynx.exe 写出到临时目录,返回该路径
fn extract_payload_to_temp() -> Result<PathBuf, String> {
    let temp = std::env::temp_dir().join("mynx-installer-payload.exe");
    let mut f = fs::File::create(&temp).map_err(|e| format!("创建临时文件失败: {e}"))?;
    f.write_all(MYNX_PAYLOAD).map_err(|e| format!("写入 payload 失败: {e}"))?;
    f.sync_all().map_err(|e| e.to_string())?;
    Ok(temp)
}

/// 用 PowerShell + WScript.Shell 创建 .lnk 快捷方式
fn create_shortcut(target: &str, lnk_path: &str, work_dir: &str, icon_path: &str) -> Result<(), String> {
    let esc = |s: &str| s.replace('\'', "''");
    let script = format!(
        "$s = (New-Object -COM WScript.Shell).CreateShortcut('{}'); \
         $s.TargetPath = '{}'; \
         $s.WorkingDirectory = '{}'; \
         $s.IconLocation = '{}'; \
         $s.Description = 'Mynx'; \
         $s.Save()",
        esc(lnk_path),
        esc(target),
        esc(work_dir),
        esc(icon_path),
    );
    let out = silent_powershell(&script)?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("创建快捷方式失败: {}", err));
    }
    Ok(())
}

/// 写注册表(卸载项)
fn write_registry(install_path: &str, exe_path: &str, version: &str) -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let key_result = RegKey::predef(HKEY_LOCAL_MACHINE)
        .create_subkey(UNINSTALL_KEY)
        .or_else(|_| RegKey::predef(HKEY_CURRENT_USER).create_subkey(UNINSTALL_KEY));

    match key_result {
        Ok((key, _)) => {
            let _ = key.set_value("DisplayName", &"Mynx");
            let _ = key.set_value("DisplayVersion", &version);
            let _ = key.set_value("Publisher", &"Han");
            let _ = key.set_value("InstallLocation", &install_path);
            let _ = key.set_value(
                "UninstallString",
                &format!(r#""{}\Uninst.exe" --uninstall"#, install_path),
            );
            let _ = key.set_value("DisplayIcon", &format!(r#"{},0"#, exe_path));
            let _ = key.set_value("NoModify", &1u32);
            let _ = key.set_value("NoRepair", &1u32);
            // 让"程序和功能"显示正确大小(KB,整除向上取整)
            let _ = key.set_value(
                "EstimatedSize",
                &((PAYLOAD_SIZE + 1023) / 1024),
            );
            let _ = key.set_value("InstallDate", &chrono_like_today());
        }
        Err(e) => return Err(format!("写卸载项失败: {e}")),
    }

    Ok(())
}

fn chrono_like_today() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 简单 YYYYMMDD
    let s = secs as i64;
    let days = s / 86400;
    let (y, m, d) = days_to_ymd(days);
    format!("{:04}{:02}{:02}", y, m, d)
}

fn days_to_ymd(mut days: i64) -> (i64, u32, u32) {
    // 1970-01-01 起算
    let mut y = 1970;
    loop {
        let dy = if is_leap(y) { 366 } else { 365 };
        if days < dy { break; }
        days -= dy;
        y += 1;
    }
    let mdays = [31, 28 + if is_leap(y) { 1 } else { 0 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 1u32;
    for &dm in &mdays {
        if days < dm { break; }
        days -= dm;
        m += 1;
    }
    (y, m, days as u32 + 1)
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

// ────────────────────────────────────────────────────────────
// 安装前置检查
// ────────────────────────────────────────────────────────────

/// 检测 mynx.exe 是否正在运行(用 tasklist /FI 过滤)
pub fn is_mynx_running() -> bool {
    Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq mynx.exe", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| {
            let s = String::from_utf8_lossy(&o.stdout).to_lowercase();
            // 排除 "INFO: No tasks are running..." 这类空响应
            s.contains("mynx.exe") && !s.contains("no tasks")
        })
        .unwrap_or(false)
}

/// 校验安装路径合法性:非空、绝对路径、父目录可写
fn validate_install_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("请输入安装路径".to_string());
    }
    let p = PathBuf::from(trimmed);
    if !p.has_root() {
        return Err("请使用绝对路径(例如 C:\\Program Files\\Mynx)".to_string());
    }
    // 文件名部分不能是盘符根(例如 "C:\")
    let name = p.file_name().ok_or("路径格式不正确".to_string())?;
    if name.to_string_lossy().is_empty() {
        return Err("路径格式不正确".to_string());
    }
    let parent = p.parent().ok_or("无法解析父目录".to_string())?;
    if !parent.exists() {
        return Err(format!(
            "父目录不存在,请先创建:\n{}",
            parent.display()
        ));
    }
    // 写测试文件验证可写
    let test_file = parent.join(".mynx_write_test");
    if fs::write(&test_file, b"ok").is_err() {
        return Err(format!("目录不可写,请检查权限:\n{}", parent.display()));
    }
    let _ = fs::remove_file(&test_file);
    Ok(p)
}

/// 复制主程序文件,带进度回调
fn copy_payload(
    src: &Path,
    dst_dir: &Path,
    on_progress: &dyn Fn(u8, &str),
) -> Result<PathBuf, String> {
    on_progress(5, "正在准备安装目录…");
    fs::create_dir_all(dst_dir).map_err(|e| format!("创建目录失败: {e}"))?;

    on_progress(15, "正在复制主程序…");
    let dst_exe = dst_dir.join("mynx.exe");
    fs::copy(src, &dst_exe).map_err(|e| format!("复制 mynx.exe 失败: {e}"))?;

    on_progress(35, "正在安装卸载程序…");
    let self_exe = std::env::current_exe().map_err(|e| format!("定位自身失败: {e}"))?;
    let uninst_path = dst_dir.join("Uninst.exe");
    if self_exe != uninst_path {
        let _ = fs::copy(&self_exe, &uninst_path);
    }

    Ok(dst_exe)
}

pub fn perform_install(app: &AppHandle, opts: InstallOptions) -> Result<InstallResult, String> {
    // 1. 前置检查
    if is_mynx_running() {
        return Err("Mynx 正在运行,请先关闭程序后再安装".to_string());
    }
    let install_dir = validate_install_path(&opts.install_path)?;

    let emit = |stage: &str, msg: &str, pct: u8| {
        let _ = app.emit(
            "install-progress",
            InstallProgress {
                stage: stage.into(),
                message: msg.into(),
                percent: pct,
            },
        );
    };

    emit("preparing", "正在准备…", 2);
    let payload_src = extract_payload_to_temp()?;
    let dst_exe = copy_payload(&payload_src, &install_dir, &|p, m| emit("copy", m, p))?;

    let exe_str = dst_exe.to_string_lossy().to_string();

    emit("shortcuts", "正在创建快捷方式…", 60);
    if opts.create_start_menu {
        let start_menu = dirs::data_dir()
            .map(|p| p.join("Microsoft").join("Windows").join("Start Menu").join("Programs"))
            .ok_or_else(|| "找不到开始菜单目录".to_string())?;
        let sm_dir = start_menu.join("Mynx");
        fs::create_dir_all(&sm_dir).map_err(|e| format!("创建开始菜单目录失败: {e}"))?;
        let sm_lnk = sm_dir.join("Mynx.lnk");
        create_shortcut(&exe_str, &sm_lnk.to_string_lossy(), &install_dir.to_string_lossy(), &exe_str)?;
        let uninst_lnk = sm_dir.join("卸载 Mynx.lnk");
        let uninst_exe = install_dir.join("Uninst.exe");
        create_shortcut(
            &uninst_exe.to_string_lossy(),
            &uninst_lnk.to_string_lossy(),
            &install_dir.to_string_lossy(),
            &exe_str,
        )?;
    }
    if opts.create_desktop_icon {
        let desktop = dirs::desktop_dir().ok_or_else(|| "找不到桌面目录".to_string())?;
        let dt_lnk = desktop.join("Mynx.lnk");
        create_shortcut(&exe_str, &dt_lnk.to_string_lossy(), &install_dir.to_string_lossy(), &exe_str)?;
    }

    emit("registry", "正在写入注册表…", 85);
    let pkg_version = env!("CARGO_PKG_VERSION");
    write_registry(&install_dir.to_string_lossy(), &exe_str, pkg_version)?;

    emit("done", "安装完成", 100);

    let launched = if opts.launch_after {
        let _ = Command::new(&exe_str)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
        true
    } else {
        false
    };

    Ok(InstallResult {
        install_path: exe_str,
        launched,
    })
}

// ────────────────────────────────────────────────────────────
// 卸载
// ────────────────────────────────────────────────────────────

/// 读注册表,返回 (安装目录, 版本号)
pub fn read_install_info() -> Result<(Option<String>, Option<String>), ()> {
    use winreg::enums::*;
    use winreg::RegKey;

    let key = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(UNINSTALL_KEY)
        .or_else(|_| RegKey::predef(HKEY_CURRENT_USER).open_subkey(UNINSTALL_KEY))
        .map_err(|_| ())?;

    let path: String = key.get_value("InstallLocation").unwrap_or_default();
    let ver: String = key.get_value("DisplayVersion").unwrap_or_default();
    Ok((Some(path).filter(|s| !s.is_empty()), Some(ver).filter(|s| !s.is_empty())))
}

pub fn perform_uninstall(app: &AppHandle) -> Result<(), String> {
    // 卸载前同样检查 mynx.exe 是否在跑
    if is_mynx_running() {
        return Err("Mynx 正在运行,请先关闭程序后再卸载".to_string());
    }

    let emit = |msg: &str, pct: u8| {
        let _ = app.emit(
            "uninstall-progress",
            InstallProgress {
                stage: "uninstall".into(),
                message: msg.into(),
                percent: pct,
            },
        );
    };

    use winreg::enums::*;
    use winreg::RegKey;

    emit("正在读取安装信息…", 5);
    let install_path: String = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(UNINSTALL_KEY)
        .or_else(|_| RegKey::predef(HKEY_CURRENT_USER).open_subkey(UNINSTALL_KEY))
        .and_then(|k| k.get_value("InstallLocation"))
        .map_err(|e| format!("找不到安装信息: {e}"))?;

    let install_dir = PathBuf::from(&install_path);

    emit("正在删除桌面快捷方式…", 25);
    if let Some(desktop) = dirs::desktop_dir() {
        let _ = fs::remove_file(desktop.join("Mynx.lnk"));
    }

    emit("正在删除开始菜单快捷方式…", 45);
    if let Some(start_menu) = dirs::data_dir().map(|p| p.join("Microsoft").join("Windows").join("Start Menu").join("Programs")) {
        let sm_dir = start_menu.join("Mynx");
        let _ = fs::remove_dir_all(&sm_dir);
    }

    emit("正在删除安装目录…", 70);
    if install_dir.exists() {
        // 先尝试删除自身外的所有文件,然后删除整个目录
        let _ = fs::remove_dir_all(&install_dir);
    }

    emit("正在清理注册表…", 90);
    let _ = RegKey::predef(HKEY_LOCAL_MACHINE).delete_subkey_all(UNINSTALL_KEY);
    let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(UNINSTALL_KEY);

    emit("卸载完成", 100);
    Ok(())
}