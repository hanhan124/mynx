//! Command-layer error adapter. Services return `MynxError` directly; this
//! enum exists only for command-adapter plumbing errors and re-exposes the
//! contract error as the command return type.

use mynx_contracts::task::MynxError;

/// Commands return `Result<T, CommandError>`; `CommandError` wraps the
/// structured contract error, which serializes as `{ v, code, message }`.
pub type CommandError = MynxError;

/// Convenience constructor used by adapters.
pub fn internal(message: impl Into<String>) -> CommandError {
    MynxError::internal(message)
}

pub fn io(message: impl Into<String>) -> CommandError {
    MynxError::io(message)
}

pub fn validation(message: impl Into<String>) -> CommandError {
    MynxError::validation(message)
}
