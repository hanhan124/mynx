//! Image → PNG batch conversion service.
//!
//! All decoding / compression / watermarking is delegated to established
//! open-source crates rather than hand-rolled codecs:
//! - `image` (image-rs): decode PNG/JPEG/TIFF/WebP/BMP/GIF/ICO/TGA/PNM/QOI/DDS
//! - `resvg`: SVG rasterization
//! - `oxipng`: lossless PNG optimization (both modes end with it)
//! - `color_quant` + `png`: lossy palette-quantized (indexed-color) PNG output
//! - `kamadak-exif`: EXIF orientation auto-correction
//! - `imageproc` + `ab_glyph`: text watermark drawing

use std::collections::{BTreeSet, HashMap, HashSet};
use std::io::{BufReader, BufWriter, Cursor};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use ab_glyph::FontArc;
use base64::Engine as _;
use image::{DynamicImage, ImageFormat, ImageReader, RgbaImage};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

/// Supported input formats (by extension). Output is always PNG.
pub const SUPPORTED_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "jfif", "tif", "tiff", "webp", "bmp", "gif", "ico", "tga", "pnm", "pbm",
    "pgm", "ppm", "pam", "qoi", "dds", "svg",
];

/// Range `image`'s own PNG encoder can write for DynamicImage inputs.
/// (`oxipng` optimizes whatever comes out.)
const OXIPNG_MAX_PRESET: u8 = 6;

// ---------------------------------------------------------------- data model

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertOptions {
    /// Input files (already expanded from folders on the Rust side).
    pub files: Vec<String>,
    /// "lossless" (re-encode + oxipng) or "lossy" (palette quantization).
    #[serde(default = "default_lossless")]
    pub mode: String,
    /// UI strength 1=fast / 2=balanced / 3=max, mapped onto oxipng presets.
    #[serde(default = "default_strength")]
    pub optimize_level: u8,
    /// Palette size for lossy mode.
    #[serde(default = "default_colors")]
    pub colors: u32,
    /// Floyd–Steinberg dithering for lossy mode.
    #[serde(default = "default_true")]
    pub dither: bool,
    /// "subfolder" (default), "alongside" or "custom".
    #[serde(default = "default_output_mode")]
    pub output_mode: String,
    #[serde(default)]
    pub custom_dir: Option<String>,
    #[serde(default)]
    pub watermark: Option<WatermarkOptions>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkOptions {
    /// "text" or "image".
    #[serde(default = "default_text")]
    pub kind: String,
    /// Watermark text; empty / None means "use the file name".
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default = "default_font")]
    pub font: Option<String>,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default)]
    pub bold: bool,
    /// "white" or "black".
    #[serde(default = "default_color")]
    pub color: String,
    /// 0..1 applied to text/logo alpha.
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    /// Nine-grid key ("top-left" … "bottom-right") or "tile".
    #[serde(default = "default_position")]
    pub position: String,
    /// Text pill background: "none" | "opaque" | "semi" | "light".
    #[serde(default = "default_background")]
    pub background: String,
    /// Logo image path for kind = "image".
    #[serde(default)]
    pub image_path: Option<String>,
    /// Logo width as a fraction of the target image's smaller side.
    #[serde(default = "default_logo_scale")]
    pub scale: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConvertEvent {
    Started { total: u32 },
    Item {
        index: u32,
        total: u32,
        source: String,
        /// "ok" | "failed"
        status: String,
        outputs: Vec<String>,
        error: Option<String>,
        original_bytes: u64,
        output_bytes: u64,
    },
    Finished {
        /// "completed" | "cancelled"
        status: String,
        ok: u32,
        failed: u32,
        total_input: u64,
        total_output: u64,
        /// false when a text watermark was requested but no usable font was found.
        watermark_applied: bool,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thumbnail {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub file_size: u64,
}

fn default_lossless() -> String {
    "lossless".into()
}
fn default_strength() -> u8 {
    2
}
fn default_colors() -> u32 {
    256
}
fn default_true() -> bool {
    true
}
fn default_output_mode() -> String {
    "subfolder".into()
}
fn default_text() -> String {
    "text".into()
}
fn default_font() -> Option<String> {
    None
}
fn default_font_size() -> u32 {
    72
}
fn default_color() -> String {
    "white".into()
}
fn default_opacity() -> f64 {
    0.85
}
fn default_position() -> String {
    "bottom-right".into()
}
fn default_background() -> String {
    "none".into()
}
fn default_logo_scale() -> f64 {
    0.25
}

// ------------------------------------------------------------- task registry

static NEXT_TASK_ID: AtomicU64 = AtomicU64::new(1);
static CANCELS: std::sync::OnceLock<Mutex<HashMap<u64, Arc<AtomicBool>>>> =
    std::sync::OnceLock::new();

fn cancels() -> &'static Mutex<HashMap<u64, Arc<AtomicBool>>> {
    CANCELS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Removes the cancel flag of a finished task even if the worker panicked.
struct RegistryGuard(u64);

impl Drop for RegistryGuard {
    fn drop(&mut self) {
        if let Ok(mut map) = cancels().lock() {
            map.remove(&self.0);
        }
    }
}

/// Spawns a background conversion job and returns its task id.
pub(crate) fn start(options: ConvertOptions, on_progress: Channel<ConvertEvent>) -> u64 {
    let id = NEXT_TASK_ID.fetch_add(1, Ordering::SeqCst);
    let cancelled = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = cancels().lock() {
        map.insert(id, cancelled.clone());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = RegistryGuard(id);
        let _ = run(&options, &on_progress, &cancelled);
    });
    id
}

/// Signals cancellation for a running task. Returns false for unknown ids.
pub(crate) fn cancel(task_id: u64) -> bool {
    let flag = match cancels().lock() {
        Ok(map) => map.get(&task_id).cloned(),
        Err(_) => None,
    };
    match flag {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            true
        }
        None => false,
    }
}

