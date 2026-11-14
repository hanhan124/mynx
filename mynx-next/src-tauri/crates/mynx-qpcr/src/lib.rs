//! qPCR transform/calculate pipeline.
//!
//! Rust owns the entire transform/calculate pipeline; the ExcelJS
//! compatibility worker is a dumb renderer that applies [`WorkbookPatch`]
//! instructions and round-trips the workbook bytes. Every sheet value,
//! imputation flag, style decision and derived summary sheet is computed
//! here so results stay numerically identical to the legacy TS
//! (`src/lib/qpcr-transform.ts` / `src/lib/qpcr-calculate.ts`) and VBA
//! implementations.
//!
//! Golden fixtures under `tests/fixtures/` pin the parity: a Node generator
//! replays the legacy TypeScript on a synthetic workbook and dumps both the
//! input sheet snapshots and the expected results; `tests/golden.rs` replays
//! the same snapshots through this crate and compares.

pub mod charts;
mod calculate;
mod jsval;
mod sheet;
mod transform;

pub use calculate::calculate;
pub use charts::inject_charts;
pub use transform::transform;

pub use mynx_contracts::task::MynxError;
