//! RNA-seq counts import and run-directory services.
//!
//! 1:1 port of the legacy TypeScript layer
//! (`src/lib/rnaseq/{io,matrix,results}.ts` plus the matrix worker) with the
//! fs-plugin/PowerShell fallbacks replaced by direct filesystem access:
//!
//! - [`io`]     — path helpers, UTF-8 text reads, Excel workbook reads (calamine)
//! - [`matrix`] — delimited parsing, matrix normalization, input options
//!   (duplicate genes / rounding, R engine `clean_counts` semantics) and the
//!   [`import_counts`](matrix::import_counts) entry point
//! - [`results`] — run-dir scanning, params restore (deep-merge), DE summary
//!
//! Parsing/normalization semantics, warning strings and error messages stay
//! byte-identical to the legacy layer; the assertions from
//! `scripts/rnaseq-matrix-smoke.ts` run as Rust unit tests in [`matrix`].

pub mod io;
pub mod matrix;
pub mod results;

pub use matrix::import_counts;
pub use results::{
    has_de_result, is_run_dir, list_result_files, list_run_dirs, load_run_params,
    merge_params, merge_run_params, read_de_summary, RESULT_IMAGE_DIRS,
};