// -------------------------------------------------------------------- runner

fn run(
    options: &ConvertOptions,
    channel: &Channel<ConvertEvent>,
    cancelled: &AtomicBool,
) {
    let files = collect_files(&options.files);
    let total = files.len() as u32;
    let _ = channel.send(ConvertEvent::Started { total });

    if total == 0 {
        let _ = channel.send(ConvertEvent::Finished {
            status: "completed".into(),
            ok: 0,
            failed: 0,
            total_input: 0,
            total_output: 0,
            watermark_applied: false,
        });
        return;
    }

    // Watermark preparation (lazy + optional).
    let watermark = options.watermark.as_ref();
    let mut font: Option<FontArc> = None;
    let mut logo: Option<RgbaImage> = None;
    let mut watermark_applied = watermark.is_none();
    if let Some(wm) = watermark {
        if wm.kind == "image" {
            logo = wm
                .image_path
                .as_deref()
                .and_then(load_watermark_logo)
                .map(|img| apply_logo_opacity(img, wm.opacity));
            watermark_applied = logo.is_some();
        } else {
            let name = wm.font.as_deref().unwrap_or("");
            font = load_watermark_font(name);
            watermark_applied = font.is_some();
        }
    }

    let ts = timestamp();
    let taken: Arc<Mutex<HashSet<PathBuf>>> = Arc::new(Mutex::new(HashSet::new()));
    let totals: Mutex<(u64, u64, u32, u32)> = Mutex::new((0, 0, 0, 0)); // in, out, ok, failed

    let threads = available_parallelism().min(4).min(files.len()).max(1);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .build();
    let pool = match pool {
        Ok(pool) => pool,
        Err(_) => return,
    };

    pool.install(|| {
        files.par_iter().enumerate().for_each(|(index, path)| {
            if cancelled.load(Ordering::SeqCst) {
                return;
            }
            let source = path.clone();
            let input_path = Path::new(path.as_str());
            let original_bytes = std::fs::metadata(input_path).map(|m| m.len()).unwrap_or(0);
            let event = match convert_file(
                input_path,
                options,
                font.as_ref(),
                logo.as_ref(),
                &ts,
                &taken,
            ) {
                Ok(outputs) => {
                    let output_bytes: u64 = outputs.iter().map(|(_, bytes)| bytes).sum();
                    let outputs = outputs
                        .into_iter()
                        .map(|(path, _)| path.to_string_lossy().to_string())
                        .collect();
                    ConvertEvent::Item {
                        index: index as u32,
                        total,
                        source,
                        status: "ok".into(),
                        outputs,
                        error: None,
                        original_bytes,
                        output_bytes,
                    }
                }
                Err(error) => ConvertEvent::Item {
                    index: index as u32,
                    total,
                    source,
                    status: "failed".into(),
                    outputs: vec![],
                    error: Some(error),
                    original_bytes,
                    output_bytes: 0,
                },
            };
            if let ConvertEvent::Item {
                status,
                original_bytes,
                output_bytes,
                ..
            } = &event
            {
                if let Ok(mut totals) = totals.lock() {
                    totals.0 += original_bytes;
                    totals.1 += output_bytes;
                    if status == "ok" {
                        totals.2 += 1;
                    } else {
                        totals.3 += 1;
                    }
                }
            }
            let _ = channel.send(event);
        });
    });

    let (total_input, total_output, ok, failed) = totals
        .into_inner()
        .unwrap_or((0, 0, 0, 0));
    let _ = channel.send(ConvertEvent::Finished {
        status: if cancelled.load(Ordering::SeqCst) {
            "cancelled".into()
        } else {
            "completed".into()
        },
        ok,
        failed,
        total_input,
        total_output,
        watermark_applied,
    });
}

fn available_parallelism() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2)
}

// ------------------------------------------------------------ file expansion

/// Expands the given paths into a sorted, de-duplicated list of supported
/// image files. Directories are walked recursively (symlinks are not followed).
pub(crate) fn collect_files(paths: &[String]) -> Vec<String> {
    let mut found = BTreeSet::new();
    for raw in paths {
        let path = PathBuf::from(raw);
        match std::fs::metadata(&path) {
            Ok(meta) if meta.is_dir() => walk_dir(&path, 0, &mut found),
            Ok(_) => {
                if is_supported(&path) {
                    found.insert(path);
                }
            }
            Err(_) => {}
        }
    }
    found
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

fn walk_dir(dir: &Path, depth: usize, found: &mut BTreeSet<PathBuf>) {
    if depth > 16 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            walk_dir(&path, depth + 1, found);
        } else if file_type.is_file() && is_supported(&path) {
            found.insert(path);
        }
    }
}

pub(crate) fn is_supported(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let ext = ext.to_ascii_lowercase();
            SUPPORTED_EXTENSIONS.contains(&ext.as_str())
        })
        .unwrap_or(false)
}

// ------------------------------------------------------------- conversion core

enum Decoded {
    Single(DynamicImage),
    Pages(Vec<RgbaImage>),
}

