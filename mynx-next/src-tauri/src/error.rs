//! Command-layer error adapter. Services return `MynxError` directly; this
//! alias exists only for command-adapter readability and re-exposes the
//! contract error as the command return type.

use mynx_contracts::task::MynxError;

/// Commands return `Result<T, CommandError>`; `CommandError` serializes as
/// the structured contract error `{ v, code, message }`.
pub type CommandError = MynxError;
