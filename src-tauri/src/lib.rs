use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::SystemTime,
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
mod network;
mod fits_analysis;
mod review;

const STORAGE_SESSION_ROOT_KEY: &str = "storage-session-root";

#[derive(Debug, Serialize)]
struct StorageStatus {
    mode: String,
    session_root: Option<String>,
    writable: bool,
}

#[derive(Debug, Serialize)]
struct ProcessingToolStatus {
    name: &'static str,
    available: bool,
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SessionFramePreview {
    session_folder: String,
    frame_number: u32,
}

#[derive(Debug, Deserialize)]
struct WriteFrameRequest {
    session_folder: String,
    file_name: String,
    image_type: String,
    target_name: String,
    frame_number: u32,
    captured_at: Option<String>,
    data_base64: String,
    expected_sha256: String,
    expected_size_bytes: u64,
}

#[derive(Debug, Deserialize)]
struct ExistingFrameRequest {
    session_folder: String,
    file_name: String,
    sha256: String,
    size_bytes: u64,
}

#[derive(Debug, Deserialize)]
struct FitsPreviewRequest {
    path: String,
    max_size: Option<u32>,
    auto_stretch: Option<bool>,
    black_point: Option<f64>,
    midtone: Option<f64>,
    white_point: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct FrameManifestEntry {
    frame_number: u32,
    file_name: String,
    path: String,
    size_bytes: u64,
    sha256: String,
    image_type: String,
    target_name: String,
    captured_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SessionManifest {
    version: u32,
    session_folder: String,
    frames: Vec<FrameManifestEntry>,
}

#[derive(Debug, Serialize)]
struct WriteFrameResult {
    frame: FrameManifestEntry,
    manifest_path: String,
}

#[derive(Debug, Serialize)]
struct ExistingFrameResult {
    found: bool,
    frame: Option<FrameManifestEntry>,
    manifest_path: Option<String>,
}

#[derive(Debug, Serialize)]
struct FitsPreviewResult {
    analysis: Option<fits_analysis::FitsAnalysis>,
    data_url: String,
    width: u32,
    height: u32,
    source_path: String,
    size_bytes: u64,
    header: Vec<FitsHeaderCard>,
    color: bool,
    black_point: f64,
    midtone: f64,
    white_point: f64,
}

#[derive(Debug, Clone, Serialize)]
struct FitsHeaderCard {
    key: String,
    value: String,
}

#[derive(Debug)]
struct FitsHeader {
    cards: HashMap<String, String>,
    data_offset: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BayerColor {
    Red,
    Green,
    Blue,
}

#[derive(Debug, Clone)]
struct CachedFitsPreview {
    analysis: Option<fits_analysis::FitsAnalysis>,
    path: PathBuf,
    modified: Option<SystemTime>,
    size_bytes: u64,
    max_size: u32,
    width: u32,
    height: u32,
    source_path: String,
    header: Vec<FitsHeaderCard>,
    values: Vec<[f64; 3]>,
    auto_black: f64,
    auto_white: f64,
    color: bool,
}

static FITS_PREVIEW_CACHE: OnceLock<Mutex<Option<CachedFitsPreview>>> = OnceLock::new();

fn fits_preview_cache() -> &'static Mutex<Option<CachedFitsPreview>> {
    FITS_PREVIEW_CACHE.get_or_init(|| Mutex::new(None))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;
    Ok(config_dir.join("settings.json"))
}

fn read_settings(path: &PathBuf) -> Result<Value, String> {
    if !path.exists() {
        return Ok(json!({}));
    }

    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;

    if raw.trim().is_empty() {
        return Ok(json!({}));
    }

    let parsed = serde_json::from_str::<Value>(&raw).map_err(|error| error.to_string())?;

    if parsed.is_object() {
        Ok(parsed)
    } else {
        Err("settings file must contain a JSON object".to_string())
    }
}

fn merge_settings(existing: &mut Value, update: Value) -> Result<(), String> {
    let existing_object = existing
        .as_object_mut()
        .ok_or_else(|| "settings file must contain a JSON object".to_string())?;
    let update_object = update
        .as_object()
        .ok_or_else(|| "settings update must contain a JSON object".to_string())?;

    for (key, value) in update_object {
        existing_object.insert(key.clone(), value.clone());
    }

    Ok(())
}

fn write_settings(path: &PathBuf, settings: &Value) -> Result<(), String> {
    let body = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, format!("{body}\n")).map_err(|error| error.to_string())
}

fn settings_string(settings: &Value, key: &str) -> Option<String> {
    settings
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
}

fn is_safe_relative_component(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed != "."
        && trimmed != ".."
        && !trimmed.contains('/')
        && !trimmed.contains('\\')
        && !trimmed.contains(':')
}

fn require_safe_relative_component(label: &str, value: &str) -> Result<String, String> {
    let trimmed = value.trim();

    if is_safe_relative_component(trimmed) {
        Ok(trimmed.to_string())
    } else {
        Err(format!(
            "{label} must be a relative name without path separators"
        ))
    }
}

fn storage_root_from_settings(app: &AppHandle) -> Result<PathBuf, String> {
    let path = settings_path(app)?;
    let settings = read_settings(&path)?;
    let root = settings_string(&settings, STORAGE_SESSION_ROOT_KEY)
        .ok_or_else(|| "storage session root is not configured".to_string())?;
    let root_path = PathBuf::from(root);

    if !root_path.is_dir() {
        return Err("storage session root must be an existing folder".to_string());
    }

    Ok(root_path)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn manifest_path(session_dir: &PathBuf) -> PathBuf {
    session_dir.join("manifest.json")
}

fn read_session_manifest(path: &PathBuf, session_folder: &str) -> Result<SessionManifest, String> {
    if !path.exists() {
        return Ok(SessionManifest {
            version: 1,
            session_folder: session_folder.to_string(),
            frames: Vec::new(),
        });
    }

    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str::<SessionManifest>(&raw).map_err(|error| error.to_string())
}

fn write_session_manifest(path: &PathBuf, manifest: &SessionManifest) -> Result<(), String> {
    let body = serde_json::to_string_pretty(manifest).map_err(|error| error.to_string())?;
    let (temporary, mut file) = TemporaryFile::create(path.parent().ok_or("manifest has no parent")?)?;
    file.write_all(body.as_bytes()).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    drop(file);
    verify_file(&temporary.0, &sha256_hex(body.as_bytes()), body.len() as u64)?;
    fs::rename(&temporary.0, path).map_err(|error| format!("Could not publish manifest: {error}"))?;
    sync_directory(path.parent().unwrap())
}

static FRAME_WRITE_LOCK: Mutex<()> = Mutex::new(());
static TEMPORARY_ID: AtomicU64 = AtomicU64::new(0);

struct TemporaryFile(PathBuf);

impl TemporaryFile {
    fn create(directory: &Path) -> Result<(Self, fs::File), String> {
        loop {
            let id = TEMPORARY_ID.fetch_add(1, Ordering::Relaxed);
            let path = directory.join(format!(".straylight-{}-{id}.partial", std::process::id()));
            match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(file) => return Ok((Self(path), file)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("Could not create temporary image file: {error}")),
            }
        }
    }
}

impl Drop for TemporaryFile {
    fn drop(&mut self) { let _ = fs::remove_file(&self.0); }
}

fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    fs::File::open(path).and_then(|file| file.sync_all()).map_err(|error| error.to_string())?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn verify_file(path: &Path, expected_sha: &str, expected_size: u64) -> Result<String, String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if !metadata.file_type().is_file() {
        return Err(format!("Refusing non-regular image file: {}", path.display()));
    }
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hash = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 { break; }
        hash.update(&buffer[..count]);
        total += count as u64;
    }
    let actual = format!("{:x}", hash.finalize());
    if total != expected_size || actual != expected_sha {
        return Err(format!("Image verification failed for {}: size or SHA-256 differs. Existing files are never overwritten.", path.display()));
    }
    Ok(actual)
}