fn convert_file(
    input: &Path,
    options: &ConvertOptions,
    font: Option<&FontArc>,
    logo: Option<&RgbaImage>,
    ts: &str,
    taken: &Mutex<HashSet<PathBuf>>,
) -> Result<Vec<(PathBuf, u64)>, String> {
    let decoded = decode(input)?;

    // Watermarking forces RGBA8; without it the lossless path keeps the
    // original color type / bit depth (e.g. 16-bit gray TIFF → 16-bit PNG).
    // A watermark whose resources failed to load is silently dropped (the
    // Finished event reports watermarkApplied = false).
    let watermark = options.watermark.as_ref().filter(|wm| match wm.kind.as_str() {
        "image" => logo.is_some(),
        _ => font.is_some(),
    });

    let dir = output_dir_for(input, options, ts)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建输出目录失败: {e}"))?;

    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "image".into());

    enum Page {
        Rgba(RgbaImage),
        Native(DynamicImage),
    }
    let pages: Vec<Page> = match decoded {
        Decoded::Pages(mut pages) => {
            if let Some(wm) = watermark {
                for page in &mut pages {
                    apply_watermark(page, wm, &stem, font, logo);
                }
            }
            pages.into_iter().map(Page::Rgba).collect()
        }
        Decoded::Single(img) => match (watermark, options.mode.as_str()) {
            // Watermarking forces RGBA8.
            (Some(wm), _) => {
                let mut rgba = img.to_rgba8();
                apply_watermark(&mut rgba, wm, &stem, font, logo);
                vec![Page::Rgba(rgba)]
            }
            // Lossy mode quantizes, so the buffer must be RGBA8 as well.
            (None, "lossy") => vec![Page::Rgba(img.to_rgba8())],
            // Lossless without watermark keeps the original color type / bit
            // depth (e.g. 16-bit gray scientific TIFF → 16-bit PNG).
            (None, _) => vec![Page::Native(img)],
        },
    };

    let multi = pages.len() > 1;
    let mut results = Vec::new();
    for (idx, page) in pages.into_iter().enumerate() {
        let name = if multi {
            format!("{}_p{}.png", stem, idx + 1)
        } else {
            format!("{stem}.png")
        };
        let candidate = dir.join(name);
        let output = unique_output(candidate, input, taken);

        let png_bytes = match page {
            Page::Native(img) => encode_lossless_native(&img)?,
            Page::Rgba(rgba) => encode(rgba, options)?,
        };
        let optimized = optimize_png(&png_bytes, oxipng_preset(options))?;

        std::fs::write(&output, &optimized)
            .map_err(|e| format!("写入 {} 失败: {e}", output.display()))?;
        results.push((output, optimized.len() as u64));
    }
    Ok(results)
}

fn decode(path: &Path) -> Result<Decoded, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    if ext == "svg" {
        let bytes = std::fs::read(path).map_err(|e| format!("读取文件失败: {e}"))?;
        return Ok(Decoded::Pages(vec![render_svg(&bytes)?]));
    }

    if matches!(ext.as_str(), "tif" | "tiff") {
        // image-rs only exposes page 1; the tiff crate walks every page.
        if let Some(pages) = decode_multipage_tiff(path) {
            if pages.len() > 1 {
                return Ok(Decoded::Pages(pages));
            }
        }
    }

    let mut reader = ImageReader::open(path).map_err(|e| format!("读取文件失败: {e}"))?
        .with_guessed_format()
        .map_err(|e| format!("读取文件失败: {e}"))?;
    if reader.format().is_none() {
        // Formats without magic bytes (TGA, PNM variants) fall back to the extension.
        if let Ok(format) = ImageFormat::from_path(path) {
            reader.set_format(format);
        }
    }
    let img = reader.decode().map_err(|e| format!("解码失败: {e}"))?;
    let img = apply_exif_orientation(path, img);
    Ok(Decoded::Single(img))
}

/// Multi-page TIFF via the `tiff` crate (image-rs only exposes page 1).
/// Returns None when decoding fails or the color layout is unsupported,
/// so the caller falls back to the single-page image-rs path.
fn decode_multipage_tiff(path: &Path) -> Option<Vec<RgbaImage>> {
    let file = std::fs::File::open(path).ok()?;
    let mut decoder = tiff::decoder::Decoder::new(BufReader::new(file)).ok()?;
    let mut pages = Vec::new();
    loop {
        let (width, height) = decoder.dimensions().ok()?;
        let color = decoder.colortype().ok()?;
        let result = decoder.read_image().ok()?;
        pages.push(decoding_result_to_rgba(result, color, width, height)?);
        if !decoder.more_images() {
            break;
        }
        decoder.next_image().ok()?;
    }
    Some(pages)
}

fn decoding_result_to_rgba(
    result: tiff::decoder::DecodingResult,
    color: tiff::ColorType,
    width: u32,
    height: u32,
) -> Option<RgbaImage> {
    let to_rgba8 = |pixels: Vec<u8>, channels: usize| -> Option<RgbaImage> {
        let expected = (width as usize) * (height as usize) * channels;
        if pixels.len() < expected {
            return None;
        }
        let mut img = RgbaImage::new(width, height);
        let cmyk = channels == 4;
        for (i, dst) in img.pixels_mut().enumerate() {
            let p = &pixels[i * channels..i * channels + channels];
            let (r, g, b, a) = match channels {
                1 => (p[0], p[0], p[0], 255),
                2 => (p[0], p[0], p[0], p[1]),
                3 => (p[0], p[1], p[2], 255),
                // CMYK (inverted subtractive model); CMYKA handled above via `cmyk`
                4 if cmyk => {
                    let k = p[3] as u16;
                    (
                        (255 - p[0] as u16).min(k) as u8,
                        (255 - p[1] as u16).min(k) as u8,
                        (255 - p[2] as u16).min(k) as u8,
                        255,
                    )
                }
                _ => (p[0], p[1], p[2], p[3].min(255)),
            };
            *dst = image::Rgba([r, g, b, a]);
        }
        Some(img)
    };
    let to_rgba8_16 = |pixels: Vec<u16>, channels: usize| -> Option<RgbaImage> {
        let bytes: Vec<u8> = pixels.iter().map(|v| (v >> 8) as u8).collect();
        to_rgba8(bytes, channels)
    };
    match (result, color) {
        (tiff::decoder::DecodingResult::U8(v), tiff::ColorType::RGBA(8)) => to_rgba8(v, 4),
        (tiff::decoder::DecodingResult::U8(v), tiff::ColorType::RGB(8)) => to_rgba8(v, 3),
        (tiff::decoder::DecodingResult::U8(v), tiff::ColorType::Gray(8)) => to_rgba8(v, 1),
        (tiff::decoder::DecodingResult::U8(v), tiff::ColorType::GrayA(8)) => to_rgba8(v, 2),
        (tiff::decoder::DecodingResult::U8(v), tiff::ColorType::CMYK(8)) => to_rgba8(v, 4),
        (tiff::decoder::DecodingResult::U16(v), tiff::ColorType::RGBA(16)) => to_rgba8_16(v, 4),
        (tiff::decoder::DecodingResult::U16(v), tiff::ColorType::RGB(16)) => to_rgba8_16(v, 3),
        (tiff::decoder::DecodingResult::U16(v), tiff::ColorType::Gray(16)) => to_rgba8_16(v, 1),
        (tiff::decoder::DecodingResult::U16(v), tiff::ColorType::GrayA(16)) => to_rgba8_16(v, 2),
        _ => None,
    }
}

