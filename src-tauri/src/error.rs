use thiserror::Error;

#[derive(Debug, Error)]
pub enum CommandError {
    #[error("Failed to resolve executable path: {0}")]
    ExePath(String),
    #[error("Filesystem error: {0}")]
    Io(String),
    #[error("Failed to run Tauri application: {0}")]
    Builder(String),
    #[error("Network request failed: {0}")]
    Network(String),
    #[error("Search response could not be parsed: {0}")]
    Search(String),
}

impl serde::Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
