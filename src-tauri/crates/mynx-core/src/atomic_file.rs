//! Crash-safe file replacement: write a temp file in the target's folder,
//! flush it to disk, then rename it over the target. A crash or power loss
//! leaves either the old file or the new one — never a half-written file.

use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use mynx_contracts::task::MynxError;

const WORKBOOK_EXTENSIONS: [&str; 2] = ["xlsx", "xlsm"];

/// Replace an existing Excel workbook (qPCR saves results back into the
/// user's source file). Only existing `.xlsx` / `.xlsm` files are accepted.
pub fn replace_workbook(path: &str, bytes: &[u8]) -> Result<(), MynxError> {
    let target = Path::new(path);
    let is_workbook = target
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| WORKBOOK_EXTENSIONS.iter().any(|w| ext.eq_ignore_ascii_case(w)));
    if !is_workbook {
        return Err(MynxError::validation(format!("只能保存 .xlsx / .xlsm 工作簿: {path}")));
    }
    if !target.is_file() {
        return Err(MynxError::validation(format!("原工作簿不存在: {path}")));
    }
    if bytes.is_empty() {
        return Err(MynxError::validation("工作簿内容为空，已取消保存"));
    }
    replace_file(target, bytes)
}

/// Atomically replace `target` with `bytes` (temp file + fsync + rename).
pub fn replace_file(target: &Path, bytes: &[u8]) -> Result<(), MynxError> {
    let dir = target
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    let temp = dir.join(format!(".{name}.mynx-{}-{nanos}.tmp", std::process::id()));

    let written = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()
    })();
    if let Err(error) = written {
        let _ = fs::remove_file(&temp);
        return Err(MynxError::io(format!("无法写入临时文件: {error}")));
    }
    // std::fs::rename replaces an existing target on Windows and Unix.
    if let Err(error) = fs::rename(&temp, target) {
        let _ = fs::remove_file(&temp);
        return Err(MynxError::io(format!(
            "无法替换原文件（可能正在 Excel 中打开）: {error}"
        )));
    }
    Ok(())
}

/// Decode a `encodeURIComponent` value (used for non-ASCII paths carried in
/// IPC headers). `None` for malformed escapes or invalid UTF-8.
pub fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = value.get(index + 1..index + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("mynx_atomic_{name}_{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn replaces_an_existing_workbook_and_leaves_no_temp_file() {
        let dir = temp_dir("replace");
        let path = dir.join("实验 1.xlsx");
        fs::write(&path, b"old").unwrap();
        replace_workbook(&path.to_string_lossy(), b"new bytes").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new bytes");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_missing_files_other_types_and_empty_content() {
        let dir = temp_dir("reject");
        let missing = dir.join("missing.xlsx");
        assert!(replace_workbook(&missing.to_string_lossy(), b"x").is_err());
        let text = dir.join("notes.txt");
        fs::write(&text, b"old").unwrap();
        assert!(replace_workbook(&text.to_string_lossy(), b"x").is_err());
        let book = dir.join("a.xlsx");
        fs::write(&book, b"old").unwrap();
        assert!(replace_workbook(&book.to_string_lossy(), b"").is_err());
        assert_eq!(fs::read(&book).unwrap(), b"old");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn decodes_uri_components() {
        assert_eq!(
            percent_decode("D%3A%5C%E6%95%B0%E6%8D%AE%5Ca%20b.xlsx").as_deref(),
            Some("D:\\数据\\a b.xlsx")
        );
        assert_eq!(percent_decode("bad%zz"), None);
        assert_eq!(percent_decode("cut%E6"), None);
    }
}
