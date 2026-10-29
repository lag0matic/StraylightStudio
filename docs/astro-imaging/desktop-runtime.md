# Desktop Runtime

September 27, 2026: Acquisition and Settings now stay mounted for the life of the hydrated app, independently of the selected tab. This preserves capture/preparation state and keeps transfer polling active across navigation. An app-owned operation gate coordinates acquisition commands and cancellation; it is not durable across app exit or reload. Hardware-free regression checks are described in `current-integration-state.md`.

Straylight Studio should become a cross-platform desktop application, not a browser-only control panel. The current Vite/React app is the prototype shell and should continue to be useful while the runtime moves toward a packaged desktop app.

## Runtime Choice

Use Tauri as the preferred desktop runtime unless a concrete blocker appears.

Reasons:

- Supports Windows and Linux as first-class targets.
- Reuses the current Vite/React frontend.
- Provides native local filesystem access through explicit backend commands.
- Keeps the app lighter than an Electron bundle.
- Can launch local tools such as Siril when processing integration is ready.
- Gives us a controlled backend boundary for storage, settings, and external processes.

Electron remains a fallback if Tauri blocks a required workflow, but it should not be the default.

## Local FITS Analysis

The Review tab uses `review_open`, `review_preview`, and `review_decide` native commands. Scanning and rendering run on blocking workers, not the UI thread. Thumbnails use the same sampling/stretch pipeline but return `analysis: null`; full previews retain the normal analysis object. The ordinary acquisition preview still requests full analysis. Review decisions are stored independently from acquisition manifests in `.straylight-review.json`; the protocol and limitations are summarized in `current-integration-state.md`.

The preview result includes an `analysis` object from the full-resolution primary image. Analysis runs when the FITS cache is populated, not on each stretch adjustment. It uses scaled, pre-debayer samples, Welford population variance, exact median selection, and 256 histogram bins over the observed min/max. Nonfinite samples and integer BLANK values are excluded and counted. A constant image puts all samples in the first bin; an entirely undefined image has null statistics and zero histogram counts.

The UI identifies file measurements separately from NINA's latest capture result. Percentages at/below zero describe raw values, not display clipping or a known sensor black level. A SATURATE header supplies the upper threshold in scaled units; the integer file ceiling is a separately labeled fallback and is not proof of sensor saturation. Floating-point data without that header reports unknown saturation. Analysis currently supports 2D primary images with BITPIX 8, 16, 32, -32, or -64; cubes, extensions, and compressed FITS are not supported. Histogram/analysis never modify source files.

Native unit tests cover scaling, integer ceiling, explicit saturation, BLANK/nonfinite samples, constant/all-blank images, medians, variance, and truncation/overflow rejection. The standalone Windows harness also opens a synthetic FITS through the native renderer and checks full-resolution statistics, cached stretch invariance, histogram visibility, and clearing the preview.

## Standalone Networking

Implemented September 27, 2026. `connectionClient` resolves saved NINA/Stellarium origins, and `networkClient` selects native desktop transport or browser development transport. Native commands are `network_http`, `network_socket`, and `network_socket_send`. The installed app serves its bundled UI and requires no indoor web server. Vite remains a development tool only.

- Settings > Connections stores NINA (default `http://Starrunner.local:1888`) and Stellarium (default `http://127.0.0.1:8090`). Frame Transfer stores the agent origin separately.
- HTTP uses reqwest with explicit deadlines, no redirects, no retries, and a 256 MiB response cap. JSON and binary bodies use the same transport. System HTTP proxies are bypassed for these direct server connections.
- WebSockets use tokio-tungstenite and Tauri channels. Monitoring connections retry after three seconds; one-shot TPPA command connections never replay commands. Native TLS certificate validation remains enabled for HTTPS/WSS.
- Connection changes invalidate previous status reads and reconnect monitors. Changes are refused while an acquisition operation, setup command, or transfer is active. Desktop hydration completes before equipment polling starts.
- Frames and PHD2 telemetry use native HTTP too. No agent update is required for this change.

Windows packaged-debug verification is available via `npm run test:standalone-network`; see `desktop-packaging.md`. The transport is platform-neutral Rust/TypeScript, but a Linux build and real-rig validation remain outstanding. Authentication and internet-facing exposure are not implemented; use trusted local networking.

## Target Shape

```text
Main machine
  Straylight Studio
    React UI
    Tauri command layer
      NINA client
      local storage manager
      frame transfer manager
      processing launcher
      settings manager

Telescope miniPC
  Windows
  Starrunner.Agent
  NINA Advanced API
  PHD2
  ASTAP
  ASCOM and device drivers
```

The UI should stay portable. Browser APIs are fine for the prototype, but code that talks to hardware, writes files, launches processing tools, or stores durable settings should sit behind explicit adapters.

## Backend Responsibilities

The desktop backend should own anything the browser should not do directly:

- Read and write local storage paths.
- Maintain app settings outside `localStorage`.
- Download or copy frames from the miniPC.
- Verify frame size and checksum.
- Maintain a session manifest.
- Launch Siril and other processing tools.
- Resolve local paths across Windows and Linux.
- Enforce allowed write locations.
- Keep logs useful for debugging overnight sessions.

The frontend should request these operations through narrow commands rather than reaching directly into filesystem or process APIs.

## Frontend Adapter Boundary

Create frontend clients that hide the runtime implementation:

```text
src/clients/ninaClient.ts
src/clients/storageClient.ts
src/clients/processingClient.ts
src/clients/settingsClient.ts
```

Prototype mode can implement these with HTTP fetch, WebSocket, and browser `localStorage`.

Desktop mode can implement the same surface with Tauri commands and native filesystem access.

The React components should not care which runtime is active.

## Current Desktop Shell

