use std::{collections::HashMap, fs, path::PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

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
}

#[derive(Debug, Deserialize)]
struct FitsPreviewRequest {
    path: String,
    max_size: Option<u32>,
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
struct FitsPreviewResult {
    data_url: String,
    width: u32,
    height: u32,
    source_path: String,
}

#[derive(Debug)]
struct FitsHeader {
    cards: HashMap<String, String>,
    data_offset: usize,
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
    fs::write(path, format!("{body}\n")).map_err(|error| error.to_string())
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

fn bmp_data_url_from_gray(width: u32, height: u32, pixels: &[u8]) -> Result<String, String> {
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
            let value = pixels[row_start + col];
            bmp.extend_from_slice(&[value, value, value]);
        }
        bmp.extend(std::iter::repeat(0).take(padding));
    }

    Ok(format!(
        "data:image/bmp;base64,{}",
        BASE64_STANDARD.encode(bmp)
    ))
}

fn render_fits_to_preview(
    bytes: &[u8],
    request: &FitsPreviewRequest,
) -> Result<FitsPreviewResult, String> {
    let header = parse_fits_header(bytes)?;
    let naxis = fits_i64(&header.cards, "NAXIS")?;
    if naxis < 2 {
        return Err("FITS image must have at least two axes".to_string());
    }

    let source_width = fits_i64(&header.cards, "NAXIS1")? as usize;
    let source_height = fits_i64(&header.cards, "NAXIS2")? as usize;
    let bitpix = fits_i64(&header.cards, "BITPIX")?;
    let bzero = fits_f64(&header.cards, "BZERO", 0.0);
    let bscale = fits_f64(&header.cards, "BSCALE", 1.0);
    let max_size = request.max_size.unwrap_or(1400).clamp(128, 2400) as usize;
    let scale = (max_size as f64 / source_width.max(source_height) as f64).min(1.0);
    let width = ((source_width as f64 * scale).round() as usize).max(1);
    let height = ((source_height as f64 * scale).round() as usize).max(1);
    let data = bytes
        .get(header.data_offset..)
        .ok_or_else(|| "FITS data section is missing".to_string())?;
    let black = request.black_point.unwrap_or(0.0);
    let white = request.white_point.unwrap_or(65535.0).max(black + 1.0);
    let midtone = request.midtone.unwrap_or(1.0).clamp(0.05, 8.0);
    let gamma = 1.0 / midtone;
    let mut pixels = Vec::with_capacity(width * height);

    for y in 0..height {
        let source_y = ((y as f64 / scale).floor() as usize).min(source_height - 1);
        for x in 0..width {
            let source_x = ((x as f64 / scale).floor() as usize).min(source_width - 1);
            let value = read_fits_value(
                data,
                bitpix,
                source_y * source_width + source_x,
                bzero,
                bscale,
            )?;
            let normalized = ((value - black) / (white - black))
                .clamp(0.0, 1.0)
                .powf(gamma);
            pixels.push((normalized * 255.0).round() as u8);
        }
    }

    Ok(FitsPreviewResult {
        data_url: bmp_data_url_from_gray(width as u32, height as u32, &pixels)?,
        width: width as u32,
        height: height as u32,
        source_path: request.path.clone(),
    })
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
    let safe_session_folder =
        require_safe_relative_component("session folder", &request.session_folder)?;
    let safe_file_name = require_safe_relative_component("file name", &request.file_name)?;
    let root = storage_root_from_settings(&app)?;
    let session_dir = root.join(&safe_session_folder);

    fs::create_dir_all(&session_dir).map_err(|error| error.to_string())?;

    let bytes = BASE64_STANDARD
        .decode(request.data_base64.as_bytes())
        .map_err(|error| error.to_string())?;
    let frame_path = session_dir.join(&safe_file_name);
    fs::write(&frame_path, &bytes).map_err(|error| error.to_string())?;

    let manifest_file = manifest_path(&session_dir);
    let mut manifest = read_session_manifest(&manifest_file, &safe_session_folder)?;
    let frame = FrameManifestEntry {
        frame_number: request.frame_number.max(1),
        file_name: safe_file_name,
        path: frame_path.to_string_lossy().to_string(),
        size_bytes: bytes.len() as u64,
        sha256: sha256_hex(&bytes),
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
    write_session_manifest(&manifest_file, &manifest)?;

    Ok(WriteFrameResult {
        frame,
        manifest_path: manifest_file.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn render_fits_preview(
    app: AppHandle,
    request: FitsPreviewRequest,
) -> Result<FitsPreviewResult, String> {
    let path = require_path_under_storage_root(&app, &request.path)?;
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    render_fits_to_preview(&bytes, &request)
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
            render_fits_preview,
            find_siril
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

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
                black_point: Some(0.0),
                midtone: Some(1.0),
                white_point: Some(65535.0),
            },
        )
        .expect("fits should render");

        assert_eq!(preview.width, 2);
        assert_eq!(preview.height, 1);
        assert!(preview.data_url.starts_with("data:image/bmp;base64,"));
    }
}