fn image_destination(root: &Path, session: &str, name: &str) -> Result<PathBuf, String> {
    let session = require_safe_relative_component("session folder", session)?;
    let name = require_safe_relative_component("file name", name)?;
    let extension = Path::new(&name).extension().and_then(|value| value.to_str()).unwrap_or("");
    if !["fits", "fit", "fts"].iter().any(|allowed| extension.eq_ignore_ascii_case(allowed)) {
        return Err("Image filename must end in .fits, .fit, or .fts".to_string());
    }
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    let directory = root.join(session);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let directory = directory.canonicalize().map_err(|error| error.to_string())?;
    if !directory.starts_with(&root) { return Err("Session folder is outside the selected image destination".to_string()); }
    Ok(directory.join(name))
}

// A hard link publishes the complete staged file atomically without replacing a
// competing destination. Unsupported filesystems fail closed; there is no copy fallback.
fn publish_image(temporary: &Path, destination: &Path, sha: &str, size: u64) -> Result<String, String> {
    verify_file(temporary, sha, size)?;
    match fs::hard_link(temporary, destination) {
        Ok(()) => sync_directory(destination.parent().unwrap())?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {},
        Err(error) => return Err(format!("Could not safely publish image (destination must support hard links): {error}")),
    }
    verify_file(destination, sha, size)
}

fn parse_fits_header(bytes: &[u8]) -> Result<FitsHeader, String> {
    let mut cards = HashMap::new();
    let mut offset = 0usize;

    while offset + 2880 <= bytes.len() {
        let block = &bytes[offset..offset + 2880];

        for card in block.chunks_exact(80) {
            let text = String::from_utf8_lossy(card);
            let keyword = text.get(0..8).unwrap_or("").trim().to_string();

            if keyword == "END" {
                return Ok(FitsHeader {
                    cards,
                    data_offset: offset + 2880,
                });
            }

            if keyword.is_empty() {
                continue;
            }

            if text.as_bytes().get(8) == Some(&b'=') {
                let raw_value = text
                    .get(10..)
                    .unwrap_or("")
                    .split('/')
                    .next()
                    .unwrap_or("")
                    .trim();
                cards.insert(keyword, raw_value.trim_matches('\'').trim().to_string());
            }
        }

        offset += 2880;
    }

    Err("FITS header END card was not found".to_string())
}

fn fits_i64(cards: &HashMap<String, String>, key: &str) -> Result<i64, String> {
    cards
        .get(key)
        .ok_or_else(|| format!("FITS header missing {key}"))?
        .parse::<i64>()
        .map_err(|error| format!("FITS header {key} is invalid: {error}"))
}

fn fits_f64(cards: &HashMap<String, String>, key: &str, fallback: f64) -> f64 {
    cards
        .get(key)
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(fallback)
}

