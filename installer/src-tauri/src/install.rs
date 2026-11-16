// install.rs — 实际安装 / 卸载逻辑
//   install:
//     - 复制主程序(mynx.exe,从编译期嵌入)到目标目录
//     - 释放 RNA-seq R 引擎脚本(R_RESOURCES)到主程序旁的 r/ 目录
//     - 创建开始菜单 + 桌面快捷方式(PowerShell COM)
//     - 写注册表:卸载项
//     - 可选:启动应用
//   uninstall:
//     - 读取已安装位置(注册表)
//     - 删除安装目录 + 快捷方式 + 注册表项

// 主程序以 gzip 形式嵌入单文件安装器，安装时解压回原始 mynx.exe。
// RNA-seq R 引擎脚本(运行时按 resourceDir()/r/... 解析,安装时释放到主程序旁)。
// 由 scripts/sync-installer-payload.cjs 同步并校验清单一致性 —— r/ 下新增
// 脚本后必须同步登记到这里,否则同步脚本会让构建失败。
#[cfg(not(feature = "uninstaller"))]
include!("generated_resources.rs");

#[cfg(feature = "uninstaller")]
const MYNX_PAYLOAD_GZIP: &[u8] = &[];
#[cfg(feature = "uninstaller")]
const MYNX_PAYLOAD_UNCOMPRESSED_SIZE: u64 = 0;
#[cfg(feature = "uninstaller")]
const MYNX_UNINSTALLER: &[u8] = &[];
#[cfg(feature = "uninstaller")]
const MYNX_UNINSTALLER_SIZE: u64 = 0;
#[cfg(feature = "uninstaller")]
const R_RESOURCES: &[(&str, &[u8])] = &[];

use std::fs;
use std::io::{ErrorKind, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

// 隐藏子进程窗口的 flag(Win32 CREATE_NO_WINDOW)
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// 安装后实际占用:主程序 + 全部 R 资源 + 复制到安装目录的卸载程序。
pub fn estimated_installed_size_bytes() -> u64 {
    MYNX_PAYLOAD_UNCOMPRESSED_SIZE
        + R_RESOURCES
            .iter()
            .map(|(_, bytes)| bytes.len() as u64)
            .sum::<u64>()
        + MYNX_UNINSTALLER_SIZE
}

/// 安装事务的额外磁盘空间峰值:完整暂存载荷 + 系统临时目录中的主程序副本。
pub fn temporary_space_required_bytes() -> u64 {
    estimated_installed_size_bytes() + MYNX_PAYLOAD_UNCOMPRESSED_SIZE
}

/// 静默执行 PowerShell(无 CMD 弹窗)
fn silent_powershell(script: &str) -> Result<std::process::Output, String> {
    Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
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
}

const UNINSTALL_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Mynx";

/// 解压嵌入的 mynx.exe 到临时目录,返回该路径。
fn extract_payload_to_temp() -> Result<PathBuf, String> {
    for _ in 0..16 {
        let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let temp = std::env::temp_dir().join(format!(
            "mynx-installer-payload-{}-{sequence}.exe",
            std::process::id()
        ));
        let mut file = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
        {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("创建临时文件失败: {error}")),
        };
        let write_result = (|| -> std::io::Result<()> {
            let mut decoder = flate2::read::GzDecoder::new(MYNX_PAYLOAD_GZIP);
            let written = std::io::copy(&mut decoder, &mut file)?;
            if written != MYNX_PAYLOAD_UNCOMPRESSED_SIZE {
                return Err(std::io::Error::new(
                    ErrorKind::InvalidData,
                    "解压后的 Mynx 主程序大小与 payload 清单不一致",
                ));
            }
            file.sync_all()
        })();
        if let Err(error) = write_result {
            drop(file);
            let _ = fs::remove_file(&temp);
            return Err(format!("解压临时 payload 失败: {error}"));
        }
        return Ok(temp);
    }
    Err("无法创建唯一的临时 payload 文件".into())
}

struct RemoveFileOnDrop(PathBuf);

impl Drop for RemoveFileOnDrop {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

struct StagingDirectory(PathBuf);

impl Drop for StagingDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// 用 PowerShell + WScript.Shell 创建 .lnk 快捷方式
fn create_shortcut(
    target: &str,
    lnk_path: &str,
    work_dir: &str,
    icon_path: &str,
    arguments: Option<&str>,
) -> Result<(), String> {
    let esc = |s: &str| s.replace('\'', "''");
    let arguments = arguments.map(esc).unwrap_or_default();
    let script = format!(
        "$s = (New-Object -COM WScript.Shell).CreateShortcut('{}'); \
         $s.TargetPath = '{}'; \
         $s.WorkingDirectory = '{}'; \
         $s.IconLocation = '{}'; \
         $s.Arguments = '{}'; \
         $s.Description = 'Mynx'; \
         $s.Save()",
        esc(lnk_path),
        esc(target),
        esc(work_dir),
        esc(icon_path),
        arguments,
    );
    let out = silent_powershell(&script)?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("创建快捷方式失败: {}", err));
    }
    Ok(())
}

