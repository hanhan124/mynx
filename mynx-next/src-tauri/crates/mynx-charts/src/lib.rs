//! Scientific chart studio services.
//!
//! Port of the legacy chart-studio frontend layer
//! (`src/pages/charts/ChartStudioPage.tsx` import/export/package flows plus
//! `src/lib/charts/runner.ts` event/sidecar handling) with the fs-plugin and
//! JSZip calls replaced by direct filesystem + `zip` crate access:
//!
//! - [`io`]       — data import (`csv`/`tsv`/`txt`/`xlsx`/`xls`) for field
//!   mapping: first row is the header, cells become JSON numbers where
//!   parseable and strings otherwise
//! - [`manifest`] — template manifest reads and the installed-template listing
//!   under `<resource_dir>/r/chart-templates`
//! - [`package`]  — figure ZIP export (`export_zip`) and safe template
//!   package installation (`install_template_package`, zip-slip hardened)
//! - [`run`]      — `chart_event` line parsing, the sidecar JSON writer and
//!   output-file scanning for the run command adapter
//!
//! Error messages keep the legacy wording; the contract types live in
//! [`mynx_contracts::charts`].

pub mod io;
pub mod manifest;
pub mod package;
pub mod run;

pub use io::import_data;
pub use manifest::{list_templates, read_manifest};
pub use package::{export_zip, install_template_package};
pub use run::{
    chart_event_from_line, chart_run_config_from_value, list_output_files, output_file_path,
    write_sidecar,
};