fn apply_exif_orientation(path: &Path, img: DynamicImage) -> DynamicImage {
    let Some(orientation) = exif_orientation(path) else {
        return img;
    };
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate90().flipv(),
        8 => img.rotate270(),
        _ => img,
    }
}

/// EXIF orientation via kamadak-exif; sniffs the JPEG/TIFF container itself.
fn exif_orientation(path: &Path) -> Option<u32> {
    let mut buffered = BufReader::new(std::fs::File::open(path).ok()?);
    let exif_data = exif::Reader::new()
        .read_from_container(&mut buffered)
        .ok()?;
    let field = exif_data.get_field(exif::Tag::Orientation, exif::In::PRIMARY)?;
    field.value.get_uint(0)
}

// -------------------------------------------------------------------- SVG

fn render_svg(bytes: &[u8]) -> Result<RgbaImage, String> {
    let mut fontdb = resvg::usvg::fontdb::Database::new();
    fontdb.load_system_fonts();
    let options = resvg::usvg::Options {
        fontdb: Arc::new(fontdb),
        ..Default::default()
    };
    let tree = resvg::usvg::Tree::from_data(bytes, &options)
        .map_err(|e| format!("SVG 解析失败: {e}"))?;

    let size = tree.size();
    let base_w = size.width().max(1.0);
    let base_h = size.height().max(1.0);
    // Vector sources can render crisply at any size; upscale small logos so the
    // PNG stays usable, but cap the allocation.
    let base_max = base_w.max(base_h);
    let scale = (1024.0 / base_max).clamp(1.0, 8.0);
    let width = ((base_w * scale).ceil() as u32).min(8192).max(1);
    let height = ((base_h * scale).ceil() as u32).min(8192).max(1);

    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height)
        .ok_or_else(|| "SVG 画布创建失败".to_string())?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );

    // tiny-skia returns premultiplied RGBA; undo the premultiplication.
    let mut img = RgbaImage::new(width, height);
    for (dst, px) in img.pixels_mut().zip(pixmap.data().chunks_exact(4)) {
        let a = px[3] as u32;
        let (r, g, b) = if a == 0 {
            (0, 0, 0)
        } else {
            (
                ((px[0] as u32 * 255 + a / 2) / a) as u8,
                ((px[1] as u32 * 255 + a / 2) / a) as u8,
                ((px[2] as u32 * 255 + a / 2) / a) as u8,
            )
        };
        *dst = image::Rgba([r, g, b, px[3]]);
    }
    Ok(img)
}

// -------------------------------------------------------------------- encode

fn encode(rgba: RgbaImage, options: &ConvertOptions) -> Result<Vec<u8>, String> {
    if options.mode == "lossy" {
        encode_lossy_indexed(rgba, options.colors, options.dither)
    } else {
        encode_rgba(rgba)
    }
}

fn encode_rgba(rgba: RgbaImage) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let cursor = Cursor::new(&mut out);
    let writer = BufWriter::new(cursor);
    DynamicImage::ImageRgba8(rgba)
        .write_to(writer, ImageFormat::Png)
        .map_err(|e| format!("PNG 编码失败: {e}"))?;
    Ok(out)
}

/// Keeps the original color type / bit depth (e.g. 16-bit gray scientific TIFFs).
fn encode_lossless_native(img: &DynamicImage) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let cursor = Cursor::new(&mut out);
    let writer = BufWriter::new(cursor);
    img.clone()
        .write_to(writer, ImageFormat::Png)
        .map_err(|e| format!("PNG 编码失败: {e}"))?;
    Ok(out)
}

