use crate::{
    parse_fits_header, render_cached_fits_preview, render_fits_preview_from_path,
    sample_fits_preview, sha256_hex, sync_directory, verify_file, FitsPreviewRequest,
    FitsPreviewResult, TemporaryFile,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};

const SIDECAR: &str = ".straylight-review.json";
static SAVE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    Keep,
    Reject,
    Undecided,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    fingerprint: String,
    decision: Decision,
}
#[derive(Serialize, Deserialize)]
struct Decisions {
    version: u32,
    frames: BTreeMap<String, Entry>,
}

#[derive(Serialize)]
pub struct ReviewFrame {
    relative_path: String,
    fingerprint: String,
    size_bytes: u64,
    decision: Decision,
    metadata: BTreeMap<String, String>,
    error: Option<String>,
}
#[derive(Serialize)]
pub struct ReviewFolder {
    root: String,
    frames: Vec<ReviewFrame>,
    warnings: Vec<String>,
    decision_error: Option<String>,
}

fn folder(path: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !root.is_dir() {
        return Err("Select a folder for session review".into());
    }
    Ok(root)
}
fn is_fits(path: &Path) -> bool {
    path.extension()
        .and_then(|v| v.to_str())
        .is_some_and(|v| ["fits", "fit", "fts"].contains(&v.to_ascii_lowercase().as_str()))
}
fn scanned_relative_path(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path.strip_prefix(root).map_err(|e| e.to_string())?;
    // Stripping a Windows verbatim UNC share root can retain its root separator.
    // Rebuild from normal components only after confirming the parent prefix.
    let mut components = relative.components().peekable();
    if matches!(components.peek(), Some(Component::RootDir)) {
        components.next();
    }
    let mut names = Vec::new();
    for component in components {
        match component {
            Component::Normal(name) => names.push(name.to_string_lossy().into_owned()),
            _ => return Err("Invalid scanned review frame path".into()),
        }
    }
    if names.is_empty() {
        return Err("Missing scanned review frame path".into());
    }
    Ok(names.join("/"))
}
fn frame_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if path
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
        || !is_fits(path)
    {
        return Err("Invalid review frame path".into());
    }
    let resolved = fs::canonicalize(root.join(path)).map_err(|e| e.to_string())?;
    if !resolved.starts_with(root) || !resolved.is_file() {
        return Err("Frame is outside the review folder".into());
    }
    Ok(resolved)
}
fn fingerprint(path: &Path) -> Result<String, String> {
    let info = fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = info
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    Ok(format!("{}:{}", info.len(), modified.as_nanos()))
}
fn verify_frame(root: &Path, relative: &str, expected: &str) -> Result<PathBuf, String> {
    let path = frame_path(root, relative)?;
    if fingerprint(&path)? != expected {
        return Err("Frame changed since scanning. Refresh the folder before reviewing it.".into());
    }
    Ok(path)
}
fn read_decisions(root: &Path) -> Result<Decisions, String> {
    let path = root.join(SIDECAR);
    match fs::symlink_metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Decisions {
                version: 1,
                frames: BTreeMap::new(),
            })
        }
        Err(e) => return Err(e.to_string()),
        Ok(info) if !info.file_type().is_file() || info.len() > 16 * 1024 * 1024 => {
            return Err("Review sidecar is not a regular file or exceeds 16 MiB".into())
        }
        _ => {}
    }
    let data: Decisions = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Cannot read review decisions: {e}"))?;
    if data.version != 1 {
        return Err("Unsupported review sidecar version; existing file preserved".into());
    }
    Ok(data)
}
fn read_metadata(path: &Path) -> Result<BTreeMap<String, String>, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    for _ in 0..360 {
        let mut block = [0; 2880];
        file.read_exact(&mut block)
            .map_err(|e| format!("Incomplete FITS header: {e}"))?;
        let end = block.chunks_exact(80).any(|card| &card[..8] == b"END     ");
        bytes.extend_from_slice(&block);
        if end {
            let header = parse_fits_header(&bytes)?;
            return Ok([
                "OBJECT", "IMAGETYP", "EXPTIME", "EXPOSURE", "CCD-TEMP", "GAIN", "OFFSET",
                "FILTER", "DATE-OBS",
            ]
            .iter()
            .filter_map(|key| header.cards.get(*key).map(|v| (key.to_string(), v.clone())))
            .collect());
        }
    }
    Err("FITS header exceeds 1 MiB".into())
}

