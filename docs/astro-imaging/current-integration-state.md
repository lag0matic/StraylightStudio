# Current Integration State

Last updated: 2026-11-16.

This file is the short handoff note for where Straylight Studio actually stands right now.

## November 16 Linux Offline Validation

- Started from `8d5a366` on the local `codex/linux-cachyos` branch. CachyOS kernel `7.3.3-1-cachyos`, KDE Plasma/KWin 6.8.2, Wayland; Node 24.22.3, npm 12.2.2, Rust/Cargo 1.94.1, GTK 3.24.52, WebKitGTK 2.54.2, libsoup 3.8.1.
- `npm ci` completed with the existing lockfile. The production frontend build, 49 JavaScript operation/sequence tests, and 37 Rust tests passed on Linux. The Rust checks include native HTTP, FITS decoding/statistics, storage publication/readback/collision handling, and review-sidecar persistence. These are automated checks, not complete native UI acceptance.
- An unpackaged debug executable built with an ignored Tauri override and separate settings identity. It launched without Vite using throwaway XDG directories, localhost-only service settings, and a Bubblewrap network namespace. David confirmed that the native window renders normally. No X11 backend or graphics workaround was requested; the session is Wayland, but the window's actual display protocol has not been independently inspected.
- The initial test launcher incorrectly mapped device files, causing a JavaScriptCore random-source startup crash. Adding a device bind for `/dev` corrected the launcher; no application source change was needed. Local logs, settings, and synthetic FITS fixtures remain under ignored `tmp/linux-offline/`.
- David confirmed native Review folder selection, previews of synthetic BIAS/DARK/FLAT/LIGHT files (`.fits`, `.fit`, `.fts`), the broken-file error case, and a saved decision in a folder with spaces and non-ASCII characters. The LIGHT Keep entry was independently verified in `.straylight-review.json`; SHA-256 checks confirmed all four source FITS files remained unchanged. These tiny synthetic files do not establish real-session performance or star-analysis accuracy.
- The optimized unpackaged release build succeeded. After closing the debug app and launching the release executable in the same isolated offline profile, David confirmed that reopening the last review folder restored the synthetic session and LIGHT Keep decision.
- AppImage creation succeeded with command-local `NO_STRIP=1`, after linuxdeploy's bundled `strip` rejected modern `.relr.dyn` library sections. The approximately 108 MiB test-profile artifact and reproducible command are recorded in [Desktop Packaging](desktop-packaging.md#linux-build-notes). Its runtime version command works, and David confirmed the extract-and-run AppImage window renders normally.
- A separate AppImage profile and localhost fixture agent exercised automatic native delivery while Settings was active. One synthetic 11,520-byte DARK frame was downloaded, saved with matching SHA-256 and a one-entry manifest, and acknowledged. The fixture independently read the destination and manifest before accepting acknowledgement; transfer history persisted with `transferred` status. No equipment commands were recorded. Normal AppImage mounting failed inside the isolated launcher; the actual packaged app ran using `--appimage-extract-and-run`, with its fixture agent inside the same network-isolated namespace. FUSE 2.9.9 and 3.18.3 and both helpers are installed. Inside the test namespace the setuid helpers appear owned by `nobody`, while the AppImage runtime requires root ownership, so this does not establish that normal host launch is broken. No system package install was needed. After David confirmed normal rendering and closed the window, a restarted AppImage was offered the same frame: total downloads stayed at one, acknowledgements increased to two, file modification time stayed unchanged, the manifest retained one entry, and persisted history became `already-present`. The second test process was terminated only after that persisted result was observed. No equipment commands were recorded across either run.
- Remaining offline checks found that destination readiness treated any existing directory as writable. The native check now creates, writes, flushes, and removes a temporary probe file. Read-only destinations are rejected before download. Two filesystem regression tests and two localhost WebSocket/Tauri-channel tests were added; all 41 Rust tests pass. The unchanged JavaScript suite previously passed 49 tests (90 tests across the current suites). Windows execution of the change has not been rechecked.
- The rebuilt AppImage passed fresh delivery and duplicate-after-restart checks. Separate 20-second negative runs exercised mismatching contents at an existing filename, corrupt downloaded bytes, and a read-only destination. Collision files and manifest bytes/mtimes remained unchanged; corrupt payloads were not published (an empty session directory may be created); the read-only case made zero downloads. None issued an acknowledgement or equipment command. These are bounded fixture observations, not physical power-loss tests.
- Native feedback exposed two preview problems: manually opened files lost their selected-file renderer when stretch changed, and failed opens retained the old image while errors appeared away from the preview. Selected-file provenance now survives re-rendering, Auto explicitly requests a fresh render, new file opens clear the old image, and errors/cancel feedback appear beside the preview controls. A focused `npm run test:preview-ui` browser test passed, including changed display pixels with unchanged raw histogram summaries. The existing workflow UI suite also passed (mocked services; browser layouts at 1280, 1920, and 3440 widths). David approved a temporary headless Chromium download into `/tmp`; no project dependency or system package was installed. These browser results do not replace native GTK checks.
- The reported read-only Review attempt used the writable fixture folder according to persisted settings; no sidecar was created in the actual read-only copy. The reopened native test profile now points Review’s Reopen Folder at the intended read-only copy. David confirmed the native read-only Review error is visible and the decision stays Undecided. He also confirmed that native stretch changes now alter the image and broken FITS opens clear the image with a visible error.
- Valid `.fits`/`.fit`/`.fts` picker opens and zoom were reported working; picker cancellation is browser-tested but lacks explicit native confirmation. David later confirmed normal AppImage launch from his desktop terminal, responsive camera-sized FITS display/stretch with the expected raw statistics, and 25-frame Review sorting/pagination. He reported the requested native tab/layout/keyboard/collapse checks looked good; the current KDE output was read as 1920x1080 at 100% scale. Native 125%/150% and ultrawide configurations were not tested. Dolphin FITS dropping is explicitly deferred at David’s request because acquisition is his main workflow; Open FITS remains the validated file-loading path. No real archives or telescope services were used during those offline checks. Starrunner remained offline until the separately approved read-only session below; sky-dependent and real-equipment limitations remain unchanged.
- An opt-in camera-sized renderer regression generated a valid 40,368,960-byte, 5496 x 3672 Bayer FITS file with 20,181,312 samples. Native rendering verified median=3000, mean approximately 3016.244541, min/max=1000/5080, histogram count, unchanged raw analysis across stretch, changed display pixels, and unchanged source hash/mtime. Debug-build timings with warm filesystem cache were approximately 4.37 s for the initial render and 123 ms for cached re-stretch; these are synthetic diagnostic observations, not release or real-archive benchmarks. The heavy test is ignored in the default suite and passed when explicitly selected.
- A separate localhost-only final-check profile, a corrected camera-sized FITS fixture, and a 25-frame Review folder were prepared under ignored `tmp/linux-finalchecks/`. David confirmed normal launch without extract fallback, native bulk Review sorting/pagination with two Keep and one Reject decisions (independently verified on disk), and responsive large-file preview with matching mean/median. All 26 source files still matched their generated golden bytes. Native layout was reported good at the observed 100% scale; precise native picker-cancel and arrow-key details were not separately confirmed. Dolphin dropping is deferred by user preference. An initial padding error in these new generated fixtures was corrected before recording results; the earlier small fixtures were unaffected.
- npm reported four high-severity dependency entries (Vite, PostCSS, nanoid, source-map-js). A read-only audit was captured locally; no automatic fixes or dependency upgrades were applied. Both lockfiles remain unchanged.

