# Desktop Packaging

This note tracks the practical path from development shell to a locally installable Straylight Studio desktop app.

## App Identity

- Product name: `Straylight Studio`
- App identifier: `com.straylightastro.studio`
- Rust crate: `straylight-studio`
- Default window title: `Straylight Studio`
- Default dev URL: `http://localhost:5174`
- Frontend build output: `dist`
- Tauri project: `src-tauri`

## Local Build Commands

From the repository root:

```powershell
npm install
npm run check:app
npm run desktop:build
```

`npm run check:app` runs the frontend production build and Rust/Tauri tests.

The desktop bundle output is under:

```text
src-tauri\target\release\bundle\
```

The exact installer subfolder depends on the host platform and Tauri bundle target.

## Windows Build Notes

For the main Windows workstation, the expected build is:

```powershell
npm run desktop:build
```

The unpackaged executable is normally:

```text
src-tauri\target\release\straylight-studio.exe
```

The packaged installers are currently produced at:

```text
src-tauri\target\release\bundle\nsis\Straylight Studio_0.1.0_x64-setup.exe
src-tauri\target\release\bundle\msi\Straylight Studio_0.1.0_x64_en-US.msi
```

This was verified on the Windows development machine on June 17, 2026 with `npm run desktop:build`.

The current packaging goal is local use, not public distribution. Code signing, auto-update, and branded installer polish can wait until the control workflow is stable.

## Linux Build Notes

For CachyOS / KDE Wayland validation, follow the [Linux handoff](linux-cachyos-handoff.md). Start with an isolated offline profile and an unpackaged build. Initial target-machine results and remaining acceptance checks are recorded below.