/// pngquant-style lossy compression: NeuQuant palette + 8-bit indexed PNG,
/// written directly with the `png` crate (image-rs can't emit indexed PNGs).
fn encode_lossy_indexed(rgba: RgbaImage, colors: u32, dither: bool) -> Result<Vec<u8>, String> {
    let colors = colors.clamp(8, 256) as usize;
    let (width, height) = (rgba.width(), rgba.height());
    // Sample factor: NeuQuant's own image-wide scan is fine for small images,
    // but sampling keeps multi-megapixel photos responsive.
    let pixels = (width * height) as usize;
    let sample = if pixels > 2_000_000 { 10 } else { 1 };
    let nq = color_quant::NeuQuant::new(sample, colors, rgba.as_raw());

    let work: RgbaImage = if dither {
        let mut work = rgba.clone();
        image::imageops::dither(&mut work, &nq);
        work
    } else {
        rgba
    };

    let mut indices = Vec::with_capacity(pixels);
    for px in work.pixels() {
        indices.push(nq.index_of(&px.0) as u8);
    }

    let cmap = nq.color_map_rgba();
    let mut palette = Vec::with_capacity(colors * 3);
    let mut trns = Vec::with_capacity(colors);
    let mut any_alpha = false;
    for entry in cmap.chunks_exact(4) {
        palette.extend_from_slice(&entry[0..3]);
        trns.push(entry[3]);
        if entry[3] != 255 {
            any_alpha = true;
        }
    }

    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, width, height);
    encoder.set_color(png::ColorType::Indexed);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_palette(palette);
    if any_alpha {
        encoder.set_trns(trns);
    }
    encoder.set_compression(png::Compression::Balanced);
    let mut writer = encoder
        .write_header()
        .map_err(|e| format!("PNG 编码失败: {e}"))?;
    writer
        .write_image_data(&indices)
        .map_err(|e| format!("PNG 编码失败: {e}"))?;
    writer.finish().map_err(|e| format!("PNG 编码失败: {e}"))?;
    Ok(out)
}

/// oxipng preset: UI strength 1/2/3 → presets; the lossy path uses lighter
/// presets because the size win there comes from quantization.
fn oxipng_preset(options: &ConvertOptions) -> u8 {
    let level = options.optimize_level.clamp(1, 3);
    if options.mode == "lossy" {
        match level {
            1 => 1,
            2 => 2,
            _ => 4,
        }
    } else {
        match level {
            1 => 2,
            2 => 4,
            _ => OXIPNG_MAX_PRESET,
        }
    }
}

fn optimize_png(bytes: &[u8], preset: u8) -> Result<Vec<u8>, String> {
    let options = oxipng::Options::from_preset(preset);
    match oxipng::optimize_from_memory(bytes, &options) {
        Ok(optimized) => Ok(optimized),
        // oxipng never increases size; if it refuses our valid PNG, keep the
        // original bytes rather than failing the file.
        Err(_) => Ok(bytes.to_vec()),
    }
}

// ------------------------------------------------------------------ watermark

fn apply_watermark(
    img: &mut RgbaImage,
    wm: &WatermarkOptions,
    stem: &str,
    font: Option<&FontArc>,
    logo: Option<&RgbaImage>,
) {
    if wm.kind == "image" {
        if let Some(logo) = logo {
            apply_logo_watermark(img, logo, wm);
        }
        return;
    }
    let Some(font) = font else { return };
    let text = match wm.content.as_deref() {
        Some(content) if !content.trim().is_empty() && content != "{filename}" => {
            content.to_string()
        }
        _ => stem.to_string(),
    };
    apply_text_watermark(img, &text, wm, font);
}

fn apply_text_watermark(img: &mut RgbaImage, text: &str, wm: &WatermarkOptions, font: &FontArc) {
    let (width, height) = (img.width(), img.height());
    let scale = ab_glyph::PxScale::from(wm.font_size as f32);
    let (tw, th) = imageproc::drawing::text_size(scale, font, text);
    let alpha = ((wm.opacity.clamp(0.05, 1.0)) * 255.0).round() as u8;
    let (r, g, b) = if wm.color == "black" {
        (0u8, 0u8, 0u8)
    } else {
        (255u8, 255u8, 255u8)
    };
    let color = image::Rgba([r, g, b, alpha]);
    let margin = ((width.min(height) as f32 * 0.05).round() as i32).clamp(12, 160);

    let anchors: Vec<(i32, i32)> = if wm.position == "tile" {
        let step_x = tw as i32 + margin * 2;
        let step_y = th as i32 + margin * 2;
        let mut anchors = Vec::new();
        let mut y = margin;
        while y < height as i32 - th as i32 {
            let mut x = margin;
            while x < width as i32 - tw as i32 {
                anchors.push((x, y));
                x += step_x;
            }
            y += step_y;
        }
        if anchors.is_empty() {
            vec![(margin, margin)]
        } else {
            anchors
        }
    } else {
        vec![anchor_for(&wm.position, width, height, tw as i32, th as i32, margin)]
    };

    let bold_offset = if wm.bold {
        ((wm.font_size as f32 * 0.03).round() as i32).clamp(1, 3)
    } else {
        0
    };
    let (bg_alpha, bg_rgb): (u8, [u8; 3]) = match wm.background.as_str() {
        "opaque" => (235, [30, 30, 30]),
        "semi" => (160, [40, 40, 40]),
        "light" => (90, [50, 50, 50]),
        _ => (0, [0, 0, 0]),
    };

    for (x, y) in anchors {
        if bg_alpha > 0 {
            let pad_x = (wm.font_size / 5).max(8) as i32;
            let pad_y = (wm.font_size / 8).max(6) as i32;
            let rect = imageproc::rect::Rect::at(x - pad_x, y - pad_y)
                .of_size((tw as u32 + 2 * pad_x as u32).min(width.max(1)), (th as u32 + 2 * pad_y as u32).min(height.max(1)));
            imageproc::drawing::draw_filled_rect_mut(
                img,
                rect,
                image::Rgba([bg_rgb[0], bg_rgb[1], bg_rgb[2], bg_alpha]),
            );
        }
        for dx in 0..=bold_offset {
            for dy in 0..=bold_offset {
                imageproc::drawing::draw_text_mut(img, color, x + dx, y + dy, scale, font, text);
            }
        }
    }
}

