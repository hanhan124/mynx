//! Internal helpers shared by the transform and calculate stages: random
//! access over a [`SheetSnapshot`] and incremental construction of a
//! [`SheetPatch`].

use std::collections::HashMap;

use mynx_contracts::qpcr::{CellValue, PatchCell, PatchRow, PatchValue, SheetPatch, SheetSnapshot};

use crate::jsval::display_length;

// ── Snapshot access ─────────────────────────────────────────────────────────

/// Random-access view over a [`SheetSnapshot`]. The worker emits rows/cells
/// sparsely; every lookup defaults to an empty, unstyled cell exactly like
/// ExcelJS's `getRow().getCell()` on a never-touched position.
pub struct SheetView<'a> {
    sheet: &'a SheetSnapshot,
    cells: HashMap<(u32, u32), &'a mynx_contracts::qpcr::CellSnapshot>,
}

impl<'a> SheetView<'a> {
    pub fn new(sheet: &'a SheetSnapshot) -> Self {
        let mut cells = HashMap::new();
        for row in &sheet.rows {
            for cell in &row.cells {
                cells.insert((row.row, cell.col), cell);
            }
        }
        Self { sheet, cells }
    }

    pub fn row_count(&self) -> u32 {
        self.sheet.row_count
    }

    pub fn column_count(&self) -> u32 {
        self.sheet.column_count
    }

    pub fn name(&self) -> &str {
        &self.sheet.name
    }

    /// Value + yellow-imputation flag at a 1-based (row, col) position.
    pub fn cell(&self, row: u32, col: u32) -> (&'a CellValue, bool) {
        match self.cells.get(&(row, col)) {
            Some(cell) => (&cell.value, cell.yellow_fill),
            None => (&CellValue::Empty, false),
        }
    }
}

// ── Patch construction ──────────────────────────────────────────────────────

/// Solid ARGB fills used by the generated sheets. Values mirror the legacy
/// constants verbatim, including the 6-digit forms ExcelJS stores as-is.
pub mod fills {
    /// Imputed/missing-value marker (yellow).
    pub const YELLOW: &str = "FFFFFF00";
    /// Identity headers (Num/Group, Gene/Group_Name).
    pub const HEADER_IDENTITY: &str = "DDEBF7";
    /// Repeat columns.
    pub const HEADER_REPEATS: &str = "BDD7EE";
    /// Average / Stdev.
    pub const HEADER_STATS: &str = "E2EFDA";
    /// Method.
    pub const HEADER_METHOD: &str = "FCE4D6";
    /// `{refGene}_Ct_R*`.
    pub const HEADER_REF_CT: &str = "FFF2CC";
    /// `Target_Ct_R*`.
    pub const HEADER_TARGET_CT: &str = "E4DFEC";
    /// Outlier `Removed` header.
    pub const REMOVED: &str = "F2F2F2";
}

// Note: the light-blue identity data fill (EAF3FA) never appears as a
// per-cell fill — it is expressed through `SheetPatch::identity_fill_cols`
// and applied by the renderer to data rows (row ≥ 2).

/// Incremental builder for one [`SheetPatch`]. Rows may be appended
/// sequentially ([`PatchSheetBuf::push_row`]) or addressed directly
/// ([`PatchSheetBuf::write_row_at`]/[`PatchSheetBuf::write_cell`]); the grid
/// is padded to a common width in [`PatchSheetBuf::build`] so the patch is a
/// full rectangle with explicit [`PatchValue::Empty`] holes.
pub struct PatchSheetBuf {
    pub name: String,
    rows: Vec<Vec<PatchCell>>,
    pub font_name: String,
    pub left_align: bool,
    pub identity_fill_cols: Vec<u32>,
    pub freeze_x: u32,
    pub freeze_y: u32,
    /// `None` = sheet carries no column widths (legacy gene sheets);
    /// `Some` = widths for columns 1..=width.
    pub col_widths: Option<Vec<f64>>,
    pub a1_note: Option<String>,
}