fn fits_header_cards(cards: &HashMap<String, String>) -> Vec<FitsHeaderCard> {
    let preferred = [
        "SIMPLE", "BITPIX", "NAXIS", "NAXIS1", "NAXIS2", "IMAGETYP", "EXPOSURE", "EXPTIME",
        "DATE-OBS", "DATE-LOC", "OBJECT", "INSTRUME", "CAMERAID", "GAIN", "OFFSET",
        "CCD-TEMP", "SET-TEMP", "BAYERPAT", "XBINNING", "YBINNING", "XBAYROFF", "YBAYROFF",
        "TELESCOP", "FOCALLEN", "FOCRATIO", "FILTER", "HFR", "STARS",
    ];
    let mut rows = Vec::new();

    for key in preferred {
        if let Some(value) = cards.get(key) {
            rows.push(FitsHeaderCard {
                key: key.to_string(),
                value: value.clone(),
            });
        }
    }

    let mut extra: Vec<_> = cards
        .iter()
        .filter(|(key, _)| !preferred.contains(&key.as_str()))
        .collect();
    extra.sort_by(|(left, _), (right, _)| left.cmp(right));

    for (key, value) in extra.into_iter().take(80usize.saturating_sub(rows.len())) {
        rows.push(FitsHeaderCard {
            key: key.clone(),
            value: value.clone(),
        });
    }

    rows
}

fn read_fits_value(
    data: &[u8],
    bitpix: i64,
    index: usize,
    bzero: f64,
    bscale: f64,
) -> Result<f64, String> {
    match bitpix {
        8 => data
            .get(index)
            .map(|value| (*value as f64) * bscale + bzero)
            .ok_or_else(|| "FITS data ended unexpectedly".to_string()),
        16 => {
            let start = index * 2;
            let chunk = data
                .get(start..start + 2)
                .ok_or_else(|| "FITS data ended unexpectedly".to_string())?;
            Ok(i16::from_be_bytes([chunk[0], chunk[1]]) as f64 * bscale + bzero)
        }
        32 => {
            let start = index * 4;
            let chunk = data
                .get(start..start + 4)
                .ok_or_else(|| "FITS data ended unexpectedly".to_string())?;
            Ok(
                i32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]) as f64 * bscale
                    + bzero,
            )
        }
        -32 => {
            let start = index * 4;
            let chunk = data
                .get(start..start + 4)
                .ok_or_else(|| "FITS data ended unexpectedly".to_string())?;
            Ok(
                f32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]) as f64 * bscale
                    + bzero,
            )
        }
        -64 => {
            let start = index * 8;
            let chunk = data
                .get(start..start + 8)
                .ok_or_else(|| "FITS data ended unexpectedly".to_string())?;
            Ok(f64::from_be_bytes([
                chunk[0], chunk[1], chunk[2], chunk[3], chunk[4], chunk[5], chunk[6], chunk[7],
            ]) * bscale
                + bzero)
        }
        _ => Err(format!("Unsupported FITS BITPIX value: {bitpix}")),
    }
}

fn parse_bayer_color(value: char) -> Option<BayerColor> {
    match value {
        'R' => Some(BayerColor::Red),
        'G' => Some(BayerColor::Green),
        'B' => Some(BayerColor::Blue),
        _ => None,
    }
}

fn bayer_pattern_from_header(cards: &HashMap<String, String>) -> Option<[BayerColor; 4]> {
    let pattern = cards
        .get("BAYERPAT")
        .or_else(|| cards.get("BAYER"))
        .or_else(|| cards.get("COLORTYP"))
        .map(|value| value.trim().to_ascii_uppercase())?;
    let mut chars = pattern.chars();
    let first = parse_bayer_color(chars.next()?)?;
    let second = parse_bayer_color(chars.next()?)?;
    let third = parse_bayer_color(chars.next()?)?;
    let fourth = parse_bayer_color(chars.next()?)?;

    Some([first, second, third, fourth])
}

fn bayer_color_at(
    pattern: &[BayerColor; 4],
    x: usize,
    y: usize,
    x_offset: usize,
    y_offset: usize,
) -> BayerColor {
    let pattern_x = (x + x_offset) % 2;
    let pattern_y = (y + y_offset) % 2;
    pattern[pattern_y * 2 + pattern_x]
}

fn read_fits_pixel_value(
    data: &[u8],
    bitpix: i64,
    source_width: usize,
    source_height: usize,
    x: usize,
    y: usize,
    bzero: f64,
    bscale: f64,
) -> Result<f64, String> {
    let clamped_x = x.min(source_width - 1);
    let clamped_y = y.min(source_height - 1);
    read_fits_value(
        data,
        bitpix,
        clamped_y * source_width + clamped_x,
        bzero,
        bscale,
    )
}

fn sample_bayer_channel(
    data: &[u8],
    bitpix: i64,
    source_width: usize,
    source_height: usize,
    x: usize,
    y: usize,
    bzero: f64,
    bscale: f64,
    pattern: &[BayerColor; 4],
    x_offset: usize,
    y_offset: usize,
    channel: BayerColor,
) -> Result<f64, String> {
    let mut total = 0.0;
    let mut count = 0usize;
    let min_y = y.saturating_sub(1);
    let max_y = (y + 1).min(source_height - 1);
    let min_x = x.saturating_sub(1);
    let max_x = (x + 1).min(source_width - 1);

    for sample_y in min_y..=max_y {
        for sample_x in min_x..=max_x {
            if bayer_color_at(pattern, sample_x, sample_y, x_offset, y_offset) == channel {
                total += read_fits_pixel_value(
                    data,
                    bitpix,
                    source_width,
                    source_height,
                    sample_x,
                    sample_y,
                    bzero,
                    bscale,
                )?;
                count += 1;
            }
        }
    }

    if count == 0 {
        read_fits_pixel_value(
            data,
            bitpix,
            source_width,
            source_height,
            x,
            y,
            bzero,
            bscale,
        )
    } else {
        Ok(total / count as f64)
    }
}

