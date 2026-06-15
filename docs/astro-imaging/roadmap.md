# Roadmap

This roadmap is staged so the distributed workflow can be proven before replacing proven astrophotography tools.

## Phase 0: MiniPC Rebuild

- Reinstall Windows on the miniPC.
- Install ASCOM Platform, PMC-Eight driver, ZWO driver, Gemini focuser driver, and Astromania guide camera driver.
- Install NINA, PHD2, and a plate solver.
- Confirm each hardware device works locally.
- Confirm NINA can run a short local capture.
- Confirm PHD2 can guide.
- Confirm NINA writes frames to a local folder.

## Phase 1: Target Import Spine

- Enable Stellarium Remote Control on the main machine.
- Build a small main-machine target import proof-of-concept.
- Import selected object name and coordinates from Stellarium.
- Display imported target in the app.
- Send imported target JSON to a miniPC mock endpoint.
- Log and acknowledge received targets on the miniPC.
- Keep this app OS-agnostic from the start, with Windows and Linux as first-class clients.

No mount movement in this phase.

## Phase 2: NINA API Probe

- Install and enable NINA Advanced API / ninaAPI on the miniPC.
- Confirm API access from the main machine using the miniPC hostname, for example `Starrunner.local`.
- Verify HTTP command access.
- Verify WebSocket event subscription.
- Capture the available endpoints and events in a local compatibility note.
- Test read-only status calls before any movement commands.
- Test safe commands with simulators before moving real hardware.

## Phase 3: Frame Transfer Spine

- Define the Straylight Studio desktop runtime boundary.
- Move direct NINA calls behind a frontend `ninaClient` adapter.
- Move settings and planner persistence behind a `settingsClient` adapter.
- Add a browser-backed `storageClient` for path preview only. Initial adapter is in place.
- Scaffold Tauri after the adapter boundary is stable. Initial scaffold is in place.
- Wire settings and storage adapters to Tauri commands when running in desktop mode. Initial command bridge is in place.
- Add durable Tauri settings storage. Initial file-backed settings are in place.
- Add real storage folder selection. Initial desktop folder picker and persisted session root are in place.
- Add explicit frame-write commands for selected storage roots. Initial write and manifest commands are in place.
- Connect miniPC frame transfer to the desktop frame-write commands. Initial one-frame transfer path is in place in the Logs tab.
- Add scope-agent folder watcher on the miniPC. Initial `Starrunner.Agent` scaffold is in place.
- Detect completed FITS files from the NINA output folder. Initial stable-file detection is in place.
- Compute checksum. Initial SHA-256 support is in place.
- Transfer frame to the main machine.
- Verify checksum.
- Acknowledge receipt.
- Keep local delivery state.
- Show latest delivered frame and counts in the main app.

## Phase 4: Operational Wrapper

- Add miniPC health endpoint.
- Add event stream for capture and transfer status.
- Add NINA/PHD2 process status if practical.
- Add manual safety commands.
- Add session manifest on the main machine.
- Add morning report skeleton.

## Phase 5: Assisted Imaging Actions

- Add `Slew And Center` command.
- Use NINA or local tools for slew, plate solve, sync, and recenter.
- Add autofocus trigger.
- Add guiding start/stop.
- Add saved capture start from the active queued plan. Initial camera-only saved capture loop is in place.
- Add sequence start from imported target.

## Phase 6: Unattended Mode

- Add target queue.
- Add start/end constraints.
- Add safety limits for low altitude, meridian behavior, guide failure, repeated plate solve failure, camera temperature failure, and disk pressure.
- Add network-loss behavior.
- Add end-of-night actions: stop capture, warm camera, stop guiding, park mount.

## Phase 7: Processing Pipeline

- Generate Siril scripts from session manifests.
- Run calibration, registration, and stacking on the main machine.
- Produce preview images.
- Collect quality metrics.
- Add rejected-frame reporting.

## Phase 8: Replace Pieces Selectively

Only replace NINA/PHD2 behavior where there is a clear reason:

- Better distributed control.
- Better failure recovery.
- Cleaner UI.
- More reliable automation.
- Better integration with storage and processing.

The default posture is to wrap first and replace only after the workflow proves where replacement is worth it.