impl PatchSheetBuf {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            rows: Vec::new(),
            font_name: String::new(),
            left_align: false,
            identity_fill_cols: Vec::new(),
            freeze_x: 0,
            freeze_y: 0,
            col_widths: None,
            a1_note: None,
        }
    }

    /// Number of rows so far; the 1-based index the next sequential row
    /// will occupy.
    pub fn next_row(&self) -> u32 {
        (self.rows.len() + 1) as u32
    }

    /// Appends one row sequentially.
    pub fn push_row(&mut self, cells: Vec<PatchCell>) {
        self.rows.push(cells);
    }

    /// Writes a full row at a 1-based position, extending the grid (with
    /// empty rows) when the position lies beyond it. Replaces any previous
    /// content of the row.
    pub fn write_row_at(&mut self, row: u32, mut cells: Vec<PatchCell>) {
        let idx = row as usize - 1;
        if self.rows.len() <= idx {
            self.rows.resize_with(idx + 1, Vec::new);
        }
        let existing = &mut self.rows[idx];
        if existing.len() > cells.len() {
            cells.resize(existing.len(), cell::empty());
        }
        self.rows[idx] = cells;
    }

    /// Writes a single cell at a 1-based (row, col) position.
    pub fn write_cell(&mut self, row: u32, col: u32, cell: PatchCell) {
        let idx = row as usize - 1;
        let ci = col as usize - 1;
        if self.rows.len() <= idx {
            self.rows.resize_with(idx + 1, Vec::new);
        }
        let r = &mut self.rows[idx];
        if r.len() <= ci {
            r.resize(ci + 1, cell::empty());
        }
        r[ci] = cell;
    }

    /// Mutable access to the first row (used to append trailing header
    /// columns such as the outlier sheet's `Removed`).
    pub fn header_row_mut(&mut self) -> &mut Vec<PatchCell> {
        if self.rows.is_empty() {
            self.rows.push(Vec::new());
        }
        &mut self.rows[0]
    }

    /// Recomputes column widths exactly like the legacy
    /// `sheet.columns.forEach` width pass: for every column, the maximum
    /// rendered length across all rows that have values (ExcelJS
    /// `Column.eachCell` also visits empty cells of such rows, and falsy
    /// values contribute the fixed length 10); the first two columns get a
    /// +6 bonus.
    pub fn apply_auto_widths(&mut self) {
        let width = self.rows.iter().map(Vec::len).max().unwrap_or(0);
        let mut widths = Vec::with_capacity(width);
        for c in 0..width {
            let mut max_len = 0usize;
            for row in &self.rows {
                // Legacy `eachRow` only visits rows with at least one
                // non-null cell (row.hasValues).
                if !row_has_values(row) {
                    continue;
                }
                let len = row.get(c).map(cell_display_length).unwrap_or(10);
                max_len = max_len.max(len);
            }
            widths.push((max_len + if c < 2 { 6 } else { 0 }) as f64);
        }
        self.col_widths = Some(widths);
    }

    pub fn build(mut self) -> SheetPatch {
        // Pad the grid into a full rectangle.
        let width = self.rows.iter().map(Vec::len).max().unwrap_or(0);
        for row in &mut self.rows {
            row.resize(width, cell::empty());
        }
        SheetPatch {
            name: self.name,
            rows: self
                .rows
                .into_iter()
                .map(|cells| PatchRow { cells })
                .collect(),
            font_name: self.font_name,
            left_align: self.left_align,
            identity_fill_cols: self.identity_fill_cols,
            freeze_x: self.freeze_x,
            freeze_y: self.freeze_y,
            col_widths: self.col_widths.unwrap_or_default(),
            a1_note: self.a1_note,
        }
    }
}

/// Constructors for [`PatchCell`] (a foreign type from `mynx-contracts`, so
/// it cannot take an inherent impl here).
pub mod cell {
    use super::PatchCell;
    use mynx_contracts::qpcr::PatchValue;

    pub fn empty() -> PatchCell {
        PatchCell {
            value: PatchValue::Empty,
            bold: false,
            fill: None,
            bottom_border: false,
        }
    }

    pub fn num(value: f64) -> PatchCell {
        PatchCell {
            value: PatchValue::Num(value),
            bold: false,
            fill: None,
            bottom_border: false,
        }
    }

    pub fn text(value: impl Into<String>) -> PatchCell {
        PatchCell {
            value: PatchValue::Text(value.into()),
            bold: false,
            fill: None,
            bottom_border: false,
        }
    }

    /// Summary/transform header cell: bold, medium bottom border, optional
    /// solid fill.
    pub fn header(value: impl Into<String>, fill: Option<&str>) -> PatchCell {
        PatchCell {
            value: PatchValue::Text(value.into()),
            bold: true,
            fill: fill.map(str::to_string),
            bottom_border: true,
        }
    }

    /// Gene-sheet / chart-table header cell: bold only (legacy sets just
    /// the bold Times New Roman font, no fill and no border).
    pub fn bold_text(value: impl Into<String>) -> PatchCell {
        PatchCell {
            value: PatchValue::Text(value.into()),
            bold: true,
            fill: None,
            bottom_border: false,
        }
    }
}

/// A row "has values" when at least one cell is not empty (ExcelJS
/// `row.hasValues`).
fn row_has_values(row: &[PatchCell]) -> bool {
    row.iter()
        .any(|cell| !matches!(cell.value, PatchValue::Empty))
}

/// Number of rendered characters a cell contributes to column-width
/// computation (legacy `cell.value ? displayLength(String(cell.value)) : 10`
/// where falsy = 0 / NaN / empty string / empty cell).
pub fn cell_display_length(cell: &PatchCell) -> usize {
    match &cell.value {
        PatchValue::Num(n) if *n != 0.0 && !n.is_nan() => {
            display_length(&crate::jsval::js_number_to_string(*n))
        }
        PatchValue::Text(s) if !s.is_empty() => display_length(s),
        _ => 10,
    }
}