## November 16 Desktop Install and Linux Branch Handoff

- Final `npm run check:app` passed: frontend build, 49 JavaScript tests, and 41 Rust tests; the heavy camera-sized check is intentionally ignored by the default suite and passed separately. Both lockfiles remain unchanged. The two browser UI suites passed earlier against the same frontend fixes.
- A normal-identity AppImage was built without the test override and installed under the user’s `.local/opt/straylight-studio/`, with a desktop shortcut and application-menu entry. The launcher uses a fresh persistent profile under `.local/share/straylight-studio/profile/`, a Pictures/Straylight Studio destination, confirmed Starrunner IPv4 endpoints, no imported run state, and automatic transfer disabled. It is independent of the checkout and test folders. See [Desktop Packaging](desktop-packaging.md#persistent-desktop-installation) for paths and the artifact checksum.
- Desktop files pass validation, and David confirmed the new desktop shortcut launches Straylight Studio. No equipment commands were issued during installation; TPPA, actual capture/abort, and other powered-equipment tests remain deferred. Source changes are prepared on `codex/linux-cachyos` at David’s explicit request to commit and push that branch.

## November 16 Linux Read-only Starrunner Validation

- David brought Starrunner online with the telescope powered off and explicitly approved read-only checks. NINA/API initially timed out; after David started its API service on port 1888, IPv4 checks passed.
- NINA reports `3.2.0.9001`; Advanced API reports `2.2.15.2`. Camera, mount, focuser, and guider report disconnected. The NINA event WebSocket handshake succeeded.
- Starrunner.Agent at `192.168.4.251:4787` reports ready, pending=0, delivered=11. PHD2 telemetry is disconnected/Unknown with no samples or reported version; this does not establish that PHD2 is running or validate guiding.
- `Starrunner.local` resolved to `192.168.4.251`. A later hostname probe reached NINA HTTP/events but agent requests timed out, while IPv4 agent checks succeeded. Treat hostname reachability as intermittent; the fresh native test profile uses the confirmed IPv4 address. No OS resolver changes or normal-profile endpoint changes were made.
- An unpackaged Linux release executable launched directly against Starrunner from a fresh local test profile without Vite, targets, queued plans, or restored run records. Automatic transfer is disabled. A socket listing showed the native process connected to port 1888, and David confirmed that Run Diagnostics reports OK for the NINA API/equipment reads and Event WebSocket. The throwaway image destination contains no files.
- No capture, sequence start/stop, mount, cooling, focuser, guiding, TPPA-start, or frame acknowledgement commands were sent. No real FITS frames were downloaded. This validates read-only native connectivity, not equipment control, real transfer, or sky behavior. Logs and the isolated live profile remain under ignored `tmp/linux-offline/` and `tmp/linux-live-readonly/`.

## November 14 UI Cleanup

- Kept the six workflow tabs and existing equipment behavior. Setup now puts compact equipment controls beside alignment/focus; device inventories and secondary results are expandable. Target selection/framing and exposure/queue planning use independent columns, without stretched grid rows or a disabled Run Now placeholder.
- Settings now has Connections & Storage, Run Policies, and Preview sections. Readiness links select the appropriate settings section, and the single auto-transfer control remains in Settings. Hidden views remain mounted so polling/transfers continue.
- Panels are collapsible with remembered preferences and hide rather than unmount their contents. Acquisition retains image/stretch/guiding plus a compact run bar; duplicate stage indicators moved into Run Details, and zero-count transfer boxes no longer crowd the bar. Ultrawide content can use 2560px without scaling fonts.
- Survey image failures now show an unavailable state instead of a broken image or an unreferenced frame overlay. Disconnected mount states no longer imply known parked/slewing values.
- Verified all six screens and Settings sections at 1920x1080, 3440x1440, and 1280x900 in an isolated demo browser. Workflow tests cover collapse persistence and existing capture/cancel/transfer safeguards. The separate Windows desktop mock profile passed native networking, FITS preview/stretch/statistics, and populated session-review checks. All 87 core tests passed. No real telescope commands were sent; sky-validation requirements below are unchanged. Docking remains deferred.

## October 31 Live Indoor Validation

Full sequence mode is now implemented through NINA's Advanced Sequencer, with durable run identity, load/readback/start ordering, stop verification, and monitoring after app restart. A native three-frame DARK sequence completed with the indoor app closed, then all three queued frames transferred and verified when the app reopened. A separate native sequence stop completed in about 1.9 seconds without starting its second exposure. The full light plan was loaded/read back but not executed indoors. See [Sequence Execution](sequence-execution.md) for protocol details, tests, and the remaining overnight limitations.

### Initial Camera Checks

- Tested the bundled Windows desktop app against Starrunner with the ASI183MC Pro connected and the mount disconnected. NINA reports 3.2.0.9001, Advanced API 2.2.15.2, and PHD2 2.6.14.
- Saved-hostname connections work through native desktop HTTP, with the NINA event stream open. PHD2 reports connected/Stopped with no guide samples. Separate PowerShell hostname probes timed out intermittently; the known IPv4 address worked, and no saved endpoint change was needed in the app.
- A temporary one-frame, one-second DARK plan completed through Start Run. The 40,368,960-byte FITS transferred automatically to F:\Astro, its on-disk SHA-256 matched the delivery record, and the app automatically rendered its 5496 x 3672 samples, statistics, and histogram. Agent delivered count changed from 5 to 6, with zero pending.
- A second temporary plan requested two 30-second DARK frames. Abort Run was clicked while the first frame was exposing. The abort took about 28.9 seconds to settle; NINA saved and delivered the first frame, but the second exposure never started. The app waited for command settlement and an idle camera read before releasing the operation gate. This path behaves as stop-after-current-frame in the observed run, not an immediate exposure termination.
- After a normal Windows close and a fresh app process launch, delivered count remained 7, pending remained zero, both test delivery records persisted, and both destination files retained their sizes and modification times. No duplicate transfer or image rewrite was observed.
- Original observing plan restored; test files retained under the clearly named SLS_INDOOR_20261031_SHORT and SLS_INDOOR_20261031_ABORT session folders. Camera was idle with cooler off before and after. No mount commands, autofocus, TPPA, or guiding-start commands were sent.
- Mount preparation/stop behavior and real-sky autofocus, guiding, centering, and TPPA remain unverified by this session. Linux execution remains unverified.

### Supervised Cleanup Checks

- With the capped scope indoors and explicitly cleared for movement, Setup Stop Tracking confirmed tracking off/not slewing. Isolated native End-only sequences then executed Stop Guiding plus Set Tracking (native stopped mode 5) and Stop Guiding plus Park Scope. They contained no target preparation, capture, autofocus, solve, or guiding-start instructions. Native tracking-off settled in about 2.1 seconds; parking took about 14 seconds and confirmed AtPark=true, TrackingEnabled=false, Slewing=false. Instruction completion preceded the tracking telemetry update, so the test waited for actual device state.
- The recovery API parking endpoint was separately checked after a controlled unpark, then confirmed parked/tracking off/not slewing in about 4.2 seconds. This validates the endpoint, not an end-to-end failure-triggered parking workflow. PHD2 was connected/Stopped throughout; stopping an actively guiding session remains untested without sky.
- A one-second DARK sequence applied native completion warming after mild cooling to 19.5 C. The cooler turned fully off, the app verified cleanup and cleared ownership, and the 40,368,960-byte dark transferred to F:\Astro with matching SHA-256. NINA shortened this warm-up because the sensor was already within its target tolerance; the completion test took about 24.8 seconds.
- A separate two-frame, twenty-second DARK sequence was stopped during its first exposure after cooling to 18.5 C. The app-owned cancellation warming path ran its timed ramp, then confirmed CoolerOn=false and idle camera before releasing ownership. The whole stop/cleanup test took about 87 seconds; no second exposure or aborted-test file was observed. The mount stayed parked and tracking off.
- Original observing plan and cleanup settings restored; defaults still leave mount/cooling unchanged. Final state: mount parked, tracking off, not slewing; camera idle/cooler off; PHD2 connected/Stopped; agent pending=0, delivered=11. No plate solve, autofocus, guiding-start, or TPPA was attempted. Automatic failure cleanup orchestration, active-guide stopping, full light execution, and Linux still need appropriate validation.
- Local diagnostic reports are under ignored `tmp/live-camera/supervised-*.json`; the test dark is retained in `F:\Astro\oct312026_sls_indoor_20261031_end_warm_dark`.

## Native Meridian-Flip Integration

- Opt-in Settings control adds NINA's native flip trigger to full light captures alongside dithering. Fresh active-profile and equipment checks run before start; source timing/recenter/refocus choices are read-only. Flips require planned guiding, re-centering, and a failure stop-tracking/park policy. Calibration and Camera only do not flip. Defaults remain disabled.
- Acquisition shows native trigger state and hours-derived timing. Missing/disabled/failed protection uses failure cleanup while connected; running flips retain ownership. NINA owns execution and recovery on Starrunner, without a client-side timer or flip command replay.
- The installed NINA/API loaded and returned the correct flip and dither triggers without execution. The scope remained parked, tracking off, camera idle/cooler off. Original app observing settings were not changed; NINA was left with an empty unstarted diagnostic template. The real API response is a regression fixture.
- Physical flips/re-centering/guide restart remain untested. NINA 3.2 best-effort re-centering and the native trigger's discarded boolean result mean FINISHED is not proof of success; the API after-flip event has no success flag. These limits are explicit in [Sequence Execution](sequence-execution.md#meridian-flips). Supervise the first actual flip before considering unattended imaging.

## October Session Review

- Fixed Windows UNC share-root scans that produced `/BIASES/...` frame keys and then failed relative-path validation. Relative keys are now rebuilt from path components after checking the selected folder prefix. Ordinary nested, drive-letter, and UNC paths retain the same folder containment checks.
- Read-only native desktop verification on the affected network share found 100 frames and rendered a thumbnail plus full preview/statistics for a 5496 x 3672 frame. No test decisions were written to that share.
- A separate Review tab opens a local session folder, including nested FITS/FIT/FTS files. It provides paged thumbnails, previous/next navigation (including arrow keys), decision filters, and filename/exposure/temperature/gain sorting.
- Headers provide exposure, temperature, gain, type, target, filter, and capture time. Selecting a frame loads full-resolution statistics and a histogram through the existing native FITS renderer. Statistics remain available beside previously visited frames for comparison during that review session.
- Thumbnails sample the image without full-resolution analysis, and only the current page is queued. Full preview requests are debounced during rapid navigation. Review does not use NINA or the agent.
- Keep/reject/undecided decisions are saved in `.straylight-review.json` in the selected folder, using relative paths and file size/mtime fingerprints. Originals are never moved, deleted, or modified. Changed fingerprints reset old decisions and block stale writes. This is not a content-hash identity check.
- Sidecar writes are staged, flushed, verified, and renamed; malformed/unsupported sidecars are preserved and make decisions read-only. Normal write failures are surfaced without marking the action saved. The selected folder must be writable to save decisions. Multiple app processes editing the same sidecar are not coordinated.
- The last folder can be reopened after restarting; it is not automatically scanned on launch. Scans stop at 20,000 entries and report that limit. Symlinks are skipped, and canonical directory traversal stays within the selected root. Read errors and broken FITS headers are surfaced without removing frames from review.
- Windows mock/native tests cover review, decisions across reload, filters, pagination, corrupt-file isolation, and unchanged source bytes. Linux execution and real-session performance still need validation.

## September Offline Work

- Desktop HTTP and WebSockets now run through native Tauri commands, not the Vite proxy. Settings > Connections stores NINA and Stellarium server addresses. Existing installs inherit Starrunner:1888 and local Stellarium:8090 defaults; the agent address stays in Frame Transfer.
- NINA event and TPPA monitoring reconnect after disconnects. One-shot commands are not replayed. Address changes are blocked during active acquisition commands or frame transfers; stale status replies from a previous address are ignored.
- The bundled Windows debug app was checked against local mock servers without Vite: equipment/guiding reads, Stellarium import, binary HTTP, timeout/redirect behavior, event reconnect, and bidirectional TPPA transport. This verifies transport, not real-sky TPPA or guiding behavior. Linux and live-rig networking still need validation.
- Acquisition and Settings remain mounted after desktop settings load; changing tabs hides them without disposing of their running work. Automatic transfer no longer requires Settings to be open.
- One app-owned operation gate coordinates target preparation, saved capture, and preview exposure. Setup autofocus/TPPA starts and tracking changes are guarded while an acquisition operation owns the equipment.
- Cancellation belongs to a specific operation. Stopping during unpark prevents the subsequent tracking and slew commands.
- Stop/abort holds the gate until the original command settles, the stop request succeeds, and an equipment read reports connected and not slewing/exposing. Failed stops and uncertain command failures remain locked with a retry action.
- Saved capture and preparation demo actions stay simulated. Preview capture and frame transfer do not operate real equipment in demo mode.
- Transfer destination changes and demo switching are blocked while a transfer is active.
- Image writes now require the agent's expected size and SHA-256, stage and flush bytes to a temporary file, read back and verify them, publish without replacing another file, and verify the destination before returning success. Manifests are staged and atomically replaced. Different contents at an existing filename are refused and remain pending on the agent.
- A published image with a missing manifest entry is reverified and the entry repaired on retry. Duplicate checks resolve the filename under the selected root rather than trusting manifest absolute paths.
- Safe image publication currently requires hard-link support in the destination filesystem (for example NTFS or ext4). Unsupported destinations fail with an error; exFAT/FAT need a future alternative. Tests use real temporary files on Windows and injected commit failures, not physical power cuts or Linux execution.
- This is in-process persistence across tabs only. Closing/reloading the app still loses operation state. It is not unattended recovery or a telescope-side safety supervisor.
- Tested offline with mocked NINA, agent, and desktop storage responses. No September hardware commands were sent. Mount centering and stop behavior still need a real NINA check, followed by real-sky testing.

Regression commands: `npm run test:operations` (Node 22.18+ or 24+) and `npm run test:workflow-ui` (an installed Playwright module/browser required). The UI harness starts and stops its own local Vite server, mocks all equipment connections, and writes no real FITS files. Set `PLAYWRIGHT_MODULE` to a Playwright module path/URL when it is outside the project; set `BROWSER_CHANNEL=msedge` to use installed Edge. No new npm dependency was added.

## Hardware And Network

- Telescope-side computer: `Starrunner`, Windows miniPC.
- Preferred hostname: `Starrunner.local`.
- Known-good frame-agent fallback: `http://192.168.4.251:4787`.
- NINA Advanced API / ninaAPI port: `1888`.
- Starrunner.Agent port: `4787`.
- NINA API base URL used by the dev proxy: `http://Starrunner.local:1888/v2/api`.
- NINA event WebSocket: `ws://Starrunner.local:1888/v2/socket`.
- NINA TPPA WebSocket: `ws://Starrunner.local:1888/v2/tppa`.

`Starrunner.local:4787` has worked from the app, but PowerShell tests have also shown mDNS/IPv6 timeouts. If the agent appears unreachable, use the editable Frame Transfer URL and set it to `http://192.168.4.251:4787`.

## June Hardware Baseline

Versions and equipment states below were verified in June, not rechecked in September.

### Verified Versions

- NINA: `3.2.0.9001`.
- NINA Advanced API: `2.2.15.1`.

## Verified Equipment

The live rig has been seen through the API with:

- Camera connected: ZWO ASI183MC Pro.
- Mount connected: DeviceHub -> Explore Scientific PMC-Eight ASCOM driver.
- Focuser connected: Gemini focuser.
- Guider connected: PHD2.

The most recent checked mount state after UI testing was:

- Connected: yes.
- Tracking enabled: no.
- Tracking mode: `Stopped`.
- Slewing: no.
- Parked: no.

Tracking was intentionally turned off from Straylight Studio as a UI test. Use `Sidereal Tracking` or `Prepare Target` before real light capture.

## What Works Now

- Desktop app runs through Tauri and browser dev shell.
- NINA status polling works.
- NINA diagnostics and capability checks work.
- Equipment status lights work, including mount tracking.
- Stellarium selected-object import works.
- Target framing preview works through CDS HiPS2FITS.
- Tonight queue and active queued target workflow work.
- Camera cooling and warming commands work as toggles.
- Test preview exposure works.
- Saved FITS capture loop works for the active queued plan.
- Abort requests NINA to abort the exposure, stops further captures, and keeps the operation locked until stop acknowledgement, command settlement, and camera readback. September changes are mock-tested only.
- Autofocus start and cancel command paths work against NINA.
- TPPA start and stop command paths work against NINA.
- TPPA JSON parsing has been adjusted to match documented NINA TPPA socket shapes.
- PHD2 guide status/graph works through Starrunner.Agent when PHD2 event data is available.
- Starrunner.Agent watches the NINA output folder and exposes pending/failed frames.
- Manual and automatic frame transfer work.
- Downloaded, staged, and published image bytes are size/SHA-256 checked. The returned checksum is computed by reading the saved file. Failed writes, manifest commits, or verification do not permit acknowledgement.
- The app acknowledges a frame to Starrunner.Agent only after local verification.
- If a frame is already present locally with the same checksum, the app acknowledges it instead of writing a duplicate.
- Transfer history distinguishes `Transferred` from `Already present`.
- Latest transferred FITS can auto-load into the preview.
- FITS preview rendering works in Tauri, including color Bayer preview.
- FITS header inspection works for loaded FITS files.
- Local FITS loading works from outside the selected storage root.
- Acquisition run bar shows readiness, saved frames, transfer count, and current phase.
- Prepare Target exists and calls NINA to unpark if needed, enable sidereal tracking, and slew/center the active target.
- Prepare Target can be stopped with NINA `equipment/mount/slew/stop`.
- Prepare Target writes a compact trace in Run Details.

## Partial Or Not Yet Complete

- Prepare Target has not been tested outdoors under real plate-solving conditions.
- Prepare Target uses NINA `equipment/mount/slew` with `center=true`; exact behavior depends on NINA/ASTAP solving successfully.
- Start Run defaults to Full sequence, which delegates the active target's preparation, optional autofocus/guiding, exposure loop, and optional dithering to NINA. Camera only retains the earlier capture loop. Settings has distinct completion/cancellation/failure actions for guider stop, mount stop/park, and gradual warming. Normal completion uses NINA End instructions; failure/cancel recovery requires the connected app, persisted command intent, and verified device state. Defaults do not move the mount or change cooling. Native end-only mount actions and real completion/cancellation warming passed supervised indoor checks; failure-triggered orchestration and active-guide stopping are not hardware validated. Native meridian flips are opt-in and load/readback validated, not physically tested. See [Sequence Execution](sequence-execution.md).
- Guiding is monitored, and generated full light sequences delegate start/settling and normal stop to NINA. Separate manual guider start/stop controls are not yet exposed.
- Autofocus can be started/canceled independently and is included in generated full light sequences when requested. Camera-only diagnostic runs do not perform autofocus. Real-star accuracy remains unverified.
- TPPA command and parsing paths exist, but full live adjustment behavior still needs real-sky testing.
- FITS preview now caches full-resolution, unstretched sample statistics: exact median, mean, min/max, population standard deviation, a 256-bin histogram, and percentages at/below zero and at a known upper threshold. These are separate from NINA's latest API statistics. Histogram counts can be linear or logarithmic; display stretch does not change the measurements.
- Analysis applies BSCALE/BZERO, excludes integer BLANK and nonfinite samples, and uses raw samples before debayering. SATURATE is treated as a threshold in scaled FITS units when present; otherwise integer data reports the file ceiling, not assumed sensor saturation. Floating-point images without SATURATE report unknown saturation. Only two-dimensional primary images are supported; cubes are explicitly rejected.
- Local star count, HFR, eccentricity, and rejection flags remain unimplemented.
- Siril integration and stacking are not implemented.
- Packaged release workflow exists in docs, but this is still a development app.

## Safety Notes

- Commands that can move hardware or operate camera/focuser ask for confirmation.
- `Stop Tracking` stops sidereal tracking but does not park the mount.
- `Parked` means the driver reports the mount parked at its configured position; this does not establish physical clearance or safety. Many commands may be rejected until unparked.
- `Prepare Target` may unpark and move the mount. Only use it when the scope is physically safe to move.
- `Stop Prepare` requests NINA to stop mount slew. NINA notes that stopping a slew-and-center may take a few seconds.
- Light-frame readiness expects tracking to be on. Calibration frames do not require mount tracking.

## Useful Commands

From `D:\AstroImagingStack`:

```bash
npm run build
npm run desktop:test
npm run desktop:dev
npm run agent:publish
npm run agent:test-metadata
```

Probe NINA from the main machine:

```bash
npm run probe:nina
node tools/probe-nina-api.mjs Starrunner.local
```

Check the agent directly:

```text
http://Starrunner.local:4787/health
http://192.168.4.251:4787/health
```

## Recommended Next Work

1. Validate mount preparation and slew-stop/readback handling against real NINA when the mount is available. Camera capture, abort/readback, automatic delivery, and app restart were checked indoors on October 31.
2. Validate Linux builds and packaging. Windows standalone connections and the real camera/agent transfer path are now checked.
3. Validate autofocus, guiding, centering, and TPPA under real sky conditions.
4. Validate the generated light sequence's autofocus, guider settling/dithering, and stop behavior under real sky conditions.
5. Supervise a real meridian flip and validate failure-triggered cleanup/active-guide stopping; add multi-target queue execution. App-owned failure recovery is not a telescope-side safety supervisor.
6. Extend local FITS analysis with star-based quality metrics, then connect reviewed selections to Siril processing.
