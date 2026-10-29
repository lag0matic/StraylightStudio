# Client App

The first Straylight Studio client is a Vite/React prototype surface with a Tauri desktop runtime path. It runs on the main machine and talks to NINA Advanced API on `Starrunner.local`.

The long-term runtime target is a Tauri desktop app for Windows and Linux. The current browser version should keep moving quickly, but new NINA, storage, processing, and settings behavior should be shaped so it can move behind desktop adapters later.

## Current Capabilities

- Shows NINA version.
- Shows Advanced API version.
- Polls equipment state every 10 seconds.
- Runs manual read-only connection diagnostics from the Diagnostics tab.
- Discovers a read-only capability map for NINA API endpoints, command surfaces, installed plugins, livestack, image history, and WebSocket channels.
- Shows camera, mount, focuser, and guider connection state.
- Shows a PHD2 guiding graph in Acquisition when Starrunner.Agent can reach PHD2's event server.
- Provides guarded camera cooling toggles in Setup using `equipment/camera/cool` and `equipment/camera/warm`.
- Provides a guarded preview-only test exposure in Acquisition using `equipment/camera/capture` with streamed PNG output.
- Parses NINA WebSocket capture/image/sequence events into a Recent Frames feed in Acquisition.
- Groups preview, guiding, stretch, stats, recent events, and planned frame data behind local Acquisition Monitor tabs.
- Routes NINA HTTP, WebSocket, TPPA, cooling, autofocus, and preview capture calls through `src/clients/ninaClient.ts`.
- Routes planner and preference persistence through `src/clients/settingsClient.ts`.
- Routes session folder and planned FITS path previews through `src/clients/storageClient.ts`.
- Detects Browser vs Tauri runtime through `src/clients/tauriClient.ts`.
- Polls the miniPC frame-transfer agent through `src/clients/frameTransferClient.ts`.
- Can manually transfer one pending frame, transfer all pending frames, or auto-transfer new pending frames as they arrive.
- Keeps a compact local history of the last 25 checksum-verified transfers.
- Detects locally existing frames by checksum and acknowledges them without writing duplicate files.
- Shows whether the latest transfer was a fresh copy or an already-present acknowledgement.
- Shows failed agent-side frame transfers and can retry failed frames.
- Shows the agent's frame source classification, such as `sequence`, `snapshot`, or `unknown`.
- Shows basic mount, camera, focuser, and guider details.
- Opens a WebSocket connection to the NINA Advanced API event stream.
- Displays recent WebSocket events when NINA emits them.
- Uses a compact persistent status bar and workflow tabs.
- Separates setup, targeting, acquisition, settings, and diagnostics.
- Supports a local `Demo Data` mode for UI work when the miniPC and scope are powered down.
- Imports the currently selected object from Stellarium Remote Control.
- Shows target coordinates/details and a RedCat 51 / ASI183MC Pro frame overlay.
- Generates a DSS2 color survey preview through CDS HiPS2FITS when target coordinates are available.
- Provides local sequence prep for exposure, frame count, gain, offset, camera temperature, centering tolerance, autofocus, guiding, dithering, and notes.
- Calculates total integration and rough sequence duration.
- Adds planned targets to a local `Tonight` queue.
- Shows the active queued plan in the Acquisition tab with planned target, exposure, frame count, integration, estimated duration, and saved-capture run progress.
- Loads a local PNG/JPEG/WebP preview image in the Acquisition tab for offline inspection.
- Applies display-only preview stretch controls without modifying source image data.
- Renders the latest transferred local FITS frame through a desktop FITS preview adapter when running in Tauri.
- Shows basic loaded-image metadata, FITS size, FITS header rows, and placeholders for future FITS-derived quality stats.
- Generates the planned FITS frame list from the active queued plan.
- Persists planner state through the settings adapter: active tab, imported target, sequence settings, Tonight queue, and active queue item.
- Shows storage naming previews in the form `jun142026_m31_light/1.fits`.
- Shows last autofocus result when NINA has one.
- Can start or cancel autofocus through `GET /v2/api/equipment/focuser/auto-focus`.
- Can send Three Point Polar Alignment commands through the TPPA WebSocket channel and shows a workflow panel for TPPA state, error values, instructions, and recent TPPA events.
- Can run a guarded saved-FITS capture loop from the active queued plan by calling NINA Advanced API camera capture with `save=true`.
- Can prepare the active target by asking NINA to unpark if needed, enable sidereal tracking, and slew/center the mount using `equipment/mount/slew` with `center=true`.
- Can stop an active Prepare Target operation through `equipment/mount/slew/stop`.
- Shows a compact Prepare Target trace in Run Details with step names, timestamps, and NINA response text.