fn scan(root: PathBuf) -> Result<ReviewFolder, String> {
    let (decisions, decision_error) = match read_decisions(&root) {
        Ok(data) => (data.frames, None),
        Err(error) => (BTreeMap::new(), Some(error)),
    };
    let mut result = ReviewFolder {
        root: root.to_string_lossy().into(),
        frames: Vec::new(),
        warnings: Vec::new(),
        decision_error,
    };
    let mut pending = vec![root.clone()];
    let mut visited = HashSet::new();
    let mut examined = 0usize;
    while let Some(directory) = pending.pop() {
        let canonical = match fs::canonicalize(&directory) {
            Ok(p) => p,
            Err(e) => {
                result.warnings.push(e.to_string());
                continue;
            }
        };
        if !canonical.starts_with(&root) || !visited.insert(canonical) {
            continue;
        }
        let entries = match fs::read_dir(&directory) {
            Ok(v) => v,
            Err(e) => {
                result
                    .warnings
                    .push(format!("{}: {e}", directory.display()));
                continue;
            }
        };
        for entry in entries {
            examined += 1;
            if examined > 20000 {
                result.warnings.push("Scan limited to 20,000 entries. Open a smaller folder to review the remainder.".into());
                return Ok(result);
            }
            let entry = match entry {
                Ok(v) => v,
                Err(e) => {
                    result.warnings.push(e.to_string());
                    continue;
                }
            };
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() {
                continue;
            }
            let path = entry.path();
            if kind.is_dir() {
                pending.push(path);
                continue;
            }
            if !kind.is_file() || !is_fits(&path) {
                continue;
            }
            let relative = scanned_relative_path(&root, &path)?;
            let stamp = match fingerprint(&path) {
                Ok(v) => v,
                Err(e) => {
                    result.warnings.push(format!("{relative}: {e}"));
                    continue;
                }
            };
            let saved = decisions.get(&relative);
            let decision = saved
                .filter(|entry| entry.fingerprint == stamp)
                .map(|e| e.decision.clone())
                .unwrap_or(Decision::Undecided);
            if saved.is_some_and(|entry| entry.fingerprint != stamp) {
                result.warnings.push(format!(
                    "{relative}: file changed; previous decision reset to undecided."
                ));
            }
            let (metadata, error) = match read_metadata(&path) {
                Ok(v) => (v, None),
                Err(e) => (BTreeMap::new(), Some(e)),
            };
            result.frames.push(ReviewFrame {
                relative_path: relative,
                fingerprint: stamp,
                size_bytes: fs::metadata(&path).map_err(|e| e.to_string())?.len(),
                decision,
                metadata,
                error,
            });
        }
    }
    Ok(result)
}

fn save(root: &Path, relative: &str, expected: &str, decision: Decision) -> Result<(), String> {
    let _guard = SAVE_LOCK.lock().map_err(|e| e.to_string())?;
    verify_frame(root, relative, expected)?;
    let mut data = read_decisions(root)?;
    data.frames.insert(
        relative.replace('\\', "/"),
        Entry {
            fingerprint: expected.into(),
            decision,
        },
    );
    let body = serde_json::to_vec_pretty(&data).map_err(|e| e.to_string())?;
    if body.len() > 16 * 1024 * 1024 {
        return Err("Review decisions exceed 16 MiB; existing sidecar preserved".into());
    }
    let (temporary, mut file) = TemporaryFile::create(root)?;
    file.write_all(&body).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    verify_file(&temporary.0, &sha256_hex(&body), body.len() as u64)?;
    fs::rename(&temporary.0, root.join(SIDECAR))
        .map_err(|e| format!("Could not save review decisions: {e}"))?;
    sync_directory(root)
}

