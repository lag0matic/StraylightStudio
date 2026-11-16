use super::*;

#[test]
#[ignore = "camera-sized synthetic FITS check; allocates full-resolution image samples"]
fn camera_sized_fits_preserves_raw_analysis_across_stretch() {
    let directory = TestFolder::new();
    let path = directory.0.join("camera-sized synthetic.fits");
    let cards = [
        "SIMPLE  =                    T", "BITPIX  =                   16",
        "NAXIS   =                    2", "NAXIS1  =                 5496",
        "NAXIS2  =                 3672", "BZERO   =                32768",
        "BSCALE  =                    1", "BAYERPAT= 'RGGB'",
    ];
    let mut header = cards.iter().flat_map(|card| format!("{card:<80}").into_bytes()).collect::<Vec<_>>();
    header.resize(2880, b' ');
    header.extend_from_slice(format!("{:<80}", "END").as_bytes());
    header.resize(5760, b' ');
    let row = (0..5496).flat_map(|x| ((1000 + (x % 256) * 16 - 32768) as i16).to_be_bytes()).collect::<Vec<_>>();
    let mut file = fs::File::create(&path).unwrap();
    file.write_all(&header).unwrap();
    for _ in 0..3672 { file.write_all(&row).unwrap(); }
    let padding = (2880 - (row.len() * 3672) % 2880) % 2880;
    file.write_all(&vec![0; padding]).unwrap();
    drop(file);
    let before = fs::metadata(&path).unwrap();
    let original_hash = sha256_hex(&fs::read(&path).unwrap());
    let mut request = FitsPreviewRequest {
        path: path.to_string_lossy().into(), max_size: Some(960), auto_stretch: Some(true),
        black_point: None, midtone: None, white_point: None,
    };
    let started = std::time::Instant::now();
    let auto = render_fits_preview_from_path(path.clone(), &request).unwrap();
    let first = started.elapsed();
    let analysis = auto.analysis.as_ref().unwrap();
    assert_eq!((analysis.width, analysis.height, analysis.valid_samples), (5496, 3672, 20_181_312));
    assert_eq!(analysis.median, Some(3000.0));
    assert!((analysis.mean.unwrap() - 3016.244541484716).abs() < 0.000001, "mean {:?}", analysis.mean);
    assert_eq!((analysis.min, analysis.max), (Some(1000.0), Some(5080.0)));
    assert_eq!(analysis.histogram.iter().sum::<u64>(), 20_181_312);
    assert!(auto.color);
    request.auto_stretch = Some(false);
    request.black_point = Some(1000.0); request.white_point = Some(5080.0); request.midtone = Some(1.8);
    let started = std::time::Instant::now();
    let manual = render_fits_preview_from_path(path.clone(), &request).unwrap();
    let restretch = started.elapsed();
    assert_ne!(auto.data_url, manual.data_url);
    assert_eq!(serde_json::to_value(&auto.analysis).unwrap(), serde_json::to_value(&manual.analysis).unwrap());
    assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), before.modified().unwrap());
    assert_eq!(sha256_hex(&fs::read(&path).unwrap()), original_hash);
    println!("Camera-sized FITS: {} bytes; initial {:?}; cached stretch {:?}; preview {}x{}; source unchanged", before.len(), first, restretch, auto.width, auto.height);
}

#[test]
fn storage_write_probe_requires_a_directory_and_leaves_no_files() {
    let directory = TestFolder::new();
    assert!(storage_root_writable(&directory.0));
    assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 0);
    assert!(!storage_root_writable(&directory.0.join("missing")));
    let file = directory.0.join("file");
    fs::write(&file, b"original").unwrap();
    assert!(!storage_root_writable(&file));
    assert_eq!(fs::read(&file).unwrap(), b"original");
}

#[cfg(unix)]
#[test]
fn storage_write_probe_rejects_a_read_only_directory() {
    use std::os::unix::fs::PermissionsExt;
    let directory = TestFolder::new();
    let original = fs::metadata(&directory.0).unwrap().permissions();
    fs::set_permissions(&directory.0, fs::Permissions::from_mode(0o555)).unwrap();
    let writable = storage_root_writable(&directory.0);
    // Restore permissions before asserting so the temporary test folder is cleanable.
    fs::set_permissions(&directory.0, original).unwrap();
    assert!(!writable, "read-only destination must not be advertised as writable");
    assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 0);
}

#[test]
fn settings_are_replaced_as_complete_json_and_failed_publication_is_reported() {
    let directory = TestFolder::new();
    let path = directory.0.join("settings.json");
    write_settings(&path, &json!({"plan":"old", "run":null})).unwrap();
    write_settings(&path, &json!({"plan":"new", "run":{"id":"test-run"}})).unwrap();
    assert_eq!(read_settings(&path).unwrap(), json!({"plan":"new", "run":{"id":"test-run"}}));
    let invalid = directory.0.join("directory");
    fs::create_dir(&invalid).unwrap();
    assert!(write_settings(&invalid, &json!({"run":"cannot publish"})).is_err());
    assert_eq!(read_settings(&path).unwrap()["plan"], "new");
    assert!(!fs::read_dir(&directory.0).unwrap().any(|entry| entry.unwrap().file_name().to_string_lossy().ends_with(".partial")));
}