Initial Tauri scaffolding exists in `src-tauri`.

- Product name: `Straylight Studio`.
- Application identifier: `com.straylightastro.studio`.
- Dev URL: `http://localhost:5174`.
- Frontend distribution: `../dist`.
- Initial window size: `1280 x 860`.
- Minimum window size: `980 x 680`.

Current Tauri commands include:

- `load_settings`
- `save_settings`
- `get_storage_status`
- `get_default_session_root`
- `set_session_root`
- `clear_session_root`
- `chooseSessionRoot` is handled through the frontend Tauri dialog plugin
- `preview_frame_path`
- `prepare_session_folder`
- `write_frame`
- `find_existing_frame`
- `render_fits_preview`
- `render_selected_fits_preview`
- `find_siril`

Settings are durable, desktop mode can choose and persist a local image destination folder, and frame-write commands can create session folders, write frame bytes, compute SHA-256, and update a session manifest. Desktop FITS preview rendering works for selected local FITS files and transferred FITS files. Siril launch behavior is still pending.

The frontend has a small Tauri adapter at `src/clients/tauriClient.ts`.

- `settingsClient` keeps browser `localStorage` fallback, and loads/saves through Tauri commands when running inside Tauri.
- `storageClient` keeps browser path-preview fallback, and can choose, persist, clear, and display a desktop session root when running inside Tauri.
- Diagnostics reports whether the app is running in Browser or Tauri desktop mode.

Desktop settings are stored as JSON in the app config directory. The frontend delays saving planner state until desktop settings have hydrated, so launching the desktop app does not overwrite the settings file with defaults before reading it.

The selected image destination is stored in the same settings file under `storage-session-root`. Desktop path previews combine that root with the planned session folder, such as `D:\Astro\jun142026_m31_light\1.fits`. Browser mode continues to show relative previews such as `jun142026_m31_light/1.fits`.

The storage backend also exposes:

- `prepare_session_folder`
- `write_frame`
- `find_existing_frame`
- `render_fits_preview`
- `render_selected_fits_preview`

`write_frame` accepts base64 data plus `expected_sha256` and `expected_size_bytes` from the agent. It verifies the input, writes and flushes a temporary file in the destination directory, reads it back, and publishes it using a no-replace hard link. An existing identical image is reused; a filename collision with different content fails without changing it. The published file is reread, and `manifest.json` is replaced through a flushed temporary file and rename before success is returned. `find_existing_frame` takes the expected size and SHA-256 and verifies the file under the selected root, never an arbitrary manifest path. Missing manifest entries are repaired through the writer on retry.

Temporary `.straylight-*.partial` files left by a crashed process are ignored, not mistaken for delivered images. Normal failures clean up their own temporary files. Image and manifest are two separate commits, so a crash between them is recovered by reusing the verified image on retry. Writes within one app process are serialized to protect manifest updates. Multiple app processes writing the same session are not coordinated. Hard-link-capable storage is required (NTFS/ext4 work); unsupported filesystems fail closed. File flush/readback does not guarantee survival of every hardware failure or power cut.

The miniPC-side transfer agent lives at `agents/Starrunner.Agent`. It watches NINA output, exposes pending frames over HTTP, and keeps the main app free of Windows share assumptions. Protocol details live in `frame-transfer-protocol.md`.

Desktop build and local release steps live in `desktop-packaging.md`.

## Initial Adapter Contracts

`ninaClient`

- Equipment/status reads through `getJson`.
- Event and TPPA WebSocket connections.
- Cooling and warming commands.
- Autofocus start/cancel.
- Mount tracking, unpark, slew/center, and stop-slew commands.
- Preview capture and saved FITS capture.
- Capture abort and capture statistics reads.

`storageClient`

- `getStorageStatus()`
- `getDefaultSessionRoot()`
- `setSessionRoot(path)`
- `clearSessionRoot()`
- `previewFramePath(session, frame)`
- `prepareSessionFolder(session)`
- `writeFrame(frameData, destination)`
- `findExistingFrame(session, fileName, sha256)`
- `renderFitsPreview(path, stretch, autoStretch)`

`processingClient`

- `findSiril()`
- `buildSessionScript(session)`
- `runSirilScript(scriptPath)`
- `getProcessingStatus(jobId)`

`settingsClient`

- `loadSettings()`
- `saveSettings(settings)`
- `resetSettings()`

## Migration Steps

1. Rename the prototype to Straylight Studio.
2. Move direct NINA HTTP and WebSocket calls behind `ninaClient`. Initial browser-backed adapter exists at `src/clients/ninaClient.ts`.
3. Move planner persistence behind `settingsClient`. Initial browser-backed adapter exists at `src/clients/settingsClient.ts`.
4. Add a browser-backed `storageClient` that only previews paths. Initial browser-backed adapter exists at `src/clients/storageClient.ts`.
5. Add Tauri scaffolding without changing the React UI. Initial scaffold exists in `src-tauri`.
6. Replace browser-backed storage/settings clients with Tauri commands. Settings are now file-backed in Tauri, storage root selection is persisted, and frame-write/manifest commands exist.
7. Add frame transfer and local write support through the Tauri backend. In place.
8. Add Siril discovery and processing launch support.

## Cross-Platform Rules

- Treat Windows and Linux paths as runtime data, not string constants.
- Keep hostnames, ports, storage roots, and tool paths configurable.
- Avoid shell-specific scripts in app logic.
- Do not assume SMB shares are available.
- Do not assume drive letters exist.
- Use native path APIs in the backend.
- Keep network failures non-fatal to an active miniPC capture session.

## Prototype Rule

The browser prototype can keep moving quickly, but every new hardware, storage, processing, or settings feature should be shaped so it can move behind a Tauri adapter later.
