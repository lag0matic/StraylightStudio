# Current Integration State

Last updated: 2026-10-28.

This file is the short handoff note for where Straylight Studio actually stands right now.

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
- Start Run is still a camera saved-capture loop. It does not yet automatically call Prepare Target, autofocus, start guiding, dither, handle meridian flips, or run a full NINA advanced sequence.
- Guiding is monitored, but Straylight Studio does not yet start or stop guiding.
- Autofocus can be started/canceled, but it is not integrated into the saved capture run.
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

1. Validate the protected writer with the real desktop/agent transfer path; offline filesystem and mocked acknowledgement checks are in place.
2. Validate the standalone native connections against the live rig; Linux packaging remains unverified. The Windows bundled-app transport checks are now in place.
3. Validate stop/readback handling against real NINA when the rig is available.
4. Add guiding start/stop and integrate autofocus before run.
5. Add sequence orchestration around prepare, autofocus, guiding, capture, transfer, and abort behavior.
6. Extend local FITS analysis with star-based quality metrics, then connect reviewed selections to Siril processing.
