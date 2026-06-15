# Desktop Runtime

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

Current Tauri commands are placeholders only:

- `load_settings`
- `save_settings`
- `get_storage_status`
- `get_default_session_root`
- `set_session_root`
- `preview_frame_path`
- `find_siril`

They prove the desktop command layer compiles. Settings are durable, desktop mode can choose and persist a local image destination folder, and frame-write commands can create session folders, write frame bytes, compute SHA-256, and update a session manifest. Frame transfer from the miniPC and Siril launch behavior are still pending.

The frontend has a small Tauri adapter at `src/clients/tauriClient.ts`.

- `settingsClient` keeps browser `localStorage` fallback, and loads/saves through Tauri commands when running inside Tauri.
- `storageClient` keeps browser path-preview fallback, and can choose, persist, clear, and display a desktop session root when running inside Tauri.
- The Logs tab reports whether the app is running in Browser or Tauri desktop mode.

Desktop settings are stored as JSON in the app config directory. The frontend delays saving planner state until desktop settings have hydrated, so launching the desktop app does not overwrite the settings file with defaults before reading it.

The selected image destination is stored in the same settings file under `storage-session-root`. Desktop path previews combine that root with the planned session folder, such as `D:\Astro\jun142026_m31_light\1.fits`. Browser mode continues to show relative previews such as `jun142026_m31_light/1.fits`.

The storage backend also exposes:

- `prepare_session_folder`
- `write_frame`

`write_frame` accepts base64 frame data, writes it under the configured session root, computes SHA-256, and appends or replaces the frame entry in `manifest.json`.

The miniPC-side transfer agent lives at `agents/Starrunner.Agent`. It watches NINA output, exposes pending frames over HTTP, and keeps the main app free of Windows share assumptions. Protocol details live in `frame-transfer-protocol.md`.

## Initial Adapter Contracts

`ninaClient`

- `getStatus()`
- `connectEvents(onEvent)`
- `runDiagnostics()`
- `discoverCapabilities()`
- `coolCamera(settings)`
- `warmCamera(settings)`
- `capturePreview(settings)`
- `abortExposure()`

`storageClient`

- `getStorageStatus()`
- `getDefaultSessionRoot()`
- `setSessionRoot(path)`
- `previewFramePath(session, frame)`
- `registerFrame(frameMetadata)`
- `writeFrame(frameData, destination)`

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
7. Add frame transfer and local write support through the Tauri backend.
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