#[tauri::command]
pub async fn review_open(root: String) -> Result<ReviewFolder, String> {
    tauri::async_runtime::spawn_blocking(move || scan(folder(&root)?))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn review_decide(
    root: String,
    relative: String,
    expected: String,
    decision: Decision,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        save(&folder(&root)?, &relative, &expected, decision)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn review_preview(
    root: String,
    relative: String,
    expected: String,
    thumbnail: bool,
) -> Result<FitsPreviewResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = verify_frame(&folder(&root)?, &relative, &expected)?;
        let request = FitsPreviewRequest {
            path: path.to_string_lossy().into(),
            max_size: Some(if thumbnail { 128 } else { 1400 }),
            auto_stretch: Some(true),
            black_point: None,
            white_point: None,
            midtone: Some(1.0),
        };
        let result = if thumbnail {
            let preview = sample_fits_preview(
                &fs::read(&path).map_err(|e| e.to_string())?,
                &request,
                path.clone(),
                None,
                false,
            )?;
            render_cached_fits_preview(&preview, &request)?
        } else {
            render_fits_preview_from_path(path.clone(), &request)?
        };
        if fingerprint(&path)? != expected {
            return Err("Frame changed while reading. Refresh the folder.".into());
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn metadata_reads_without_loading_pixel_data() {
        let dir = TestDir::new();
        let path = dir.0.join("metadata.fits");
        let cards = [
            "SIMPLE  =                    T",
            "BITPIX  =                   16",
            "NAXIS   =                    2",
            "NAXIS1  =                    2",
            "NAXIS2  =                    1",
            "EXPTIME =                 60.0",
            "CCD-TEMP=                -15.0",
            "GAIN    =                  200",
            "IMAGETYP= 'DARK'",
            "END",
        ];
        let mut bytes = cards
            .iter()
            .flat_map(|card| format!("{card:<80}").into_bytes())
            .collect::<Vec<_>>();
        bytes.resize(2880, b' ');
        fs::write(&path, bytes).unwrap();
        let metadata = read_metadata(&path).unwrap();
        assert_eq!(metadata.get("EXPTIME").unwrap(), "60.0");
        assert_eq!(metadata.get("CCD-TEMP").unwrap(), "-15.0");
        assert_eq!(metadata.get("GAIN").unwrap(), "200");
        assert_eq!(metadata.get("IMAGETYP").unwrap(), "DARK");
    }
    #[cfg(windows)]
    #[test]
    fn unc_share_root_produces_relative_frame_paths() {
        for root in [
            r"\\?\UNC\storage\Astro_12TB",
            r"\\?\UNC\storage\Astro_12TB\",
            r"\\storage\Astro_12TB",
            r"\\?\UNC\storage\Astro_12TB\session",
            r"\\?\D:\Astro",
            r"D:\Astro",
        ] {
            let root = Path::new(root);
            let path = root.join(r"BIASES\frame.fits");
            let relative = scanned_relative_path(root, &path).unwrap();
            assert_eq!(relative, "BIASES/frame.fits", "root: {}", root.display());
            assert!(Path::new(&relative)
                .components()
                .all(|part| matches!(part, Component::Normal(_))));
        }
        assert!(scanned_relative_path(
            Path::new(r"\\storage\Astro_12TB"),
            Path::new(r"\\other\share\frame.fits")
        )
        .is_err());
    }
    struct TestDir(PathBuf);
    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
                "straylight-review-test-{}-{}",
                std::process::id(),
                crate::TEMPORARY_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let root = self.0.canonicalize().unwrap();
            assert_eq!(
                root.parent(),
                Some(std::env::temp_dir().canonicalize().unwrap().as_path())
            );
            assert!(root
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("straylight-review-test-"));
            fs::remove_dir_all(root).unwrap();
        }
    }
    #[test]
    fn decisions_survive_reopen_without_changing_images() {
        let dir = TestDir::new();
        let image = dir.0.join("1.fits");
        fs::write(&image, b"original").unwrap();
        let stamp = fingerprint(&image).unwrap();
        save(&dir.0, "1.fits", &stamp, Decision::Keep).unwrap();
        assert_eq!(
            scan(dir.0.clone()).unwrap().frames[0].decision,
            Decision::Keep
        );
        save(&dir.0, "1.fits", &stamp, Decision::Reject).unwrap();
        assert_eq!(
            scan(dir.0.clone()).unwrap().frames[0].decision,
            Decision::Reject
        );
        assert_eq!(fs::read(image).unwrap(), b"original");
    }
    #[test]
    fn changed_files_reset_decisions_and_refuse_stale_saves() {
        let dir = TestDir::new();
        let image = dir.0.join("1.fit");
        fs::write(&image, b"old").unwrap();
        let stamp = fingerprint(&image).unwrap();
        save(&dir.0, "1.fit", &stamp, Decision::Keep).unwrap();
        fs::write(&image, b"new contents").unwrap();
        assert_eq!(
            scan(dir.0.clone()).unwrap().frames[0].decision,
            Decision::Undecided
        );
        assert!(save(&dir.0, "1.fit", &stamp, Decision::Reject).is_err());
    }
    #[test]
    fn malformed_sidecar_is_preserved() {
        let dir = TestDir::new();
        let image = dir.0.join("1.fits");
        fs::write(&image, b"fits").unwrap();
        fs::write(dir.0.join(SIDECAR), b"broken").unwrap();
        assert!(scan(dir.0.clone()).unwrap().decision_error.is_some());
        assert!(save(
            &dir.0,
            "1.fits",
            &fingerprint(&image).unwrap(),
            Decision::Keep
        )
        .is_err());
        assert_eq!(fs::read(dir.0.join(SIDECAR)).unwrap(), b"broken");
    }
    #[test]
    fn nested_files_and_bad_headers_do_not_stop_scan() {
        let dir = TestDir::new();
        fs::create_dir(dir.0.join("LIGHT")).unwrap();
        fs::write(dir.0.join("LIGHT/2.FITS"), b"bad").unwrap();
        fs::write(dir.0.join("notes.txt"), b"skip").unwrap();
        let result = scan(dir.0.clone()).unwrap();
        assert_eq!(result.frames.len(), 1);
        assert_eq!(result.frames[0].relative_path, "LIGHT/2.FITS");
        assert!(result.frames[0].error.is_some());
        assert!(frame_path(&dir.0, "../escape.fits").is_err());
        assert!(frame_path(&dir.0, "notes.txt").is_err());
    }
}
