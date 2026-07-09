// elevate.rs — 检测管理员权限 + 以管理员身份重新启动自身
use std::process::Command;

#[cfg(windows)]
pub fn is_elevated() -> bool {
    // 用 `whoami /groups` 解析是否包含 "S-1-16-12288" (Mandatory Label\High Mandatory Level)
    // 用 CREATE_NO_WINDOW 隐藏弹窗
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let output = Command::new("whoami")
        .arg("/groups")
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    match output {
        Ok(out) => {
            let s = String::from_utf8_lossy(&out.stdout);
            s.contains("S-1-16-12288")
                || s.contains("High Mandatory Level")
                || s.contains("已启用")
        }
        Err(_) => false,
    }
}

#[cfg(not(windows))]
pub fn is_elevated() -> bool {
    true
}

#[cfg(windows)]
pub fn relaunch_as_admin() {
    use std::os::windows::ffi::OsStrExt;
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(_) => return,
    };
    let exe_w: Vec<u16> = exe.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let verb_w: Vec<u16> = "runas\0".encode_utf16().collect();

    unsafe {
        // 用 ShellExecuteW + lpVerb="runas" → 触发 UAC 弹窗
        let result = windows::Win32::UI::Shell::ShellExecuteW(
            None,
            windows::core::PCWSTR(verb_w.as_ptr()),
            windows::core::PCWSTR(exe_w.as_ptr()),
            None,
            None,
            windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL,
        );
        // result 是 HINSTANCE; >32 表示成功
        if result.0 as usize > 32 {
            std::process::exit(0); // 当前非提权进程退出,等待提权副本接管
        }
    }
}