On November 16, 2026, source `8d5a366` built successfully on CachyOS with Node 24.22.3 and Rust 1.94.1. The production frontend build, 49 JavaScript tests, and 37 Rust tests passed. An isolated debug build using `npm run desktop:build -- --debug --no-bundle --config tmp/linux-offline/tauri.conf.json` launched without Vite; David confirmed the window renders normally in his KDE Wayland session. The override and separate XDG profile are local ignored files, with only localhost service addresses and network access disabled for the launch. This establishes compilation and initial startup, not complete native acceptance or packaging. See [Current Integration State](current-integration-state.md#november-16-linux-offline-validation) for tested versions and remaining checks. No system package installs or application source fixes were needed for this build.

The unpackaged optimized release build also passed with `npm run desktop:build -- --no-bundle --config tmp/linux-offline/tauri.conf.json`; output is `src-tauri/target/release/straylight-studio` (approximately 18 MiB). This executable retains the test identifier from the override: use the local isolation launcher and seeded test profile for validation, rather than treating it as a normal-profile release. Native Review folder selection, synthetic FITS previews/error handling, and saving a Keep decision were confirmed in the debug app; source FITS hashes remained unchanged.

After closing the debug app and opening the release executable in the same isolated profile, David confirmed that reopening the last review folder restored the session and LIGHT Keep decision.

An AppImage was then built successfully using the installed Tauri CLI and cached linuxdeploy tools:

```bash
NO_STRIP=1 npm run desktop:build -- --bundles appimage --config tmp/linux-offline/tauri.conf.json --verbose
```

Without `NO_STRIP`, linuxdeploy's bundled `strip` rejected `.relr.dyn` sections in CachyOS libraries. This command-local workaround is described in [linuxdeploy issue 272](https://github.com/linuxdeploy/linuxdeploy/issues/272); no global environment, dependency, or system package change was made. The isolated-validation build produced `src-tauri/target/release/bundle/appimage/Straylight Studio_0.1.0_amd64.AppImage`, approximately 108 MiB, with SHA-256 `924f34c5d1f8bbcab2161135d017d6620ab2ee25f24957cc7e7cd7c02c652e22` at that stage. The subsequent normal-identity desktop build is recorded below. Its `--appimage-version` runtime command works. Normal launch failed inside the test namespace, whose apparent helper ownership does not satisfy the runtime’s root-owned-helper check; both FUSE packages and helpers are installed, so this is not evidence of a missing host dependency; `--appimage-extract-and-run` launched the packaged app in a separate seeded test profile and network namespace. One automatic synthetic DARK transfer passed destination/manifest readback before acknowledgement, with persisted transfer history. David confirmed that the packaged window renders normally. After closing it, a restarted AppImage re-acknowledged the same frame without another download or file rewrite; one manifest entry remained and persisted history reported `already-present`. No equipment commands were recorded. The restart test stopped its own app process after observing persisted history. The artifact retains the isolated test identifier and requires a seeded test profile for offline GUI validation. As the [official Tauri AppImage guidance](https://v2.tauri.app/distribute/appimage/) explains, building on a newer distribution does not establish compatibility with older Linux systems. David subsequently confirmed normal FUSE AppImage launch from his own desktop terminal without `--extract`; the helper rejection was limited to the agent execution namespace. Fractional-scale/native ultrawide and real-equipment checks remain outside the validated configurations.

Packaged desktop connections no longer depend on the Vite proxy. Configure NINA and Stellarium under Settings > Connections and the agent under Frame Transfer. The default deployment remains NINA/PHD2/ASTAP/agent on Starrunner, with Straylight Studio and Stellarium on the operator computer.

Linux builds should use the same app source and runtime config. Build from a Linux machine with the Tauri Linux prerequisites installed:

```bash
npm install
npm run check:app
npm run desktop:build
```

Do not hard-code Windows paths into app logic. NINA and the Starrunner agent remain Windows-side services; the client app should only need configurable URLs and a local writable storage root.

## Release Checklist

Before calling a local build usable:

- `npm install` has completed without package warnings that need action.
- `npm run check:app` passes.
- `npm run agent:build` passes when agent changes are included.
- `npm run agent:test-metadata` passes when agent changes are included.
- `npm run desktop:build` creates a release executable or installer.
- The app launches outside Vite dev mode.
- Diagnostics and Settings show the expected NINA URL, event WebSocket URL, TPPA WebSocket URL, and frame-agent URL.
- A writable image destination can be selected and survives app restart.
- Demo mode can be toggled without hardware.
- Hardware actions still require explicit confirmation where appropriate.

## Offline Standalone Check

`npm run test:standalone-network` builds and launches a Windows bundled debug executable against local HTTP/WebSocket fixtures. It starts no Vite server and uses a separate `com.straylightastro.networktest` settings identity. It verifies native HTTP, equipment and guiding reads, Stellarium import, binary bodies, timeouts, non-followed redirects, event reconnection without command replay, TPPA bidirectional channels, address validation/persistence, and layout at 1920x1080 and 3440x1440. It does not validate actual telescope behavior or Linux packaging.

An existing Playwright installation is needed. Set `PLAYWRIGHT_MODULE` to its module URL when outside the project. The harness uses Playwright's bundled WebSocket test server without adding an npm dependency. It attaches to its own WebView2 debugging port, closes its test process, and rebuilds the normal desktop executable on exit. Screenshots and the isolated test WebView data are under ignored `tmp/standalone-network`. The test profile contains only localhost fixture addresses; normal user settings are untouched.

## Not Yet Solved

- Public code signing.
- Auto-update.
- Installer branding beyond current Tauri defaults.
- Broader Linux distribution compatibility and fractional-scale validation.
- A one-click Windows startup installer for the Starrunner agent.

### Read-only destination fix and follow-up tests

The current local AppImage was rebuilt from `8d5a366` plus the destination write-probe and FITS preview fixes. The probe writes and flushes a temporary byte, closes the file, and removes it rather than equating directory existence with write access. All 41 Rust tests pass, including read-only destination/cleanup and native WebSocket channel/error-path checks. The rebuilt package passed verified fresh delivery, duplicate reuse after restart, and bounded collision/corrupt-download/unwritable-destination fixture runs. Negative cases sent no acknowledgements or equipment commands and published no new FITS payloads. Local evidence and throwaway profiles are under ignored `tmp/linux-{package,positive,collision,corrupt,unwritable,manual}`. David confirmed native read-only Review correctly reports a failed save without changing the decision. David reported the requested native layout checks looked good at the observed 100% scale; native fractional-scale and ultrawide configurations remain unverified.

The FITS preview follow-up preserves selected-file rendering during stretch, makes Auto render immediately, and shows file errors/cancellation beside the preview without retaining the previous image on failed opens. Both `npm run test:workflow-ui` and the focused `npm run test:preview-ui` passed with an existing Playwright module and an approved temporary headless Chromium download. As with the existing harness, set `PLAYWRIGHT_MODULE` for an external module and `PLAYWRIGHT_BROWSERS_PATH` when using a nondefault browser cache. No browser dependency was added to the project. David confirmed the native stretch and broken-file feedback fixes, and the read-only Review error with an unchanged decision.

### Live read-only Linux connectivity

With David’s approval and the telescope powered off, a fresh unpackaged Linux release profile reached Starrunner at `192.168.4.251`. David confirmed Run Diagnostics and the NINA Event WebSocket report OK. NINA `3.2.0.9001` and Advanced API `2.2.15.2` were read successfully; all equipment was disconnected. Agent health reported ready, pending=0/delivered=11; PHD2 telemetry was disconnected/Unknown. Hostname agent access was intermittent, so the isolated native profile uses IPv4. Automatic transfer remains disabled, no run state was imported, and no hardware or acknowledgement commands were issued. This is native read-only connectivity validation, not real-frame transfer or equipment-control acceptance.

### Camera-sized synthetic renderer check

The opt-in check `cargo test --locked --offline --manifest-path src-tauri/Cargo.toml camera_sized_fits_preserves_raw_analysis_across_stretch -- --ignored --nocapture` passed on Linux. It generates a 5496 x 3672, 40,368,960-byte FITS file, verifies full-resolution golden statistics and histogram counts, changes display stretch without changing raw analysis, and checks source hash/mtime preservation. Its debug-build warm-cache observations were 4.37 s initial render and 123 ms cached stretch. The check is ignored during normal tests to avoid imposing camera-sized allocations on every run. David confirmed normal AppImage launch without an extract fallback, responsive display/stretch of the camera-sized file, and matching displayed mean/median. He also confirmed 25-frame native Review pagination and sorting and saved two Keep/one Reject decisions; the sidecar and unchanged fixture bytes were independently verified. The requested native layout checks were reported good; a read-only KDE query showed a 1920x1080 output at 100% scale. Native 125%/150% and ultrawide checks remain unverified. Dolphin FITS dropping is deferred by user preference; acquisition is the priority. Native picker cancellation and arrow-key details were not separately confirmed.

### Current acquisition-focused acceptance boundary

The current local candidate has passed the frontend build, 49 JavaScript core tests, 41 regular Rust tests, the opt-in camera-sized renderer test, and both browser UI suites. Native tests cover isolated automatic delivery, duplicate reuse after restart, collision/corrupt-download/read-only-destination failures without acknowledgement, read-only Review errors, selected-file stretch/error feedback, normal AppImage startup, and camera-sized preview responsiveness. Native release diagnostics/event connectivity to Starrunner passed with equipment off and automatic transfer disabled. Actual Linux capture/abort, real-frame agent delivery, and equipment-control/sky behavior have not been tested; the telescope stayed powered off. The earlier acceptance candidate used an ignored test-identity override and throwaway XDG profiles. The desktop installation below uses the normal app identifier with a fresh persistent profile. Source changes are maintained on `codex/linux-cachyos`; public distribution and equipment-control acceptance remain separate.

### Persistent desktop installation

At David’s request, a normal-identity AppImage was built without the local test override:

```bash
NO_STRIP=1 npm run desktop:build -- --bundles appimage
```

Normal identifier: `com.straylightastro.studio`; installed candidate SHA-256: `e19f5af4b3b9ed86bd99df65a7bbf8e8edb6dd83fe71d5ff970d10d56467810e`. The user-scoped installation uses:

- AppImage: `$HOME/.local/opt/straylight-studio/StraylightStudio.AppImage`.
- Launcher: `$HOME/.local/bin/straylight-studio`.
- Desktop shortcut: the XDG desktop folder’s `Straylight Studio.desktop`; a matching application-menu entry is installed.
- Persistent profile: `$HOME/.local/share/straylight-studio/profile/`, with separate config/data/cache/state directories exported by the launcher.
- Initial image destination: the XDG Pictures folder’s `Straylight Studio` subfolder.

The fresh profile contains the confirmed Starrunner IPv4 service addresses, no imported plans or active-run records, and automatic transfer disabled. It does not depend on the checkout, Vite, or ignored test profiles. No test identities, personal settings, generated binaries, or desktop shortcuts are tracked in Git. The desktop entries pass `desktop-file-validate`, and David confirmed that double-clicking the desktop shortcut opens Straylight Studio. The unsupported optional GIO trust marker did not prevent launch. TPPA and other powered-equipment tests remain deferred; installation performs no equipment commands.