struct TestFolder(PathBuf);

impl TestFolder {
    fn new() -> Self {
        let root = std::env::temp_dir().canonicalize().unwrap();
        let stamp = SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let path = root.join(format!("straylight-storage-test-{}-{stamp}-{}", std::process::id(), TEMPORARY_ID.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for TestFolder {
    fn drop(&mut self) {
        let root = std::env::temp_dir().canonicalize().unwrap();
        let resolved = self.0.canonicalize().unwrap();
        assert_eq!(resolved.parent(), Some(root.as_path()));
        assert!(resolved.file_name().unwrap().to_string_lossy().starts_with("straylight-storage-test-"));
        fs::remove_dir_all(resolved).unwrap();
    }
}

fn request(name: &str, bytes: &[u8]) -> WriteFrameRequest {
    WriteFrameRequest {
        session_folder: "sep272026_m31_light".into(), file_name: name.into(),
        image_type: "LIGHT".into(), target_name: "M31".into(), frame_number: 1,
        captured_at: Some("2026-09-27T22:00:00Z".into()), data_base64: BASE64_STANDARD.encode(bytes),
        expected_sha256: sha256_hex(bytes), expected_size_bytes: bytes.len() as u64,
    }
}

fn lookup(bytes: &[u8]) -> ExistingFrameRequest {
    ExistingFrameRequest { session_folder: "sep272026_m31_light".into(), file_name: "1.fits".into(), sha256: sha256_hex(bytes), size_bytes: bytes.len() as u64 }
}

#[test]
fn new_image_is_read_back_and_recorded() {
    let directory = TestFolder::new();
    let result = store_frame(&directory.0, request("1.fits", b"frame one")).unwrap();
    assert_eq!(fs::read(&result.frame.path).unwrap(), b"frame one");
    assert_eq!(result.frame.sha256, sha256_hex(&fs::read(&result.frame.path).unwrap()));
    let manifest = read_session_manifest(&PathBuf::from(result.manifest_path), "sep272026_m31_light").unwrap();
    assert_eq!(manifest.frames.len(), 1);
    assert!(find_verified_frame(&directory.0, lookup(b"frame one")).unwrap().found);
}

#[test]
fn duplicate_is_reused_and_manifest_has_one_entry() {
    let directory = TestFolder::new();
    let first = store_frame(&directory.0, request("1.fits", b"same")).unwrap();
    let modified = fs::metadata(&first.frame.path).unwrap().modified().unwrap();
    let second = store_frame(&directory.0, request("1.fits", b"same")).unwrap();
    assert_eq!(modified, fs::metadata(&second.frame.path).unwrap().modified().unwrap());
    assert_eq!(read_session_manifest(&PathBuf::from(second.manifest_path), "session").unwrap().frames.len(), 1);
}

#[test]
fn collision_preserves_image_and_manifest() {
    let directory = TestFolder::new();
    let first = store_frame(&directory.0, request("1.fits", b"original")).unwrap();
    let manifest = fs::read(&first.manifest_path).unwrap();
    let error = store_frame(&directory.0, request("1.fits", b"different")).unwrap_err();
    assert!(error.contains("never overwritten"));
    assert_eq!(fs::read(&first.frame.path).unwrap(), b"original");
    assert_eq!(fs::read(&first.manifest_path).unwrap(), manifest);
}

#[test]
fn wrong_download_hash_or_size_never_publishes() {
    let directory = TestFolder::new();
    let mut wrong_hash = request("1.fits", b"frame");
    wrong_hash.expected_sha256 = sha256_hex(b"other");
    assert!(store_frame(&directory.0, wrong_hash).is_err());
    let mut wrong_size = request("1.fits", b"frame");
    wrong_size.expected_size_bytes += 1;
    assert!(store_frame(&directory.0, wrong_size).is_err());
    assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 0);
}

#[test]
fn truncated_staging_file_is_not_published() {
    let directory = TestFolder::new();
    let (temporary, mut file) = TemporaryFile::create(&directory.0).unwrap();
    file.write_all(b"partial").unwrap();
    drop(file);
    let destination = directory.0.join("1.fits");
    assert!(publish_image(&temporary.0, &destination, &sha256_hex(b"complete frame"), 14).is_err());
    assert!(!destination.exists());
}

#[test]
fn competing_destination_cannot_be_replaced_at_publication() {
    let directory = TestFolder::new();
    let (temporary, mut file) = TemporaryFile::create(&directory.0).unwrap();
    file.write_all(b"new").unwrap();
    file.sync_all().unwrap();
    drop(file);
    let destination = directory.0.join("1.fits");
    fs::write(&destination, b"old").unwrap();
    assert!(publish_image(&temporary.0, &destination, &sha256_hex(b"new"), 3).is_err());
    assert_eq!(fs::read(destination).unwrap(), b"old");
}

#[test]
fn interrupted_transfer_after_image_publication_repairs_manifest() {
    let directory = TestFolder::new();
    let destination = image_destination(&directory.0, "sep272026_m31_light", "1.fits").unwrap();
    fs::write(&destination, b"recovered").unwrap();
    // Simulate a process dying after image publication but before manifest commit.
    assert!(!find_verified_frame(&directory.0, lookup(b"recovered")).unwrap().found);
    store_frame(&directory.0, request("1.fits", b"recovered")).unwrap();
    assert!(find_verified_frame(&directory.0, lookup(b"recovered")).unwrap().found);
    assert_eq!(fs::read(destination).unwrap(), b"recovered");
}

#[test]
fn abandoned_partial_file_is_not_treated_as_delivered() {
    let directory = TestFolder::new();
    let destination = image_destination(&directory.0, "sep272026_m31_light", "1.fits").unwrap();
    let partial = destination.parent().unwrap().join(".straylight-old.partial");
    fs::write(&partial, b"truncated").unwrap();
    assert!(!find_verified_frame(&directory.0, lookup(b"whole")).unwrap().found);
    store_frame(&directory.0, request("1.fits", b"whole")).unwrap();
    assert_eq!(fs::read(destination).unwrap(), b"whole");
    assert_eq!(fs::read(partial).unwrap(), b"truncated");
}

#[test]
fn corrupt_existing_image_cannot_be_acknowledged() {
    let directory = TestFolder::new();
    let result = store_frame(&directory.0, request("1.fits", b"original")).unwrap();
    fs::write(&result.frame.path, b"damaged").unwrap();
    assert!(find_verified_frame(&directory.0, lookup(b"original")).is_err());
    assert!(store_frame(&directory.0, request("1.fits", b"original")).is_err());
    assert_eq!(fs::read(&result.frame.path).unwrap(), b"damaged");
}

#[test]
fn manifest_absolute_path_is_not_trusted() {
    let directory = TestFolder::new();
    let result = store_frame(&directory.0, request("1.fits", b"original")).unwrap();
    let outside = directory.0.join("outside.fits");
    fs::rename(&result.frame.path, &outside).unwrap();
    let manifest_file = PathBuf::from(result.manifest_path);
    let mut manifest = read_session_manifest(&manifest_file, "session").unwrap();
    manifest.frames[0].path = outside.to_string_lossy().to_string();
    write_session_manifest(&manifest_file, &manifest).unwrap();
    assert!(!find_verified_frame(&directory.0, lookup(b"original")).unwrap().found);
}

#[test]
fn malformed_manifest_is_preserved_and_blocks_acknowledgement() {
    let directory = TestFolder::new();
    let destination = image_destination(&directory.0, "sep272026_m31_light", "1.fits").unwrap();
    let manifest = destination.parent().unwrap().join("manifest.json");
    fs::write(&manifest, b"broken manifest").unwrap();
    assert!(store_frame(&directory.0, request("1.fits", b"image")).is_err());
    assert!(!destination.exists());
    assert_eq!(fs::read(manifest).unwrap(), b"broken manifest");
}

#[test]
fn concurrent_images_keep_both_manifest_entries() {
    let directory = TestFolder::new();
    std::thread::scope(|scope| {
        let first = scope.spawn(|| store_frame(&directory.0, request("1.fits", b"first")));
        let second = scope.spawn(|| store_frame(&directory.0, request("2.fits", b"second")));
        first.join().unwrap().unwrap();
        second.join().unwrap().unwrap();
    });
    let manifest = read_session_manifest(&directory.0.join("sep272026_m31_light/manifest.json"), "session").unwrap();
    assert_eq!(manifest.frames.len(), 2);
}

#[test]
fn failed_manifest_commit_preserves_previous_manifest_and_retries() {
    let directory = TestFolder::new();
    let first = store_frame(&directory.0, request("1.fits", b"first")).unwrap();
    let previous_manifest = fs::read(&first.manifest_path).unwrap();
    let result = store_frame_with_commit(&directory.0, request("2.fits", b"second"), |_, _| {
        Err("Simulated manifest commit failure".into())
    });
    assert!(result.is_err());
    assert_eq!(fs::read(&first.manifest_path).unwrap(), previous_manifest);
    assert_eq!(fs::read(directory.0.join("sep272026_m31_light/2.fits")).unwrap(), b"second");
    store_frame(&directory.0, request("2.fits", b"second")).unwrap();
    let repaired = read_session_manifest(&PathBuf::from(first.manifest_path), "session").unwrap();
    assert_eq!(repaired.frames.len(), 2);
}