fn anchor_for(position: &str, width: u32, height: u32, tw: i32, th: i32, margin: i32) -> (i32, i32) {
    let w = width as i32;
    let h = height as i32;
    match position {
        "top-left" => (margin, margin),
        "top-center" => ((w - tw) / 2, margin),
        "top-right" => (w - tw - margin, margin),
        "center-left" => (margin, (h - th) / 2),
        "center" => ((w - tw) / 2, (h - th) / 2),
        "center-right" => (w - tw - margin, (h - th) / 2),
        "bottom-left" => (margin, h - th - margin),
        "bottom-center" => ((w - tw) / 2, h - th - margin),
        _ => (w - tw - margin, h - th - margin),
    }
}

fn load_watermark_logo(path: &str) -> Option<RgbaImage> {
    let path = Path::new(path);
    let reader = ImageReader::open(path).ok()?.with_guessed_format().ok()?;
    let img = reader.decode().ok()?;
    Some(img.to_rgba8())
}

fn apply_logo_opacity(mut logo: RgbaImage, opacity: f64) -> RgbaImage {
    let factor = opacity.clamp(0.05, 1.0);
    for px in logo.pixels_mut() {
        px.0[3] = ((px.0[3] as f64) * factor).round() as u8;
    }
    logo
}

fn apply_logo_watermark(img: &mut RgbaImage, logo: &RgbaImage, wm: &WatermarkOptions) {
    let (width, height) = (img.width(), img.height());
    if width == 0 || height == 0 {
        return;
    }
    let fraction = wm.scale.clamp(0.02, 1.0);
    let target_w = ((width.min(height) as f64 * fraction) as u32).max(8);
    let aspect = logo.height().max(1) as f64 / logo.width().max(1) as f64;
    let target_h = ((target_w as f64 * aspect) as u32).max(8);
    let scaled = image::imageops::resize(
        logo,
        target_w,
        target_h,
        image::imageops::FilterType::Triangle,
    );

    let margin = ((width.min(height) as f32 * 0.05).round() as i32).clamp(12, 160);
    let (x, y) = anchor_for(
        &wm.position,
        width,
        height,
        target_w as i32,
        target_h as i32,
        margin,
    );

    for row in 0..target_h {
        let py = y as u32 + row;
        if py >= height {
            break;
        }
        for col in 0..target_w {
            let px = x as u32 + col;
            if px >= width {
                break;
            }
            let src = scaled.get_pixel(col, row).0;
            let dst = img.get_pixel_mut(px, py);
            let a = src[3] as f64 / 255.0;
            for c in 0..3 {
                dst.0[c] = ((src[c] as f64) * a + (dst.0[c] as f64) * (1.0 - a)).round() as u8;
            }
            dst.0[3] = ((src[3] as f64) + (dst.0[3] as f64) * (1.0 - a)).round() as u8;
        }
    }
}

// -------------------------------------------------------------------- output

fn output_dir_for(input: &Path, options: &ConvertOptions, ts: &str) -> Result<PathBuf, String> {
    let parent = input.parent().map(Path::to_path_buf).unwrap_or_default();
    let dir = match options.output_mode.as_str() {
        "custom" => options
            .custom_dir
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or(parent),
        "alongside" => parent,
        _ => parent.join(format!("PNG_output_{ts}")),
    };
    Ok(dir)
}

/// Picks a non-colliding output path; never resolves to the input path itself.
fn unique_output(candidate: PathBuf, input: &Path, taken: &Mutex<HashSet<PathBuf>>) -> PathBuf {
    let mut taken = match taken.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let mut candidate = if candidate == input {
        variant_path(&candidate, "-min")
    } else {
        candidate
    };
    let mut counter = 0u32;
    loop {
        if !taken.contains(&candidate) && !candidate.exists() {
            taken.insert(candidate.clone());
            return candidate;
        }
        counter += 1;
        candidate = variant_path(&candidate, &format!("-{counter}"));
    }
}

fn variant_path(path: &Path, suffix: &str) -> PathBuf {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    path.with_file_name(format!("{stem}{suffix}.png"))
}

/// UTC timestamp for output folder names (mirrors the old JPG_output_ convention).
fn timestamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86400) as i64;
    let rem = secs % 86400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}{month:02}{day:02}_{:02}{:02}{:02}",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Howard Hinnant's days-to-civil-date algorithm (public domain).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month: u32 = if mp < 10 { (mp + 3) as u32 } else { (mp - 9) as u32 };
    (if month <= 2 { year + 1 } else { year }, month, day)
}

// ----------------------------------------------------------------- thumbnails

pub(crate) fn thumbnail(path: &str, max_size: u32) -> Result<Thumbnail, String> {
    let path = Path::new(path);
    let file_size = std::fs::metadata(path)
        .map(|m| m.len())
        .map_err(|e| format!("读取文件失败: {e}"))?;
    let decoded = decode(path)?;
    let img = match decoded {
        Decoded::Single(img) => img,
        Decoded::Pages(pages) => DynamicImage::ImageRgba8(pages.first().cloned().unwrap_or_default()),
    };
    let thumb = img.thumbnail(max_size.max(16), max_size.max(16));
    let (width, height) = (thumb.width(), thumb.height());

    let mut png = Vec::new();
    let cursor = Cursor::new(&mut png);
    thumb
        .write_to(cursor, ImageFormat::Png)
        .map_err(|e| format!("PNG 编码失败: {e}"))?;
    let data_url = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&png)
    );
    Ok(Thumbnail {
        data_url,
        width,
        height,
        file_size,
    })
}

// --------------------------------------------------------------------- fonts

/// Resolves a watermark font from system font files (no font is bundled with
/// the app to keep the binary small). When nothing loads, the watermark is
/// skipped and the Finished event reports `watermarkApplied = false`.
fn load_watermark_font(name: &str) -> Option<FontArc> {
    font_file_candidates(name)
        .iter()
        .find_map(|candidate| read_font(candidate).ok())
}