/// 写注册表(卸载项)
fn write_registry(
    install_path: &str,
    exe_path: &str,
    version: &str,
    installed_size_bytes: u64,
) -> Result<(), String> {
    use winreg::enums::*;
    use winreg::{RegKey, RegValue};

    let machine_root = RegKey::predef(HKEY_LOCAL_MACHINE);
    let (root, key, disposition, hive) = match machine_root.create_subkey(UNINSTALL_KEY) {
        Ok((key, disposition)) => (machine_root, key, disposition, "HKEY_LOCAL_MACHINE"),
        Err(machine_error) => {
            let user_root = RegKey::predef(HKEY_CURRENT_USER);
            match user_root.create_subkey(UNINSTALL_KEY) {
                Ok((key, disposition)) => (user_root, key, disposition, "HKEY_CURRENT_USER"),
                Err(user_error) => {
                    return Err(format!(
                        "写入卸载项失败（HKLM: {machine_error}; HKCU: {user_error}）"
                    ));
                }
            }
        }
    };
    let previous_values = key
        .enum_values()
        .collect::<std::io::Result<Vec<(String, RegValue)>>>()
        .map_err(|error| format!("读取现有卸载项失败: {error}"))?;

    let write_result = (|| -> Result<(), String> {
        key.set_value("DisplayName", &"Mynx")
            .map_err(|error| format!("写入卸载项 DisplayName 失败: {error}"))?;
        key.set_value("DisplayVersion", &version)
            .map_err(|error| format!("写入卸载项 DisplayVersion 失败: {error}"))?;
        key.set_value("Publisher", &"Han")
            .map_err(|error| format!("写入卸载项 Publisher 失败: {error}"))?;
        key.set_value("InstallLocation", &install_path)
            .map_err(|error| format!("写入卸载项 InstallLocation 失败: {error}"))?;
        key.set_value(
            "UninstallString",
            &format!(r#""{}\Uninst.exe" --uninstall"#, install_path),
        )
        .map_err(|error| format!("写入卸载项 UninstallString 失败: {error}"))?;
        key.set_value("DisplayIcon", &format!(r#"{},0"#, exe_path))
            .map_err(|error| format!("写入卸载项 DisplayIcon 失败: {error}"))?;
        key.set_value("NoModify", &1u32)
            .map_err(|error| format!("写入卸载项 NoModify 失败: {error}"))?;
        key.set_value("NoRepair", &1u32)
            .map_err(|error| format!("写入卸载项 NoRepair 失败: {error}"))?;
        // 让"程序和功能"显示正确大小(KB,整除向上取整)
        key.set_value("EstimatedSize", &installed_size_bytes.div_ceil(1024))
            .map_err(|error| format!("写入卸载项 EstimatedSize 失败: {error}"))?;
        key.set_value("InstallDate", &chrono_like_today())
            .map_err(|error| format!("写入卸载项 InstallDate 失败: {error}"))?;
        Ok(())
    })();

    if let Err(error) = write_result {
        let rollback_errors =
            rollback_registry_values(&root, UNINSTALL_KEY, key, disposition, &previous_values);
        let rollback_note = if rollback_errors.is_empty() {
            String::new()
        } else {
            format!("；恢复 {hive} 卸载项失败: {}", rollback_errors.join("；"))
        };
        return Err(format!("{error}{rollback_note}"));
    }

    Ok(())
}

fn rollback_registry_values(
    root: &winreg::RegKey,
    key_path: &str,
    key: winreg::RegKey,
    disposition: winreg::enums::RegDisposition,
    previous_values: &[(String, winreg::RegValue)],
) -> Vec<String> {
    use winreg::enums::REG_CREATED_NEW_KEY;

    if disposition == REG_CREATED_NEW_KEY {
        drop(key);
        return root
            .delete_subkey_all(key_path)
            .err()
            .map(|error| vec![error.to_string()])
            .unwrap_or_default();
    }

    let previous_names = previous_values
        .iter()
        .map(|(name, _)| name.to_lowercase())
        .collect::<std::collections::HashSet<_>>();
    let mut errors = Vec::new();
    match key.enum_values().collect::<std::io::Result<Vec<_>>>() {
        Ok(current_values) => {
            for (name, _) in current_values {
                if !previous_names.contains(&name.to_lowercase()) {
                    if let Err(error) = key.delete_value(&name) {
                        errors.push(format!("删除新增值 {name} 失败: {error}"));
                    }
                }
            }
        }
        Err(error) => errors.push(format!("枚举当前值失败: {error}")),
    }
    for (name, value) in previous_values {
        if let Err(error) = key.set_raw_value(name, value) {
            errors.push(format!("恢复原值 {name} 失败: {error}"));
        }
    }
    errors
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
        if days < dy {
            break;
        }
        days -= dy;
        y += 1;
    }
    let mdays = [
        31,
        28 + if is_leap(y) { 1 } else { 0 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut m = 1u32;
    for &dm in &mdays {
        if days < dm {
            break;
        }
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

/// 查询指定安装目录中的 Mynx 进程，避免临时安装/多版本并存时误关其他副本。
fn mynx_process_ids(install_dir: &Path) -> Result<Vec<u32>, String> {
    let executable = install_dir.join("mynx.exe");
    if !executable.is_file() {
        return Ok(Vec::new());
    }
    let target = powershell_literal(&executable.to_string_lossy());
    let script = format!(
        "$target = [System.IO.Path]::GetFullPath({target}); \
         Get-CimInstance -ClassName Win32_Process -Filter \"Name='mynx.exe'\" | \
         Where-Object {{ $_.ExecutablePath -and [string]::Equals([System.IO.Path]::GetFullPath($_.ExecutablePath), $target, [System.StringComparison]::OrdinalIgnoreCase) }} | \
         ForEach-Object {{ $_.ProcessId }}",
    );
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("无法检查目标目录中的 Mynx 进程: {error}"))?;
    if !output.status.success() {
        return Err("无法检查目标目录中的 Mynx 进程".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .collect())
}

fn is_process_running(pid: u32) -> bool {
    let filter = format!("PID eq {pid}");
    Command::new("tasklist")
        .args(["/FI", &filter, "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|output| {
            let pid_text = pid.to_string();
            String::from_utf8_lossy(&output.stdout).lines().any(|line| {
                let mut columns = line.split_whitespace();
                columns.next().is_some() && columns.next() == Some(pid_text.as_str())
            })
        })
        .unwrap_or(false)
}

/// 等待一组精确 PID 退出，超时返回 false。
fn wait_processes_exit(process_ids: &[u32], timeout_ms: u64) -> bool {
    let start = std::time::Instant::now();
    loop {
        if process_ids.iter().all(|pid| !is_process_running(*pid)) {
            return true;
        }
        if start.elapsed().as_millis() as u64 >= timeout_ms {
            return process_ids.iter().all(|pid| !is_process_running(*pid));
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}

/// 只关闭目标安装目录中的 Mynx，先尝试正常退出，超时后再强制结束。
fn stop_mynx_processes(install_dir: &Path) -> Result<(), String> {
    let process_ids = mynx_process_ids(install_dir)?;
    if process_ids.is_empty() {
        return Ok(());
    }
    for pid in &process_ids {
        let pid = pid.to_string();
        let _ = Command::new("taskkill")
            .args(["/PID", &pid])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
    if wait_processes_exit(&process_ids, 6000) {
        return Ok(());
    }
    for pid in &process_ids {
        let pid = pid.to_string();
        let _ = Command::new("taskkill")
            .args(["/F", "/PID", &pid])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
    if wait_processes_exit(&process_ids, 4000) {
        return Ok(());
    }
    Err("无法关闭正在运行的 Mynx,请手动退出后重试".into())
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
        return Err(format!("父目录不存在,请先创建:\n{}", parent.display()));
    }
    // Use an exclusive, unique probe. A fixed filename could overwrite and
    // then delete a user's existing file in the selected parent directory.
    let mut probe_created = false;
    for _ in 0..16 {
        let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let probe = parent.join(format!(
            ".mynx_write_test-{}-{sequence}",
            std::process::id()
        ));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
        {
            Ok(mut file) => {
                let write_result = file.write_all(b"ok");
                drop(file);
                let remove_result = fs::remove_file(&probe);
                if let Err(error) = write_result {
                    let _ = remove_result;
                    return Err(format!(
                        "目录不可写,请检查权限:\n{} ({error})",
                        parent.display()
                    ));
                }
                remove_result.map_err(|error| {
                    format!("无法清理安装目录检测文件:\n{} ({error})", probe.display())
                })?;
                probe_created = true;
                break;
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "目录不可写,请检查权限:\n{} ({error})",
                    parent.display()
                ));
            }
        }
    }
    if !probe_created {
        return Err(format!("无法创建唯一的目录检测文件:\n{}", parent.display()));
    }
    Ok(p)
}

fn remove_path(path: &Path) -> std::io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn rollback_payload(
    dst_dir: &Path,
    backup_dir: &Path,
    backed_up: &[&str],
    installed: &[&str],
) -> Vec<String> {
    let mut errors = Vec::new();
    for name in installed.iter().rev() {
        if let Err(error) = remove_path(&dst_dir.join(name)) {
            errors.push(format!("删除新文件 {name} 失败: {error}"));
        }
    }
    for name in backed_up.iter().rev() {
        if let Err(error) = fs::rename(backup_dir.join(name), dst_dir.join(name)) {
            errors.push(format!("恢复原文件 {name} 失败: {error}"));
        }
    }
    errors
}

/// 在同一文件系统内交换已完整暂存的文件,失败时恢复旧安装。
fn commit_staged_payload(dst_dir: &Path, stage_dir: &Path) -> Result<(), String> {
    let token = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let backup_dir = dst_dir.join(format!(".mynx-backup-{token}"));
    fs::create_dir(&backup_dir).map_err(|e| format!("创建回滚目录失败: {e}"))?;
    let names = ["mynx.exe", "r", "Uninst.exe"];
    let mut backed_up = Vec::new();

    for name in names {
        let current = dst_dir.join(name);
        if fs::symlink_metadata(&current).is_ok() {
            if let Err(error) = fs::rename(&current, backup_dir.join(name)) {
                let rollback_errors = rollback_payload(dst_dir, &backup_dir, &backed_up, &[]);
                if rollback_errors.is_empty() {
                    let _ = fs::remove_dir_all(&backup_dir);
                }
                let suffix = if rollback_errors.is_empty() {
                    String::new()
                } else {
                    format!("；回滚问题: {}", rollback_errors.join("；"))
                };
                return Err(format!("备份现有文件 {name} 失败: {error}{suffix}"));
            }
            backed_up.push(name);
        } else if let Err(error) = fs::symlink_metadata(&current) {
            if error.kind() != ErrorKind::NotFound {
                let rollback_errors = rollback_payload(dst_dir, &backup_dir, &backed_up, &[]);
                if rollback_errors.is_empty() {
                    let _ = fs::remove_dir_all(&backup_dir);
                }
                let suffix = if rollback_errors.is_empty() {
                    String::new()
                } else {
                    format!("；回滚问题: {}", rollback_errors.join("；"))
                };
                return Err(format!("检查现有文件 {name} 失败: {error}{suffix}"));
            }
        }
    }

    let mut installed = Vec::new();
    for name in names {
        if let Err(error) = fs::rename(stage_dir.join(name), dst_dir.join(name)) {
            let rollback_errors = rollback_payload(dst_dir, &backup_dir, &backed_up, &installed);
            if rollback_errors.is_empty() {
                let _ = fs::remove_dir_all(&backup_dir);
            }
            let suffix = if rollback_errors.is_empty() {
                String::new()
            } else {
                format!("；回滚问题: {}", rollback_errors.join("；"))
            };
            return Err(format!("安装文件 {name} 失败: {error}{suffix}"));
        }
        installed.push(name);
    }

    // 清理旧文件失败不影响已完成的新安装,备份留在隐藏目录供恢复。
    let _ = fs::remove_dir_all(&backup_dir);
    Ok(())
}

/// 返回安装目录内 Mynx 程序、卸载程序和 R 资源的实际占用。
fn installed_payload_size_bytes(dst_dir: &Path) -> Result<u64, String> {
    fn directory_size(path: &Path) -> Result<u64, String> {
        let mut total = 0;
        for entry in fs::read_dir(path).map_err(|e| format!("读取 {} 失败: {e}", path.display()))?
        {
            let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
            let file_type = entry
                .file_type()
                .map_err(|e| format!("读取文件类型失败: {e}"))?;
            if file_type.is_dir() {
                total += directory_size(&entry.path())?;
            } else if file_type.is_file() {
                total += entry
                    .metadata()
                    .map_err(|e| format!("读取文件大小失败: {e}"))?
                    .len();
            }
        }
        Ok(total)
    }

    let main_size = fs::metadata(dst_dir.join("mynx.exe"))
        .map_err(|e| format!("读取安装后主程序大小失败: {e}"))?
        .len();
    let uninstaller_size = fs::metadata(dst_dir.join("Uninst.exe"))
        .map_err(|e| format!("读取安装后卸载程序大小失败: {e}"))?
        .len();
    Ok(main_size + uninstaller_size + directory_size(&dst_dir.join("r"))?)
}

/// 先写齐全部 payload 到临时子目录,再提交目录项,避免磁盘不足时删坏旧版。
fn copy_payload(
    src: &Path,
    dst_dir: &Path,
    on_progress: &dyn Fn(u8, &str),
) -> Result<PathBuf, String> {
    on_progress(5, "正在准备安装目录…");
    fs::create_dir_all(dst_dir).map_err(|e| format!("创建目录失败: {e}"))?;

    let token = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let stage_dir = dst_dir.join(format!(".mynx-stage-{token}"));
    fs::create_dir(&stage_dir).map_err(|e| format!("创建暂存目录失败: {e}"))?;
    let _stage_cleanup = StagingDirectory(stage_dir.clone());

    on_progress(15, "正在准备主程序…");
    fs::copy(src, stage_dir.join("mynx.exe")).map_err(|e| format!("暂存 mynx.exe 失败: {e}"))?;

    on_progress(25, "正在准备分析引擎…");
    for (rel, bytes) in R_RESOURCES {
        let dst = stage_dir.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建暂存目录失败: {e}"))?;
        }
        fs::write(&dst, bytes).map_err(|e| format!("暂存 {rel} 失败: {e}"))?;
    }

    on_progress(35, "正在准备卸载程序…");
    if MYNX_UNINSTALLER.is_empty() || MYNX_UNINSTALLER.len() as u64 != MYNX_UNINSTALLER_SIZE {
        return Err("嵌入的卸载程序缺失或大小不匹配".into());
    }
    fs::write(stage_dir.join("Uninst.exe"), MYNX_UNINSTALLER)
        .map_err(|e| format!("暂存卸载程序失败: {e}"))?;

    on_progress(45, "正在切换安装文件…");
    commit_staged_payload(dst_dir, &stage_dir)?;
    Ok(dst_dir.join("mynx.exe"))
}

/// 安装核心(与 UI 无关,静默升级复用同一逻辑)。
/// `auto_launch` 只用于无 UI 的静默升级:向导安装必须由「完成」页的按钮显式启动,
/// 否则应用会在用户看到「稍后启动」之前就运行,使该按钮失去意义。
fn do_install(
    opts: &InstallOptions,
    emit: &dyn Fn(&str, &str, u8),
    auto_launch: bool,
) -> Result<InstallResult, String> {
    let install_dir = validate_install_path(&opts.install_path)?;

    // 1. 关闭正在运行的 Mynx(升级场景:旧进程可能尚未退净)
    emit("preparing", "正在关闭正在运行的 Mynx…", 2);
    stop_mynx_processes(&install_dir)?;

    emit("preparing", "正在准备…", 5);
    let payload_src = extract_payload_to_temp()?;
    let payload_cleanup = RemoveFileOnDrop(payload_src.clone());
    let copy_result = copy_payload(&payload_src, &install_dir, &|p, m| emit("copy", m, p));
    drop(payload_cleanup);
    let dst_exe = copy_result?;

    let exe_str = dst_exe.to_string_lossy().to_string();

    emit("shortcuts", "正在创建快捷方式…", 60);
    if opts.create_start_menu {
        let start_menu = dirs::data_dir()
            .map(|p| {
                p.join("Microsoft")
                    .join("Windows")
                    .join("Start Menu")
                    .join("Programs")
            })
            .ok_or_else(|| "找不到开始菜单目录".to_string())?;
        let sm_dir = start_menu.join("Mynx");
        fs::create_dir_all(&sm_dir).map_err(|e| format!("创建开始菜单目录失败: {e}"))?;
        let sm_lnk = sm_dir.join("Mynx.lnk");
        create_shortcut(
            &exe_str,
            &sm_lnk.to_string_lossy(),
            &install_dir.to_string_lossy(),
            &exe_str,
            None,
        )?;
        let uninst_lnk = sm_dir.join("卸载 Mynx.lnk");
        let uninst_exe = install_dir.join("Uninst.exe");
        create_shortcut(
            &uninst_exe.to_string_lossy(),
            &uninst_lnk.to_string_lossy(),
            &install_dir.to_string_lossy(),
            &exe_str,
            Some("--uninstall"),
        )?;
    }
    if opts.create_desktop_icon {
        let desktop = dirs::desktop_dir().ok_or_else(|| "找不到桌面目录".to_string())?;
        let dt_lnk = desktop.join("Mynx.lnk");
        create_shortcut(
            &exe_str,
            &dt_lnk.to_string_lossy(),
            &install_dir.to_string_lossy(),
            &exe_str,
            None,
        )?;
    }

    emit("registry", "正在写入注册表…", 85);
    let pkg_version = env!("CARGO_PKG_VERSION");
    let installed_size = installed_payload_size_bytes(&install_dir)?;
    write_registry(
        &install_dir.to_string_lossy(),
        &exe_str,
        pkg_version,
        installed_size,
    )?;

    emit("done", "安装完成", 100);

    // 只有无 UI 的静默升级才自动启动。向导安装交由「完成」页的
    // 「立即启动」按钮调用 launch_app,保证「稍后启动」真实有效。
    if auto_launch {
        let _ = Command::new(&exe_str)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }

    Ok(InstallResult {
        install_path: exe_str,
    })
}

/// UI 模式安装:进度事件推送到安装器窗口。
/// 永不自动启动应用——是否运行由「完成」页的按钮决定。
#[cfg(not(feature = "uninstaller"))]
pub fn perform_install(app: &AppHandle, opts: InstallOptions) -> Result<InstallResult, String> {
    do_install(&opts, &|stage, msg, pct| {
        let _ = app.emit(
            "install-progress",
            InstallProgress {
                stage: stage.into(),
                message: msg.into(),
                percent: pct,
            },
        );
    }, false)
}

// ────────────────────────────────────────────────────────────
// 自动更新(tauri updater 以 /UPDATE 启动本安装器)
// ────────────────────────────────────────────────────────────

/// 是否为更新启动:tauri updater 在 Windows 上以 NSIS 兼容参数启动
/// (默认 passive 模式,形如 `/P /UPDATE /ARGS …`),这里识别其中任意一个。
pub fn is_update_launch() -> bool {
    std::env::args().skip(1).any(|a| {
        let a = a.trim().to_lowercase();
        a == "/update" || a == "--update" || a == "/p"
    })
}

/// 静默升级:沿用已安装路径与快捷方式,装完自动启动新版。
/// 没有历史安装信息时按默认路径全新安装。
pub fn silent_update() -> Result<(), String> {
    let (installed_path, _installed_version) = read_install_info().unwrap_or((None, None));
    let dir = installed_path
        .filter(|p| Path::new(p).exists())
        .unwrap_or_else(|| {
            let program_files =
                std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string());
            format!(r"{}\Mynx", program_files)
        });
    // 快捷方式沿用现状:之前创建过就保持,没创建过就不新增
    let desktop = dirs::desktop_dir()
        .map(|d| d.join("Mynx.lnk").exists())
        .unwrap_or(true);
    let start_menu = dirs::data_dir()
        .map(|d| {
            d.join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs")
                .join("Mynx")
                .join("Mynx.lnk")
                .exists()
        })
        .unwrap_or(true);
    do_install(
        &InstallOptions {
            install_path: dir,
            create_desktop_icon: desktop,
            create_start_menu: start_menu,
        },
        &|_, _, _| {},
        true, // 静默升级无 UI,装完需自动启动新版(updater 既有行为,保持不变)
    )?;
    Ok(())
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
    Ok((
        Some(path).filter(|s| !s.is_empty()),
        Some(ver).filter(|s| !s.is_empty()),
    ))
}

pub fn perform_uninstall(app: &AppHandle) -> Result<(), String> {
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

    let install_dir = validate_running_uninstaller(Path::new(&install_path))?;

    // Close the app only after confirming that this uninstaller is authorized
    // to remove the registered installation directory.
    emit("正在关闭 Mynx…", 20);
    stop_mynx_processes(&install_dir)?;

    let app_target = install_dir.join("mynx.exe");
    let uninstaller_target = install_dir.join("Uninst.exe");
    let mut shortcuts = Vec::new();
    if let Some(desktop) = dirs::desktop_dir() {
        shortcuts.push((desktop.join("Mynx.lnk"), app_target.clone()));
    }
    let start_menu_dir = dirs::data_dir().map(|path| {
        path.join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs")
            .join("Mynx")
    });
    if let Some(menu_dir) = &start_menu_dir {
        shortcuts.push((menu_dir.join("Mynx.lnk"), app_target));
        shortcuts.push((menu_dir.join("卸载 Mynx.lnk"), uninstaller_target));
    }

    emit("正在安排关闭窗口后的清理…", 70);
    schedule_uninstall_cleanup(&install_dir, &shortcuts, start_menu_dir.as_deref())?;

    // The cleanup helper removes the registry keys only after the running
    // uninstaller has exited and the installation directory was deleted.
    emit("已安排退出后清理", 100);
    Ok(())
}

fn validate_running_uninstaller(registered_dir: &Path) -> Result<PathBuf, String> {
    let install_dir = fs::canonicalize(registered_dir)
        .map_err(|error| format!("无法解析注册的安装目录: {error}"))?;
    if install_dir.parent().is_none() {
        return Err("拒绝卸载文件系统根目录".into());
    }

    let current_exe =
        std::env::current_exe().map_err(|error| format!("定位卸载程序失败: {error}"))?;
    let current_name = current_exe
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_default();
    if !current_name.eq_ignore_ascii_case("Uninst.exe") {
        return Err("当前程序不是安装目录中的 Mynx 卸载程序".into());
    }
    let current_parent = current_exe
        .parent()
        .ok_or_else(|| "无法解析卸载程序目录".to_string())?;
    let current_parent = fs::canonicalize(current_parent)
        .map_err(|error| format!("无法解析卸载程序目录: {error}"))?;
    if current_parent != install_dir {
        return Err("卸载程序与注册的安装目录不一致,为保护文件已停止卸载".into());
    }
    Ok(install_dir)
}

fn powershell_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn build_shortcut_cleanup_script(shortcuts: &[(PathBuf, PathBuf)]) -> String {
    let shortcuts = shortcuts
        .iter()
        .map(|(path, target)| {
            format!(
                "@{{ Path = {}; Target = {} }}",
                powershell_literal(&path.to_string_lossy()),
                powershell_literal(&target.to_string_lossy()),
            )
        })
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "$shell = $null; try {{ $shell = New-Object -ComObject WScript.Shell }} catch {{ }}; foreach ($shortcut in @({shortcuts})) {{ if ($shell -and (Test-Path -LiteralPath $shortcut.Path)) {{ try {{ $actualTarget = $shell.CreateShortcut($shortcut.Path).TargetPath; $actualFull = [System.IO.Path]::GetFullPath($actualTarget); $expectedFull = [System.IO.Path]::GetFullPath($shortcut.Target); if ([System.String]::Equals($actualFull, $expectedFull, [System.StringComparison]::OrdinalIgnoreCase)) {{ Remove-Item -LiteralPath $shortcut.Path -Force -ErrorAction SilentlyContinue }} }} catch {{ }} }} }};"
    )
}

fn build_uninstall_cleanup_script(
    process_id: u32,
    install_dir: &Path,
    shortcuts: &[(PathBuf, PathBuf)],
    start_menu_dir: Option<&Path>,
) -> String {
    let shortcut_cleanup = build_shortcut_cleanup_script(shortcuts);
    let menu_cleanup = start_menu_dir
        .map(|path| {
            let menu = powershell_literal(&path.to_string_lossy());
            format!(
                "$menu = {menu}; if (Test-Path -LiteralPath $menu) {{ $items = @(Get-ChildItem -LiteralPath $menu -Force -ErrorAction SilentlyContinue); if ($items.Count -eq 0) {{ Remove-Item -LiteralPath $menu -Force -ErrorAction SilentlyContinue }} }};"
            )
        })
        .unwrap_or_default();
    let install = powershell_literal(&install_dir.to_string_lossy());
    let hklm = powershell_literal(&format!(r"Registry::HKEY_LOCAL_MACHINE\{UNINSTALL_KEY}"));
    let hkcu = powershell_literal(&format!(r"Registry::HKEY_CURRENT_USER\{UNINSTALL_KEY}"));

    format!(
        "$ErrorActionPreference = 'Stop'; Wait-Process -Id {process_id} -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 150; {shortcut_cleanup} {menu_cleanup} $install = {install}; Remove-Item -LiteralPath $install -Recurse -Force -ErrorAction Stop; if (Test-Path -LiteralPath $install) {{ throw 'Mynx install directory still exists' }}; Remove-Item -LiteralPath {hklm} -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath {hkcu} -Recurse -Force -ErrorAction SilentlyContinue;"
    )
}

fn schedule_uninstall_cleanup(
    install_dir: &Path,
    shortcuts: &[(PathBuf, PathBuf)],
    start_menu_dir: Option<&Path>,
) -> Result<(), String> {
    let script =
        build_uninstall_cleanup_script(std::process::id(), install_dir, shortcuts, start_menu_dir);
    Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &script,
        ])
        .current_dir(std::env::temp_dir())
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法启动卸载清理进程: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory(label: &str) -> PathBuf {
        let token = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "mynx-installer-{label}-{}-{token}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create test directory");
        path
    }

    fn write_old_install(root: &Path) {
        fs::write(root.join("mynx.exe"), b"old app").expect("write old app");
        fs::write(root.join("Uninst.exe"), b"old uninstaller").expect("write old uninstaller");
        fs::create_dir_all(root.join("r")).expect("create old resources");
        fs::write(root.join("r/old.R"), b"old resource").expect("write old resource");
    }

    fn write_new_stage(stage: &Path, include_uninstaller: bool) {
        fs::create_dir_all(stage.join("r")).expect("create staged resources");
        fs::write(stage.join("mynx.exe"), b"new app").expect("write staged app");
        fs::write(stage.join("r/new.R"), b"new resource").expect("write staged resource");
        if include_uninstaller {
            fs::write(stage.join("Uninst.exe"), b"new uninstaller")
                .expect("write staged uninstaller");
        }
    }

    #[cfg(not(feature = "uninstaller"))]
    fn assert_uninstaller_size_is_reasonable(size: usize) {
        assert!(size > 0);
        assert!(size < 16 * 1024 * 1024);
    }

    #[test]
    fn staged_payload_replaces_old_files_and_removes_stale_resources() {
        let root = test_directory("commit");
        let stage = root.join("stage");
        write_old_install(&root);
        write_new_stage(&stage, true);

        commit_staged_payload(&root, &stage).expect("commit complete staged payload");

        assert_eq!(fs::read(root.join("mynx.exe")).unwrap(), b"new app");
        assert_eq!(
            fs::read(root.join("Uninst.exe")).unwrap(),
            b"new uninstaller"
        );
        assert_eq!(fs::read(root.join("r/new.R")).unwrap(), b"new resource");
        assert!(!root.join("r/old.R").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_staged_payload_restores_previous_install() {
        let root = test_directory("rollback");
        let stage = root.join("stage");
        write_old_install(&root);
        write_new_stage(&stage, false);

        assert!(commit_staged_payload(&root, &stage).is_err());

        assert_eq!(fs::read(root.join("mynx.exe")).unwrap(), b"old app");
        assert_eq!(
            fs::read(root.join("Uninst.exe")).unwrap(),
            b"old uninstaller"
        );
        assert_eq!(fs::read(root.join("r/old.R")).unwrap(), b"old resource");
        assert!(!root.join("r/new.R").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn temporary_space_includes_staged_install_and_extracted_exe() {
        assert_eq!(
            temporary_space_required_bytes(),
            estimated_installed_size_bytes() + MYNX_PAYLOAD_UNCOMPRESSED_SIZE
        );
    }

    /// 向导安装不得由后端自动启动应用。契约上不再有 launch_after / launched,
    /// 避免旧前端误传字段后又在后端触发 spawn,使「稍后启动」按钮失效。
    #[test]
    fn install_contract_has_no_auto_launch_flag() {
        let opts: InstallOptions = serde_json::from_str(
            r#"{"install_path":"C:\\Mynx","create_desktop_icon":true,"create_start_menu":true}"#,
        )
        .expect("wizard install options deserialize");
        assert_eq!(opts.install_path, r"C:\Mynx");
        assert!(opts.create_desktop_icon);
        assert!(opts.create_start_menu);

        // 即使旧前端误传 launch_after,契约也不识别它(serde 默认忽略未知键),
        // 后端因此没有自动启动的依据。
        let legacy: InstallOptions = serde_json::from_str(
            r#"{"install_path":"C:\\Mynx","create_desktop_icon":true,"create_start_menu":true,"launch_after":true}"#,
        )
        .expect("legacy field is ignored");
        assert_eq!(legacy.install_path, r"C:\Mynx");

        let result = InstallResult {
            install_path: r"C:\Mynx\mynx.exe".to_string(),
        };
        let json = serde_json::to_value(&result).expect("serialize install result");
        assert!(json.get("launched").is_none(), "result must not expose launched flag");
    }

    #[cfg(not(feature = "uninstaller"))]
    #[test]
    fn embedded_uninstaller_is_valid_and_keeps_the_install_footprint_small() {
        assert_eq!(MYNX_UNINSTALLER.len() as u64, MYNX_UNINSTALLER_SIZE);
        assert_uninstaller_size_is_reasonable(MYNX_UNINSTALLER.len());
        assert_eq!(&MYNX_UNINSTALLER[..2], b"MZ");
    }

    #[cfg(not(feature = "uninstaller"))]
    #[test]
    fn embedded_payload_decompresses_to_the_original_pe_size() {
        use std::io::Read;

        let mut decoder = flate2::read::GzDecoder::new(MYNX_PAYLOAD_GZIP);
        let mut payload = Vec::new();
        decoder
            .read_to_end(&mut payload)
            .expect("decompress embedded app");

        assert_eq!(payload.len() as u64, MYNX_PAYLOAD_UNCOMPRESSED_SIZE);
        assert_eq!(&payload[..2], b"MZ");
    }

    #[cfg(feature = "uninstaller")]
    #[test]
    fn uninstall_build_does_not_embed_install_payloads() {
        assert!(MYNX_PAYLOAD_GZIP.is_empty());
        assert_eq!(MYNX_PAYLOAD_UNCOMPRESSED_SIZE, 0);
        assert!(R_RESOURCES.is_empty());
        assert!(MYNX_UNINSTALLER.is_empty());
        assert_eq!(MYNX_UNINSTALLER_SIZE, 0);
    }

    #[test]
    fn install_path_probe_preserves_existing_user_file() {
        let root = test_directory("write-probe");
        let existing_probe = root.join(".mynx_write_test");
        fs::write(&existing_probe, b"user data").expect("write existing user file");
        let install_path = root.join("Mynx");

        let validated = validate_install_path(&install_path.to_string_lossy())
            .expect("validate writable parent");

        assert_eq!(validated, install_path);
        assert_eq!(fs::read(&existing_probe).unwrap(), b"user data");
        assert_eq!(
            fs::read_dir(&root).unwrap().filter_map(Result::ok).count(),
            1,
            "the temporary write probe must be removed"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn registry_rollback_restores_existing_values_and_removes_partial_values() {
        use winreg::enums::{HKEY_CURRENT_USER, REG_OPENED_EXISTING_KEY};
        use winreg::RegKey;

        let registry_root = RegKey::predef(HKEY_CURRENT_USER);
        let token = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let subkey = format!(
            "Software\\MynxInstallerTests-{}-{token}",
            std::process::id()
        );
        let (key, _) = registry_root
            .create_subkey(&subkey)
            .expect("create temporary registry key");
        key.set_value("InstallLocation", &"C:\\Old Mynx")
            .expect("write previous install path");
        key.set_value("KeepValue", &7u32)
            .expect("write existing value");
        let previous_values = key
            .enum_values()
            .collect::<std::io::Result<Vec<_>>>()
            .expect("snapshot registry values");
        key.set_value("InstallLocation", &"C:\\Partial Mynx")
            .expect("write partial new install path");
        key.set_value("NewValue", &"partial")
            .expect("write partial new value");

        let errors = rollback_registry_values(
            &registry_root,
            &subkey,
            key,
            REG_OPENED_EXISTING_KEY,
            &previous_values,
        );
        assert!(errors.is_empty(), "registry rollback errors: {errors:?}");

        let restored = registry_root
            .open_subkey(&subkey)
            .expect("open restored registry key");
        assert_eq!(
            restored.get_value::<String, _>("InstallLocation").unwrap(),
            "C:\\Old Mynx"
        );
        assert_eq!(restored.get_value::<u32, _>("KeepValue").unwrap(), 7);
        assert!(restored.get_value::<String, _>("NewValue").is_err());
        drop(restored);
        registry_root
            .delete_subkey_all(&subkey)
            .expect("remove temporary registry key");
    }

    #[test]
    fn registry_rollback_removes_a_new_entry() {
        use winreg::enums::{HKEY_CURRENT_USER, REG_CREATED_NEW_KEY};
        use winreg::RegKey;

        let registry_root = RegKey::predef(HKEY_CURRENT_USER);
        let token = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let subkey = format!(
            "Software\\MynxInstallerTests-{}-{token}",
            std::process::id()
        );
        let (key, disposition) = registry_root
            .create_subkey(&subkey)
            .expect("create temporary registry key");
        assert_eq!(disposition, REG_CREATED_NEW_KEY);
        key.set_value("PartialValue", &"partial")
            .expect("write partial value");

        let errors = rollback_registry_values(&registry_root, &subkey, key, disposition, &[]);
        assert!(errors.is_empty(), "registry rollback errors: {errors:?}");
        assert!(registry_root.open_subkey(&subkey).is_err());
    }

    #[test]
    fn uninstall_cleanup_quotes_paths_and_deletes_registry_after_install_dir() {
        let install_dir = PathBuf::from(r"C:\Program Files\Mynx $cache 'custom'");
        let shortcuts = vec![(
            PathBuf::from(r"C:\Users\Han\Desktop\Mynx.lnk"),
            install_dir.join("mynx.exe"),
        )];
        let menu_dir = PathBuf::from(r"C:\Users\Han\AppData\Roaming\Start Menu\Mynx");
        let script =
            build_uninstall_cleanup_script(4321, &install_dir, &shortcuts, Some(&menu_dir));

        let wait = script.find("Wait-Process -Id 4321").unwrap();
        let shortcut_check = script
            .find("[System.StringComparison]::OrdinalIgnoreCase")
            .unwrap();
        let delete_install = script.find("Remove-Item -LiteralPath $install").unwrap();
        let delete_registry = script.find("Registry::HKEY_LOCAL_MACHINE").unwrap();
        assert!(wait < shortcut_check && shortcut_check < delete_install);
        assert!(delete_install < delete_registry);
        assert!(script.contains("'C:\\Program Files\\Mynx $cache ''custom'''"));
        assert!(script.contains("'C:\\Users\\Han\\Desktop\\Mynx.lnk'"));
        assert!(script.contains("'C:\\Program Files\\Mynx $cache ''custom''\\mynx.exe'"));
        assert!(script.contains("$shell.CreateShortcut($shortcut.Path).TargetPath"));
        assert!(!script.contains("foreach ($link in @("));
    }

    #[test]
    fn uninstall_shortcut_cleanup_preserves_links_for_other_installations() {
        let root = test_directory("shortcut-owner");
        let install_dir = root.join("isolated install");
        let other_install = root.join("existing install");
        fs::create_dir_all(&install_dir).unwrap();
        fs::create_dir_all(&other_install).unwrap();

        let owned_target = install_dir.join("mynx.exe");
        let other_target = other_install.join("mynx.exe");
        let owned_link = root.join("owned Mynx.lnk");
        let other_link = root.join("existing Mynx.lnk");
        create_shortcut(
            &owned_target.to_string_lossy(),
            &owned_link.to_string_lossy(),
            &install_dir.to_string_lossy(),
            &owned_target.to_string_lossy(),
            None,
        )
        .expect("create shortcut for isolated installation");
        create_shortcut(
            &other_target.to_string_lossy(),
            &other_link.to_string_lossy(),
            &other_install.to_string_lossy(),
            &other_target.to_string_lossy(),
            None,
        )
        .expect("create shortcut for existing installation");

        let script = build_shortcut_cleanup_script(&[
            (owned_link.clone(), owned_target.clone()),
            (other_link.clone(), owned_target),
        ]);
        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &script,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .expect("run isolated shortcut cleanup script");
        assert!(
            output.status.success(),
            "shortcut cleanup failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(!owned_link.exists(), "owned shortcut should be removed");
        assert!(
            other_link.exists(),
            "shortcut for another install must remain"
        );

        fs::remove_dir_all(root).unwrap();
    }
}