fn luminance(pixel: &[f64; 3]) -> f64 {
    pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722
}

fn bmp_data_url_from_rgb(width: u32, height: u32, pixels: &[[u8; 3]]) -> Result<String, String> {
    let row_stride = ((width * 3 + 3) / 4) * 4;
    let pixel_bytes = row_stride
        .checked_mul(height)
        .ok_or_else(|| "preview image is too large".to_string())?;
    let file_size = 14u32
        .checked_add(40)
        .and_then(|header| header.checked_add(pixel_bytes))
        .ok_or_else(|| "preview image is too large".to_string())?;
    let mut bmp = Vec::with_capacity(file_size as usize);

    bmp.extend_from_slice(b"BM");
    bmp.extend_from_slice(&file_size.to_le_bytes());
    bmp.extend_from_slice(&[0, 0, 0, 0]);
    bmp.extend_from_slice(&54u32.to_le_bytes());
    bmp.extend_from_slice(&40u32.to_le_bytes());
    bmp.extend_from_slice(&(width as i32).to_le_bytes());
    bmp.extend_from_slice(&(height as i32).to_le_bytes());
    bmp.extend_from_slice(&1u16.to_le_bytes());
    bmp.extend_from_slice(&24u16.to_le_bytes());
    bmp.extend_from_slice(&0u32.to_le_bytes());
    bmp.extend_from_slice(&pixel_bytes.to_le_bytes());
    bmp.extend_from_slice(&2835i32.to_le_bytes());
    bmp.extend_from_slice(&2835i32.to_le_bytes());
    bmp.extend_from_slice(&0u32.to_le_bytes());
    bmp.extend_from_slice(&0u32.to_le_bytes());

    let padding = (row_stride - width * 3) as usize;
    for row in (0..height as usize).rev() {
        let row_start = row * width as usize;
        for col in 0..width as usize {
            let [red, green, blue] = pixels[row_start + col];
            bmp.extend_from_slice(&[blue, green, red]);
        }
        bmp.extend(std::iter::repeat(0).take(padding));
    }

    Ok(format!(
        "data:image/bmp;base64,{}",
        BASE64_STANDARD.encode(bmp)
    ))
}

#[cfg(test)]
fn bmp_data_url_from_gray(width: u32, height: u32, pixels: &[u8]) -> Result<String, String> {
    let rgb_pixels = pixels
        .iter()
        .map(|value| [*value, *value, *value])
        .collect::<Vec<_>>();
    bmp_data_url_from_rgb(width, height, &rgb_pixels)
}

fn percentile(sorted_values: &[f64], percent: f64) -> Option<f64> {
    if sorted_values.is_empty() {
        return None;
    }

    let clamped = percent.clamp(0.0, 1.0);
    let index = ((sorted_values.len() - 1) as f64 * clamped).round() as usize;
    sorted_values.get(index).copied()
}

fn auto_stretch_bounds(values: &[f64]) -> (f64, f64) {
    let mut finite_values = values
        .iter()
        .copied()
        .filter(|value| value.is_finite())
        .collect::<Vec<_>>();

    if finite_values.is_empty() {
        return (0.0, 65535.0);
    }

    finite_values.sort_by(|left, right| left.total_cmp(right));
    let low = percentile(&finite_values, 0.01).unwrap_or(0.0);
    let high = percentile(&finite_values, 0.995).unwrap_or(low + 1.0);

    if high <= low {
        (low, low + 1.0)
    } else {
        (low, high)
    }
}

