# CachyOS Desktop Handoff

## Mission

Build and validate the **Straylight Studio operator app** on David's Linux computer. Keep the existing Windows client working. This is a native-platform validation task, not a rewrite or a migration of the telescope server.

Repository: https://github.com/lag0matic/StraylightStudio

Starting reference: `d17ecff` (Windows integration and workflow UI). Read the current repository state rather than assuming that reference is still HEAD.

David reports CachyOS, kernel `7.3.3-1-cachyos`, KWin (Wayland), and KDE Plasma 6.8.2. Record the actual installed versions locally. Linux compilation, native runtime behavior, and packaging are **not yet verified**.

## Read First

- `AGENTS.md`, if present, and applicable local instructions.
- `README.md` and `docs/astro-imaging/current-integration-state.md`.
- `docs/astro-imaging/desktop-packaging.md`.
- `package.json`, both lockfiles, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- Existing native settings, networking, FITS rendering, storage, and review implementations before changing them.

Inspect `git status` and preserve unrelated work. Use a narrowly scoped `codex/linux-cachyos` branch, or an unused branch with that prefix. Do not reset an existing checkout or force-push.

## Architecture and Boundaries

| Operator computer: Linux target | Starrunner: stays Windows |
| --- | --- |
| Tauri 2, React/TypeScript, Rust | NINA and Advanced API |
| Planning, monitoring, local FITS storage and review | PHD2, ASTAP, ASCOM/device drivers |
| Stellarium with Remote Control, when needed | Starrunner.Agent for delivery and guide telemetry |

Normal service ports are NINA 1888, agent 4787, and local Stellarium 8090. Packaged desktop networking uses native Rust HTTP/WebSockets, not the Vite development proxy. A packaged Studio does not require a development server.

**Work offline first.** Do not contact Starrunner, modify its installation, or issue equipment commands. Previous indoor motion approval is not standing authorization. No slew, tracking, park/unpark, cooling/warming, capture, autofocus, TPPA, guiding, sequence start, or meridian-flip tests without fresh approval. Later live-network checks must also be agreed with David.

Do not copy the Windows settings/run records to Linux: restored active-run ownership can have operational consequences. Before first native launch, use a separate test app identifier through an ignored local Tauri config override, and seed that profile with localhost-only fixture addresses. Follow the isolation pattern in `tools/test-standalone-network.mjs`, but not its Windows-specific launch code. Demo mode alone is not proof that every background service request is suppressed.

Do not install NINA, ASCOM, PHD2, the agent, or .NET on Linux as client prerequisites. Do not expose these trusted-LAN services to the internet.

## Environment and Dependencies

Start with read-only inspection:

```bash
git status --short
git log -1 --oneline
uname -r
printf 'Session: %s\nDesktop: %s\nWayland: %s\nDisplay: %s\n' \
  "$XDG_SESSION_TYPE" "$XDG_CURRENT_DESKTOP" "$WAYLAND_DISPLAY" "$DISPLAY"
node --version
npm --version
rustc --version
cargo --version
pkg-config --modversion gtk+-3.0 webkit2gtk-4.1 libsoup-3.0
```

`DISPLAY` can exist under Wayland because of XWayland; it does not identify an X11 session by itself. Record GPU/driver details if graphics issues arise.

Use Node 24 and a compatible stable Rust toolchain. The crate's declared minimum Rust version is not proof that every currently locked dependency supports that old compiler. Prefer the already installed compatible toolchain; ask before changing it.

Inspect installed packages before proposing installation. The [official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) list Arch dependencies including `webkit2gtk-4.1`, `base-devel`, `curl`, `wget`, `file`, `openssl`, `appmenu-gtk-module`, `libappindicator-gtk3`, `librsvg`, and `xdotool`. Recheck the current list and actual build errors; this is not a claim that every listed package is used by our app. KDE portal packages are worth inspecting if dialogs malfunction, not blindly replacing.

Ask before system package installs, browser downloads, toolchain changes, or OS upgrades. Do not run `pacman -Sy` or initiate a full rolling-release upgrade without permission. No AUR helper, GPU-driver replacement, compositor changes, or global environment workarounds as routine setup.

## Build and Automated Checks

From the repository root, once prerequisites are available:

```bash
npm ci
npm run check:app
npm run desktop:build -- --debug --no-bundle
```

Keep `package-lock.json` and `src-tauri/Cargo.lock`. Do not run `cargo update`, dependency upgrades, or automatic audit fixes to get a first build through. Expected native debug executable: `src-tauri/target/debug/straylight-studio`, unless Cargo target settings override the output directory. Configure the isolated profile before launching it.