fn read_font(path: &Path) -> Result<FontArc, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    // .ttc collections: index 0 selects the first face.
    FontArc::try_from_vec(bytes).map_err(|e| e.to_string())
}

/// Platform-specific system font files for the watermark font dropdown.
/// Unknown / empty names fall back to a CJK-capable default chain, so a
/// missing font never breaks conversion — it just skips the watermark.
fn font_file_candidates(name: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let cjk_default = matches!(name, "" | "default");

    #[cfg(windows)]
    if let Ok(windir) = std::env::var("WINDIR") {
        let fonts = PathBuf::from(windir).join("Fonts");
        match name {
            "微软雅黑" | "Microsoft YaHei" => {
                out.extend(["msyh.ttc", "msyh.ttf", "simhei.ttf"].map(|f| fonts.join(f)));
            }
            "黑体" | "SimHei" => out.push(fonts.join("simhei.ttf")),
            "宋体" | "SimSun" => out.push(fonts.join("simsun.ttc")),
            "Arial" => out.extend(["arial.ttf", "arialbd.ttf"].map(|f| fonts.join(f))),
            "Calibri" => out.extend(["calibri.ttf", "calibrib.ttf"].map(|f| fonts.join(f))),
            "Times New Roman" => out.extend(["times.ttf", "timesbd.ttf"].map(|f| fonts.join(f))),
            _ if cjk_default => {
                out.extend(["msyh.ttc", "msyh.ttf", "simhei.ttf"].map(|f| fonts.join(f)));
            }
            _ => {}
        }
    }

    #[cfg(target_os = "macos")]
    {
        let dirs = [
            "/System/Library/Fonts",
            "/System/Library/Fonts/Supplemental",
            "/Library/Fonts",
        ];
        for dir in dirs {
            let dir = PathBuf::from(dir);
            match name {
                "Arial" => out.push(dir.join("Arial.ttf")),
                "Calibri" => out.push(dir.join("Calibri.ttf")),
                "Times New Roman" => out.push(dir.join("Times New Roman.ttf")),
                _ if name.contains("宋") => out.push(dir.join("Songti.ttc")),
                _ if cjk_default || name.contains("雅黑") || name.contains("黑") => {
                    out.push(dir.join("PingFang.ttc"));
                }
                _ => {}
            }
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let dirs = [
            "/usr/share/fonts",
            "/usr/local/share/fonts",
            "/opt/homebrew/share/fonts",
        ];
        for dir in dirs {
            let dir = PathBuf::from(dir);
            if name.contains("宋") {
                out.push(dir.join("opentype/noto/NotoSerifCJK-Regular.ttc"));
            }
            if cjk_default || name.contains("雅黑") || name.contains("黑") {
                out.push(dir.join("opentype/noto/NotoSansCJK-Regular.ttc"));
                out.push(dir.join("truetype/wqy/wqy-microhei.ttc"));
            }
            if matches!(name, "Arial" | "Calibri" | "Times New Roman") || out.is_empty() {
                out.push(dir.join("truetype/dejavu/DejaVuSans.ttf"));
            }
        }
    }

    out
}

// -------------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "mynx_imgconv_{}_{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn gradient_rgba(w: u32, h: u32) -> RgbaImage {
        let mut img = RgbaImage::new(w, h);
        for y in 0..h {
            for x in 0..w {
                img.put_pixel(x, y, image::Rgba([(x % 256) as u8, (y % 256) as u8, 128, 255]));
            }
        }
        img
    }

    fn gradient_rgb(w: u32, h: u32) -> image::RgbImage {
        let mut img = image::RgbImage::new(w, h);
        for y in 0..h {
            for x in 0..w {
                img.put_pixel(x, y, image::Rgb([(x % 256) as u8, (y % 256) as u8, 128]));
            }
        }
        img
    }

    fn write_fixture(dir: &Path, name: &str, img: &DynamicImage) -> PathBuf {
        let path = dir.join(name);
        img.save(&path).unwrap();
        path
    }

    fn default_options(files: Vec<String>) -> ConvertOptions {
        ConvertOptions {
            files,
            mode: "lossless".into(),
            optimize_level: 2,
            colors: 256,
            dither: true,
            output_mode: "subfolder".into(),
            custom_dir: None,
            watermark: None,
        }
    }

    #[test]
    fn converts_png_to_png_lossless() {
        let dir = temp_dir("png_lossless");
        let input = write_fixture(&dir, "a.png", &DynamicImage::ImageRgba8(gradient_rgba(64, 48)));

        let options = default_options(vec![input.to_string_lossy().to_string()]);
        let taken = Mutex::new(HashSet::new());
        let results = convert_file(&input, &options, None, None, "20250101_000000", &taken).unwrap();
        assert_eq!(results.len(), 1);
        let (output, bytes) = &results[0];
        assert!(output.extension().unwrap() == "png");
        assert!(*bytes > 0);
        let decoded = image::open(output).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (64, 48));
    }

    #[test]
    fn converts_jpeg_and_tiff() {
        let dir = temp_dir("jpeg_tiff");
        let img = DynamicImage::ImageRgb8(gradient_rgb(48, 32));
        let jpg = write_fixture(&dir, "photo.jpg", &img);
        let tif = write_fixture(&dir, "scan.tif", &img);

        let options = default_options(vec![]);
        let taken = Mutex::new(HashSet::new());
        for input in [jpg, tif] {
            let results =
                convert_file(&input, &options, None, None, "20250101_000000", &taken).unwrap();
            assert_eq!(results.len(), 1, "{}", input.display());
            let decoded = image::open(&results[0].0).unwrap();
            assert_eq!((decoded.width(), decoded.height()), (48, 32));
        }
    }

    #[test]
    fn multipage_tiff_produces_page_files() {
        use tiff::encoder::TiffEncoder;
        use tiff::encoder::colortype::RGBA8;

        let dir = temp_dir("multipage");
        // Build a genuine 2-page TIFF: each new_image() call adds a page.
        let path = dir.join("multi.tif");
        {
            let file = std::fs::File::create(&path).unwrap();
            let mut encoder = TiffEncoder::new(file).unwrap();
            let page1 = gradient_rgba(32, 24);
            let page2 = gradient_rgba(40, 20);
            {
                let mut image = encoder.new_image::<RGBA8>(32, 24).unwrap();
                image.write_data(page1.as_raw()).unwrap();
            }
            {
                let mut image = encoder.new_image::<RGBA8>(40, 20).unwrap();
                image.write_data(page2.as_raw()).unwrap();
            }
        }

        let options = default_options(vec![path.to_string_lossy().to_string()]);
        let taken = Mutex::new(HashSet::new());
        let results = convert_file(&path, &options, None, None, "20250101_000000", &taken).unwrap();
        assert_eq!(results.len(), 2);
        let names: Vec<String> = results
            .iter()
            .map(|(p, _)| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert!(names.contains(&"multi_p1.png".to_string()));
        assert!(names.contains(&"multi_p2.png".to_string()));
    }

    #[test]
    fn lossy_output_is_indexed_png_within_color_budget() {
        let dir = temp_dir("lossy");
        let input = write_fixture(
            &dir,
            "photo.png",
            &DynamicImage::ImageRgba8(gradient_rgba(96, 96)),
        );

        let mut options = default_options(vec![input.to_string_lossy().to_string()]);
        options.mode = "lossy".into();
        options.colors = 64;
        options.dither = true;

        let taken = Mutex::new(HashSet::new());
        let results = convert_file(&input, &options, None, None, "20250101_000000", &taken).unwrap();
        let (output, _) = &results[0];
        let bytes = std::fs::read(output).unwrap();
        let decoder = png::Decoder::new(Cursor::new(&bytes));
        let reader = decoder.read_info().unwrap();
        let (color_type, _depth) = reader.output_color_type();
        assert_eq!(color_type, png::ColorType::Indexed);
        let info = reader.info();
        let palette_len = info.palette.as_deref().unwrap_or(&[]).len() / 3;
        assert!(palette_len <= 64, "palette {palette_len} > 64");

        // oxipng must not expand the indexed image back to RGB.
        let optimized = optimize_png(&bytes, 2).unwrap();
        let (color_type, _) = png::Decoder::new(Cursor::new(&optimized))
            .read_info()
            .unwrap()
            .output_color_type();
        assert_eq!(color_type, png::ColorType::Indexed);
    }

    #[test]
    fn output_modes_place_files_correctly() {
        let dir = temp_dir("output_modes");
        let input = write_fixture(
            &dir,
            "shot.png",
            &DynamicImage::ImageRgba8(gradient_rgba(32, 32)),
        );

        // alongside → same folder, original untouched
        let mut options = default_options(vec![]);
        options.output_mode = "alongside".into();
        let taken = Mutex::new(HashSet::new());
        let results =
            convert_file(&input, &options, None, None, "20250101_000000", &taken).unwrap();
        assert_eq!(results[0].0.parent(), Some(dir.as_path()));
        assert!(input.exists(), "source must never be overwritten");

        // subfolder → PNG_output_<ts>
        options.output_mode = "subfolder".into();
        let results =
            convert_file(&input, &options, None, None, "20250101_000000", &taken).unwrap();
        assert!(results[0]
            .0
            .parent()
            .unwrap()
            .file_name()
            .unwrap()
            == "PNG_output_20250101_000000");
    }

    #[test]
    fn png_recompression_never_overwrites_source() {
        let dir = temp_dir("recompress");
        let input = write_fixture(
            &dir,
            "same.png",
            &DynamicImage::ImageRgba8(gradient_rgba(32, 32)),
        );
        let original = std::fs::read(&input).unwrap();

        let options = default_options(vec![]);
        let taken = Mutex::new(HashSet::new());
        let results =
            convert_file(&input, &options, None, None, "20250101_000000", &taken).unwrap();
        // Output must not equal the source path and source stays byte-identical.
        assert_ne!(results[0].0, input);
        assert_eq!(std::fs::read(&input).unwrap(), original);
    }

    #[test]
    fn collect_files_filters_extensions_recursively() {
        let dir = temp_dir("collect");
        let sub = dir.join("nested");
        std::fs::create_dir_all(&sub).unwrap();
        let img = DynamicImage::ImageRgba8(gradient_rgba(8, 8));
        img.save(dir.join("one.png")).unwrap();
        img.save(sub.join("two.tiff")).unwrap();
        std::fs::write(dir.join("ignored.txt"), b"not an image").unwrap();

        let found = collect_files(&[dir.to_string_lossy().to_string()]);
        assert_eq!(found.len(), 2);
        assert!(found.iter().any(|p| p.ends_with("one.png")));
        assert!(found.iter().any(|p| p.ends_with("two.tiff")));
    }

    #[test]
    fn civil_from_days_matches_known_dates() {
        assert_eq!(civil_from_days(0), (1970i64, 1u32, 1u32));
        assert_eq!(civil_from_days(19_723), (2024i64, 1u32, 1u32)); // 2024-01-01
    }

    #[test]
    fn oxipng_reduces_or_keeps_size() {
        let dir = temp_dir("oxipng");
        let input = write_fixture(
            &dir,
            "big.png",
            &DynamicImage::ImageRgba8(gradient_rgba(256, 256)),
        );
        let raw = std::fs::read(&input).unwrap();
        let optimized = optimize_png(&raw, 4).unwrap();
        assert!(optimized.len() <= raw.len());
    }
}