fn sample_fits_preview(
    bytes: &[u8],
    request: &FitsPreviewRequest,
    path: PathBuf,
    modified: Option<SystemTime>,
    analyze: bool,
) -> Result<CachedFitsPreview, String> {
    let header = parse_fits_header(bytes)?;
    let naxis = fits_i64(&header.cards, "NAXIS")?;
    if naxis != 2 {
        return Err("FITS preview currently supports two-dimensional images only".to_string());
    }

    let source_width = usize::try_from(fits_i64(&header.cards, "NAXIS1")?).ok().filter(|v| *v > 0).ok_or("Invalid FITS width")?;
    let source_height = usize::try_from(fits_i64(&header.cards, "NAXIS2")?).ok().filter(|v| *v > 0).ok_or("Invalid FITS height")?;
    let bitpix = fits_i64(&header.cards, "BITPIX")?;
    let bzero = fits_f64(&header.cards, "BZERO", 0.0);
    let bscale = fits_f64(&header.cards, "BSCALE", 1.0);
    let x_binning = fits_i64(&header.cards, "XBINNING").unwrap_or(1);
    let y_binning = fits_i64(&header.cards, "YBINNING").unwrap_or(1);
    let x_bayer_offset = fits_i64(&header.cards, "XBAYROFF").unwrap_or(0).max(0) as usize;
    let y_bayer_offset = fits_i64(&header.cards, "YBAYROFF").unwrap_or(0).max(0) as usize;
    let bayer_pattern = if x_binning == 1 && y_binning == 1 {
        bayer_pattern_from_header(&header.cards)
    } else {
        None
    };
    let max_size = request.max_size.unwrap_or(1400).clamp(128, 2400);
    let scale = (max_size as f64 / source_width.max(source_height) as f64).min(1.0);
    let width = ((source_width as f64 * scale).round() as usize).max(1);
    let height = ((source_height as f64 * scale).round() as usize).max(1);
    let data = bytes
        .get(header.data_offset..)
        .ok_or_else(|| "FITS data section is missing".to_string())?;
    let bytes_per_sample = match bitpix { 8 => 1, 16 => 2, 32 | -32 => 4, -64 => 8, _ => return Err("Unsupported FITS BITPIX".into()) };
    let required = source_width.checked_mul(source_height).and_then(|count| count.checked_mul(bytes_per_sample)).ok_or("FITS dimensions overflow")?;
    if data.len() < required { return Err("FITS data ended unexpectedly".into()); }
    let mut sampled_values = Vec::with_capacity(width * height);
    let analysis = if analyze { Some(fits_analysis::analyze(data, &header, source_width, source_height)?) } else { None };
    let mut stretch_values = Vec::with_capacity(width * height);

    for y in 0..height {
        let source_y = ((y as f64 / scale).floor() as usize).min(source_height - 1);
        for x in 0..width {
            let source_x = ((x as f64 / scale).floor() as usize).min(source_width - 1);
            let pixel = if let Some(pattern) = bayer_pattern {
                [
                    sample_bayer_channel(
                        data,
                        bitpix,
                        source_width,
                        source_height,
                        source_x,
                        source_y,
                        bzero,
                        bscale,
                        &pattern,
                        x_bayer_offset,
                        y_bayer_offset,
                        BayerColor::Red,
                    )?,
                    sample_bayer_channel(
                        data,
                        bitpix,
                        source_width,
                        source_height,
                        source_x,
                        source_y,
                        bzero,
                        bscale,
                        &pattern,
                        x_bayer_offset,
                        y_bayer_offset,
                        BayerColor::Green,
                    )?,
                    sample_bayer_channel(
                        data,
                        bitpix,
                        source_width,
                        source_height,
                        source_x,
                        source_y,
                        bzero,
                        bscale,
                        &pattern,
                        x_bayer_offset,
                        y_bayer_offset,
                        BayerColor::Blue,
                    )?,
                ]
            } else {
                let value = read_fits_pixel_value(
                    data,
                    bitpix,
                    source_width,
                    source_height,
                    source_x,
                    source_y,
                    bzero,
                    bscale,
                )?;
                [value, value, value]
            };

            stretch_values.push(luminance(&pixel));
            sampled_values.push(pixel);
        }
    }

    let (auto_black, auto_white) = auto_stretch_bounds(&stretch_values);

    Ok(CachedFitsPreview {
        analysis,
        path,
        modified,
        size_bytes: bytes.len() as u64,
        max_size,
        width: width as u32,
        height: height as u32,
        source_path: request.path.clone(),
        header: fits_header_cards(&header.cards),
        values: sampled_values,
        auto_black,
        auto_white,
        color: bayer_pattern.is_some(),
    })
}

fn render_cached_fits_preview(
    preview: &CachedFitsPreview,
    request: &FitsPreviewRequest,
) -> Result<FitsPreviewResult, String> {
    let use_auto_stretch = request.auto_stretch.unwrap_or(false);
    let black = if use_auto_stretch {
        preview.auto_black
    } else {
        request.black_point.unwrap_or(preview.auto_black)
    };
    let white = if use_auto_stretch {
        preview.auto_white
    } else {
        request
            .white_point
            .unwrap_or(preview.auto_white)
            .max(black + 1.0)
    };
    let midtone = request.midtone.unwrap_or(1.0).clamp(0.05, 8.0);
    let gamma = 1.0 / midtone;
    let mut pixels = Vec::with_capacity(preview.values.len());

    for value in &preview.values {
        let red = ((value[0] - black) / (white - black))
            .clamp(0.0, 1.0)
            .powf(gamma);
        let green = ((value[1] - black) / (white - black))
            .clamp(0.0, 1.0)
            .powf(gamma);
        let blue = ((value[2] - black) / (white - black))
            .clamp(0.0, 1.0)
            .powf(gamma);
        pixels.push([
            (red * 255.0).round() as u8,
            (green * 255.0).round() as u8,
            (blue * 255.0).round() as u8,
        ]);
    }

    Ok(FitsPreviewResult {
        analysis: preview.analysis.clone(),
        data_url: bmp_data_url_from_rgb(preview.width, preview.height, &pixels)?,
        width: preview.width,
        height: preview.height,
        source_path: preview.source_path.clone(),
        size_bytes: preview.size_bytes,
        header: preview.header.clone(),
        color: preview.color,
        black_point: black,
        midtone,
        white_point: white,
    })
}

#[cfg(test)]
fn render_fits_to_preview(
    bytes: &[u8],
    request: &FitsPreviewRequest,
) -> Result<FitsPreviewResult, String> {
    let preview = sample_fits_preview(bytes, request, PathBuf::from(&request.path), None, true)?;
    render_cached_fits_preview(&preview, request)
}

fn render_fits_preview_from_path(
    path: PathBuf,
    request: &FitsPreviewRequest,
) -> Result<FitsPreviewResult, String> {
    let max_size = request.max_size.unwrap_or(1400).clamp(128, 2400);
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    let modified = metadata.modified().ok();
    let cache = fits_preview_cache();
    let cached_preview = {
        let guard = cache.lock().map_err(|error| error.to_string())?;

        guard
            .as_ref()
            .filter(|preview| {
                preview.path == path && preview.modified == modified && preview.size_bytes == metadata.len() && preview.max_size == max_size
            })
            .cloned()
    };
    let preview = if let Some(preview) = cached_preview {
        preview
    } else {
        let bytes = fs::read(&path).map_err(|error| error.to_string())?;
        let mut preview = sample_fits_preview(&bytes, request, path.clone(), modified, true)?;
        preview.size_bytes = metadata.len();
        let mut guard = cache.lock().map_err(|error| error.to_string())?;
        *guard = Some(preview.clone());
        preview
    };

    render_cached_fits_preview(&preview, request)
}