`check:app` builds the frontend and runs operation, sequence, and Rust tests. The Windows baseline passed 87 tests on November 16, 2026; report the current actual counts and failures rather than treating that as a Linux result. Agent scripts are Windows/server work, not part of this task.

`npm run test:workflow-ui` uses mocked services and can provide additional browser-level regression coverage. Playwright is not a declared project dependency: inspect availability first. `PLAYWRIGHT_MODULE` can point to an existing Linux module URL. Do not copy the Windows module path or set `BROWSER_CHANNEL=msedge`; use a browser actually available on Linux. Request approval before installing/downloading one.

`npm run test:standalone-network` is explicitly Windows-only and uses WebView2. Do not remove its platform guard and report a Linux native pass. Browser screenshots do not validate GTK/WebKit or native dialogs. Consult [Tauri's WebDriver guidance](https://v2.tauri.app/develop/tests/webdriver/) before adding Linux-native automation; first establish a working native window and focused manual checks.

## Native Offline Acceptance Checks

Use localhost fixtures and throwaway copies of FITS files, never original archives for write tests. Include BIAS, DARK, FLAT, and a LIGHT if one is available; calibration frames are valid decoder/stretch checks but not star-detection evidence.

- Launch the native executable without Vite running; exercise Setup, Targeting, Acquisition, Review, Settings, and Diagnostics.
- Verify missing services produce readable disconnected/error states without hangs or repeated command attempts.
- Open `.fits`, `.fit`, and `.fts` through the native picker; test cancel, spaces, and non-ASCII paths. Test drag/drop from Dolphin separately, recording unsupported behavior honestly.
- Check FITS previews, Bayer color where applicable, raw statistics, histogram, stretch changes, pan/zoom, and that rendering indicators clear on success and failure.
- Select a local writable image destination; verify settings persist across restart in the test profile. Test denied/unwritable destinations without weakening validation.
- Review a copied session folder; verify thumbnails, navigation, metadata, and persisted keep/reject/undecided decisions. Review writes `.straylight-review.json` beside the reviewed data, so a read-only folder must fail clearly rather than silently lose decisions.
- Test simulated automatic delivery and restart without duplicate transfer, overwrite, or replayed capture/start commands. Preserve SHA-256/readback/acknowledgement guarantees.
- Check collapsible panels retain state and do not unmount ongoing operations. Preserve the current workflow layout; no docking framework or UI rewrite.
- Inspect 1920x1080 and a smaller desktop window, plus 3440x1440 if available. Check KDE scaling at 100/125/150 percent, text fit, icons, focus/keyboard access, dialogs, and usable controls. Note which configurations were actually tested.

Windows UNC paths are not Linux paths. Start with local storage; later test an explicitly mounted share using its Linux mount path, with David's approval before mounting or changing credentials. Do not assume `.local` discovery works or that an old LAN IP remains current.

Native transfer publication currently uses hard links. Test on a filesystem that supports them, such as ext4; FAT/exFAT support is not established. Do not replace safe publication with an overwriting rename to make a filesystem test pass. Preserve path containment checks and verify platform-specific atomic-write/directory-sync behavior.

For Wayland rendering or dialog problems, capture logs and a minimal reproduction first. Temporary per-process experiments may help diagnosis, but do not permanently disable Wayland, GPU acceleration, certificate verification, or security checks. Distinguish native Wayland from an XWayland workaround in results.

## Packaging and Handoff

After the native offline checks, try a release build without bundling:

```bash
npm run desktop:build -- --no-bundle
```

Expected executable: `src-tauri/target/release/straylight-studio`. Only then consider an AppImage using the installed CLI's supported options and [official AppImage instructions](https://v2.tauri.app/distribute/appimage/). Do not begin with `targets: all` or assume Debian/RPM artifacts are appropriate for CachyOS. A build on a new rolling distribution does not establish compatibility with older Linux systems.

Record exact OS/session/tool versions, source commit, commands, failures, fixes, artifact paths, and screenshots where useful. Distinguish compiled, unit-tested, browser-tested, native-tested, packaged, and real-equipment-tested. Update the integration-state and packaging docs only with results actually observed. Leave sky-dependent autofocus, TPPA, guiding/dithering, plate-solving, and meridian-flip claims unchanged.

Keep fixes small and cross-platform. Do not commit test identities, personal settings, credentials, generated binaries, downloaded fixtures, or machine-specific workarounds. Summarize how to reproduce and recover from any remaining issue, and ask before publishing a new branch if David has not authorized that step.