Autofocus, TPPA, cooling, preview exposure, Prepare Target, and saved capture-run actions can move hardware or run camera/focuser operations. The UI asks for confirmation before starting autofocus, TPPA, cooling, warming, a test exposure, Prepare Target, or a saved capture run.

Prepare Target is separate from Start Run. Start Run still only saves camera frames through NINA; it does not yet automatically prepare the target, start guiding, run autofocus, dither, handle meridian flips, or execute a full NINA advanced sequence.

## Run

From `D:\AstroImagingStack`:

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5174
```

## Desktop Shell

The Tauri desktop scaffold is in `src-tauri`.

```bash
npm run desktop:dev
npm run desktop:build
```

The desktop backend currently has durable settings commands, persisted storage root selection, storage path preview, frame-write/manifest commands, and placeholder Siril discovery.

The frontend adapters now call Tauri commands when the app is running in the desktop shell, while keeping browser fallback for localhost development. Settings load and save through the Tauri app config directory in desktop mode. Storage can choose and persist an image destination folder in desktop mode. The Settings tab includes the Frame Transfer monitor: it can check the miniPC agent, list pending and failed frames, transfer one or all pending frames, auto-transfer new frames, retry failed frames, and show recent verified transfers in desktop mode.

## Verify

```bash
npm run build
npm run agent:build
npm run agent:publish
npm audit
npm run tauri -- info
npm run probe:nina
```

`npm run probe:nina` requires `Starrunner.local` to be powered on and reachable. When the scope system is off, use the app's `Demo Data` toggle to keep working on UI and workflow behavior without touching hardware.

`npm run agent:publish` creates the Windows miniPC agent drop folder at `dist/starrunner-agent`. The main app remains cross-platform; this published agent is only for Starrunner.

## Storage Naming

The current planning convention is:

```text
date_target_type/frame-number.fits
```

Example:

```text
jun142026_m31_light/1.fits
```

The target name is normalized for storage, so `M 31` becomes `m31`. The image type comes from the sequence prep field, such as `Light`, `Dark`, `Flat`, `Bias`, or `DarkFlat`, and is written lowercase in the folder name.

In browser mode, path previews are relative. In desktop mode, the Targeting tab can choose a local image destination folder, and planned paths are shown under that root.

When frame transfer is connected, desktop writes create or reuse the planned session folder and update `manifest.json` alongside the FITS files.

Auto transfer polls the miniPC agent every few seconds, downloads pending frames, verifies SHA-256 before and after local write, and acknowledges each frame only after the local write is verified.

Before downloading a pending frame, desktop mode checks the expected local session folder for the same file name and SHA-256. If the exact frame is already present, Straylight Studio acknowledges the frame to Starrunner.Agent and records it as `Already present` rather than writing a duplicate.

## Network Defaults

The dev server proxies API calls to:

```text
http://Starrunner.local:1888/v2/api
ws://Starrunner.local:1888/v2/socket
ws://Starrunner.local:1888/v2/tppa
```

The proxy avoids browser CORS issues during development. The desktop runtime now bypasses it: native Tauri HTTP and WebSocket commands connect directly to the saved servers. Settings > Connections accepts NINA and Stellarium origins (scheme, host, and port, without an API path). The app supplies `/v2/api`, `/v2/socket`, `/v2/tppa`, and `/api` as needed. Frame Transfer keeps its separate agent URL. A packaged desktop app does not need Vite running.

The dev server also proxies Stellarium Remote Control from:

```text
http://127.0.0.1:8090/api
```

Stellarium normally runs on the indoor operator computer alongside Straylight Studio. NINA, PHD2, ASTAP, drivers, and the agent run on Starrunner. A different Stellarium host can be saved in Settings. Browser development with custom server addresses may still encounter CORS restrictions; native desktop connections do not use browser fetch or WebSocket.

Enable Stellarium's Remote Control plugin, start the server, select an object in Stellarium, then use `Import From Stellarium` in the Targeting tab.