fn require_path_under_storage_root(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let root = storage_root_from_settings(app)?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let requested = PathBuf::from(path)
        .canonicalize()
        .map_err(|error| error.to_string())?;

    if requested.starts_with(&root) {
        Ok(requested)
    } else {
        Err("preview path must be under the configured storage root".to_string())
    }
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<Value, String> {
    let path = settings_path(&app)?;
    read_settings(&path)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Value) -> Result<(), String> {
    let path = settings_path(&app)?;
    let mut current = read_settings(&path)?;
    merge_settings(&mut current, settings)?;
    write_settings(&path, &current)
}

#[tauri::command]
fn reset_settings(app: AppHandle) -> Result<(), String> {
    let path = settings_path(&app)?;

    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn get_storage_status(app: AppHandle) -> Result<StorageStatus, String> {
    let path = settings_path(&app)?;
    let settings = read_settings(&path)?;
    let session_root = settings_string(&settings, STORAGE_SESSION_ROOT_KEY);
    let writable = session_root
        .as_ref()
        .map(|root| PathBuf::from(root).is_dir())
        .unwrap_or(false);

    let mode = if session_root.is_some() {
        "configured".to_string()
    } else {
        "preview".to_string()
    };

    Ok(StorageStatus {
        mode,
        session_root,
        writable,
    })
}

#[tauri::command]
fn get_default_session_root(app: AppHandle) -> Result<Option<String>, String> {
    let path = settings_path(&app)?;
    let settings = read_settings(&path)?;
    Ok(settings_string(&settings, STORAGE_SESSION_ROOT_KEY))
}

#[tauri::command]
fn set_session_root(app: AppHandle, path: String) -> Result<String, String> {
    let trimmed = path.trim();

    if trimmed.is_empty() {
        return Err("session root cannot be empty".to_string());
    }

    let root = PathBuf::from(trimmed);

    if !root.is_dir() {
        return Err("session root must be an existing folder".to_string());
    }

    let settings_file = settings_path(&app)?;
    let mut current = read_settings(&settings_file)?;
    merge_settings(&mut current, json!({ STORAGE_SESSION_ROOT_KEY: trimmed }))?;
    write_settings(&settings_file, &current)?;
    Ok(trimmed.to_string())
}

#[tauri::command]
fn clear_session_root(app: AppHandle) -> Result<(), String> {
    let settings_file = settings_path(&app)?;
    let mut current = read_settings(&settings_file)?;

    if let Some(object) = current.as_object_mut() {
        object.remove(STORAGE_SESSION_ROOT_KEY);
    }

    write_settings(&settings_file, &current)
}

#[tauri::command]
fn get_legacy_storage_status() -> StorageStatus {
    StorageStatus {
        mode: "preview".to_string(),
        session_root: None,
        writable: false,
    }
}

#[tauri::command]
fn preview_frame_path(preview: SessionFramePreview) -> String {
    let frame_number = preview.frame_number.max(1);
    format!("{}/{}.fits", preview.session_folder, frame_number)
}

#[tauri::command]
fn prepare_session_folder(app: AppHandle, session_folder: String) -> Result<String, String> {
    let safe_session_folder = require_safe_relative_component("session folder", &session_folder)?;
    let root = storage_root_from_settings(&app)?;
    let session_dir = root.join(safe_session_folder);

    fs::create_dir_all(&session_dir).map_err(|error| error.to_string())?;
    Ok(session_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn write_frame(app: AppHandle, request: WriteFrameRequest) -> Result<WriteFrameResult, String> {
    let root = storage_root_from_settings(&app)?;
    store_frame(&root, request)
}

fn store_frame(root: &Path, request: WriteFrameRequest) -> Result<WriteFrameResult, String> {
    store_frame_with_commit(root, request, write_session_manifest)
}

fn store_frame_with_commit(
    root: &Path,
    request: WriteFrameRequest,
    commit_manifest: impl FnOnce(&PathBuf, &SessionManifest) -> Result<(), String>,
) -> Result<WriteFrameResult, String> {
    let _guard = FRAME_WRITE_LOCK.lock().map_err(|_| "Image storage lock failed")?;
    let safe_session_folder =
        require_safe_relative_component("session folder", &request.session_folder)?;
    let safe_file_name = require_safe_relative_component("file name", &request.file_name)?;
    let expected_sha = request.expected_sha256.trim().to_lowercase();
    if expected_sha.len() != 64 || !expected_sha.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Expected image SHA-256 must contain 64 hexadecimal characters".to_string());
    }

    let bytes = BASE64_STANDARD
        .decode(request.data_base64.as_bytes())
        .map_err(|error| error.to_string())?;
    if bytes.is_empty() || bytes.len() as u64 != request.expected_size_bytes || sha256_hex(&bytes) != expected_sha {
        return Err("Downloaded image does not match the expected size and SHA-256".to_string());
    }
    let frame_path = image_destination(root, &safe_session_folder, &safe_file_name)?;
    let session_dir = frame_path.parent().unwrap().to_path_buf();
    let manifest_file = manifest_path(&session_dir);
    let mut manifest = read_session_manifest(&manifest_file, &safe_session_folder)?;
    if fs::symlink_metadata(&frame_path).is_ok() {
        verify_file(&frame_path, &expected_sha, request.expected_size_bytes)?;
    } else {
        let (temporary, mut file) = TemporaryFile::create(&session_dir)?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        publish_image(&temporary.0, &frame_path, &expected_sha, request.expected_size_bytes)?;
    }
    let verified_sha = verify_file(&frame_path, &expected_sha, request.expected_size_bytes)?;
    let frame = FrameManifestEntry {
        frame_number: request.frame_number.max(1),
        file_name: safe_file_name,
        path: frame_path.to_string_lossy().to_string(),
        size_bytes: bytes.len() as u64,
        sha256: verified_sha,
        image_type: request.image_type,
        target_name: request.target_name,
        captured_at: request.captured_at,
    };

    manifest
        .frames
        .retain(|existing| existing.file_name != frame.file_name);
    manifest.frames.push(FrameManifestEntry {
        frame_number: frame.frame_number,
        file_name: frame.file_name.clone(),
        path: frame.path.clone(),
        size_bytes: frame.size_bytes,
        sha256: frame.sha256.clone(),
        image_type: frame.image_type.clone(),
        target_name: frame.target_name.clone(),
        captured_at: frame.captured_at.clone(),
    });
    manifest.frames.sort_by_key(|entry| entry.frame_number);
    commit_manifest(&manifest_file, &manifest)?;
    verify_file(&frame_path, &expected_sha, request.expected_size_bytes)?;

    Ok(WriteFrameResult {
        frame,
        manifest_path: manifest_file.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn find_existing_frame(
    app: AppHandle,
    request: ExistingFrameRequest,
) -> Result<ExistingFrameResult, String> {
    let root = storage_root_from_settings(&app)?;
    find_verified_frame(&root, request)
}

fn find_verified_frame(root: &Path, request: ExistingFrameRequest) -> Result<ExistingFrameResult, String> {
    let _guard = FRAME_WRITE_LOCK.lock().map_err(|_| "Image storage lock failed")?;
    let safe_session_folder =
        require_safe_relative_component("session folder", &request.session_folder)?;
    let safe_file_name = require_safe_relative_component("file name", &request.file_name)?;
    let expected_sha = request.sha256.trim().to_lowercase();
    let frame_path = image_destination(root, &safe_session_folder, &safe_file_name)?;
    let session_dir = frame_path.parent().unwrap().to_path_buf();
    let manifest_file = manifest_path(&session_dir);

    if manifest_file.exists() {
        let manifest = read_session_manifest(&manifest_file, &safe_session_folder)?;

        if let Some(mut entry) = manifest.frames.into_iter().find(|entry| {
            entry.file_name == safe_file_name && entry.sha256.eq_ignore_ascii_case(&expected_sha)
        }) {
            if frame_path.is_file() {
                verify_file(&frame_path, &expected_sha, request.size_bytes)?;
                entry.size_bytes = request.size_bytes;
                entry.path = frame_path.to_string_lossy().to_string();
                return Ok(ExistingFrameResult {
                    found: true,
                    frame: Some(entry),
                    manifest_path: Some(manifest_file.to_string_lossy().to_string()),
                });
            }
        }
    }

    // Revisit the writer to repair missing manifest entries from agent metadata
    // before acknowledging an image left by an interrupted transfer.

    Ok(ExistingFrameResult {
        found: false,
        frame: None,
        manifest_path: manifest_file.exists().then(|| manifest_file.to_string_lossy().to_string()),
    })
}

#[tauri::command]
fn render_fits_preview(
    app: AppHandle,
    request: FitsPreviewRequest,
) -> Result<FitsPreviewResult, String> {
    let path = require_path_under_storage_root(&app, &request.path)?;
    render_fits_preview_from_path(path, &request)
}

#[tauri::command]
fn render_selected_fits_preview(request: FitsPreviewRequest) -> Result<FitsPreviewResult, String> {
    let path = PathBuf::from(&request.path)
        .canonicalize()
        .map_err(|error| error.to_string())?;

    if !path.is_file() {
        return Err("selected FITS path must be a file".to_string());
    }

    render_fits_preview_from_path(path, &request)
}

#[tauri::command]
fn find_siril() -> ProcessingToolStatus {
    ProcessingToolStatus {
        name: "Siril",
        available: false,
        path: None,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            review::review_open,
            review::review_decide,
            review::review_preview,
            network::network_http,
            network::network_socket,
            network::network_socket_send,
            load_settings,
            save_settings,
            reset_settings,
            get_storage_status,
            get_default_session_root,
            set_session_root,
            clear_session_root,
            get_legacy_storage_status,
            preview_frame_path,
            prepare_session_folder,
            write_frame,
            find_existing_frame,
            render_fits_preview,
            render_selected_fits_preview,
            find_siril
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod storage_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_settings_replaces_and_preserves_keys() {
        let mut settings = json!({
            "astro-demo-mode": false,
            "unchanged": "keep"
        });

        merge_settings(
            &mut settings,
            json!({
                "astro-demo-mode": true,
                "astro-planner-state-v1": { "activeTab": "targeting" }
            }),
        )
        .expect("settings should merge");

        assert_eq!(settings["astro-demo-mode"], true);
        assert_eq!(settings["unchanged"], "keep");
        assert_eq!(settings["astro-planner-state-v1"]["activeTab"], "targeting");
    }

    #[test]
    fn merge_settings_rejects_non_object_updates() {
        let mut settings = json!({});
        let result = merge_settings(&mut settings, json!(["not", "an", "object"]));

        assert!(result.is_err());
    }

    #[test]
    fn settings_string_reads_non_empty_string() {
        let settings = json!({
            STORAGE_SESSION_ROOT_KEY: "D:/Astro"
        });

        assert_eq!(
            settings_string(&settings, STORAGE_SESSION_ROOT_KEY),
            Some("D:/Astro".to_string())
        );
    }

    #[test]
    fn rejects_path_traversal_components() {
        assert!(require_safe_relative_component("file name", "1.fits").is_ok());
        assert!(require_safe_relative_component("file name", "../1.fits").is_err());
        assert!(require_safe_relative_component("file name", "nested/1.fits").is_err());
        assert!(require_safe_relative_component("file name", "C:\\temp\\1.fits").is_err());
    }

    #[test]
    fn computes_sha256_hex() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn parses_fits_header_cards() {
        let mut header = Vec::new();
        header.extend_from_slice(format!("{:<80}", "SIMPLE  =                    T").as_bytes());
        header.extend_from_slice(format!("{:<80}", "BITPIX  =                   16").as_bytes());
        header.extend_from_slice(format!("{:<80}", "NAXIS   =                    2").as_bytes());
        header.extend_from_slice(format!("{:<80}", "NAXIS1  =                    2").as_bytes());
        header.extend_from_slice(format!("{:<80}", "NAXIS2  =                    1").as_bytes());
        header.extend_from_slice(format!("{:<80}", "END").as_bytes());
        header.resize(2880, b' ');

        let parsed = parse_fits_header(&header).expect("header should parse");

        assert_eq!(parsed.data_offset, 2880);
        assert_eq!(parsed.cards.get("BITPIX"), Some(&"16".to_string()));
        assert_eq!(parsed.cards.get("NAXIS1"), Some(&"2".to_string()));
    }

    #[test]
    fn creates_bmp_data_url() {
        let data_url = bmp_data_url_from_gray(2, 1, &[0, 255]).expect("bmp should render");

        assert!(data_url.starts_with("data:image/bmp;base64,"));
    }

    #[test]
    fn renders_small_fits_preview() {
        let mut fits = Vec::new();
        fits.extend_from_slice(format!("{:<80}", "SIMPLE  =                    T").as_bytes());
        fits.extend_from_slice(format!("{:<80}", "BITPIX  =                   16").as_bytes());
        fits.extend_from_slice(format!("{:<80}", "NAXIS   =                    2").as_bytes());
        fits.extend_from_slice(format!("{:<80}", "NAXIS1  =                    2").as_bytes());
        fits.extend_from_slice(format!("{:<80}", "NAXIS2  =                    1").as_bytes());
        fits.extend_from_slice(format!("{:<80}", "BZERO   =                32768").as_bytes());
        fits.extend_from_slice(format!("{:<80}", "BSCALE  =                    1").as_bytes());
        fits.extend_from_slice(format!("{:<80}", "END").as_bytes());
        fits.resize(2880, b' ');
        fits.extend_from_slice(&i16::MIN.to_be_bytes());
        fits.extend_from_slice(&i16::MAX.to_be_bytes());

        let preview = render_fits_to_preview(
            &fits,
            &FitsPreviewRequest {
                path: "test.fits".to_string(),
                max_size: Some(100),
                auto_stretch: Some(false),
                black_point: Some(0.0),
                midtone: Some(1.0),
                white_point: Some(65535.0),
            },
        )
        .expect("fits should render");

        assert_eq!(preview.width, 2);
        assert_eq!(preview.height, 1);
        assert_eq!(preview.black_point, 0.0);
        assert_eq!(preview.white_point, 65535.0);
        assert!(preview.data_url.starts_with("data:image/bmp;base64,"));
    }

    #[test]
    fn renders_bayer_fits_as_color_preview() {
        let mut fits = Vec::new();
        fits.extend_from_slice(format!("{:<80}", "SIMPLE  =                    T").as_bytes());
        fits.extend_from_slice(format!("{:<80}", "BITPIX  =                   16").as_bytes());
        fits.extend_from_slice(format!("{:<80}", "NAXIS   =                    2").as_bytes());
        fits.extend_from_slice(format!("{:<80}", "NAXIS1  =                    2").as_bytes());
        fits.extend_from_slice(format!("{:<80}", "NAXIS2  =                    2").as_bytes());
        fits.extend_from_slice(format!("{:<80}", "BZERO   =                32768").as_bytes());
        fits.extend_from_slice(format!("{:<80}", "BSCALE  =                    1").as_bytes());
        fits.extend_from_slice(format!("{:<80}", "BAYERPAT= 'RGGB'").as_bytes());
        fits.extend_from_slice(format!("{:<80}", "XBAYROFF=                    0").as_bytes());
        fits.extend_from_slice(format!("{:<80}", "YBAYROFF=                    0").as_bytes());
        fits.extend_from_slice(format!("{:<80}", "XBINNING=                    1").as_bytes());
        fits.extend_from_slice(format!("{:<80}", "YBINNING=                    1").as_bytes());
        fits.extend_from_slice(format!("{:<80}", "END").as_bytes());
        fits.resize(2880, b' ');
        fits.extend_from_slice(&32767i16.to_be_bytes());
        fits.extend_from_slice(&0i16.to_be_bytes());
        fits.extend_from_slice(&0i16.to_be_bytes());
        fits.extend_from_slice(&i16::MIN.to_be_bytes());

        let preview = render_fits_to_preview(
            &fits,
            &FitsPreviewRequest {
                path: "color-test.fits".to_string(),
                max_size: Some(100),
                auto_stretch: Some(true),
                black_point: None,
                midtone: Some(1.0),
                white_point: None,
            },
        )
        .expect("bayer fits should render");

        assert_eq!(preview.width, 2);
        assert_eq!(preview.height, 2);
        assert!(preview.color);
        assert!(preview.data_url.starts_with("data:image/bmp;base64,"));
    }
}
