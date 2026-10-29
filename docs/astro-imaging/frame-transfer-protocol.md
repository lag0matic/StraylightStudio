# Frame Transfer Protocol

Straylight Studio keeps the main app cross-platform by avoiding Windows file shares. The miniPC runs a small Windows-friendly agent, and the main app talks to it over HTTP.

## Components

`Starrunner.Agent`

- Runs on the miniPC.
- Watches the NINA output folder.
- Detects stable `.fit` and `.fits` files.
- Computes SHA-256.
- Exposes pending frames over HTTP.
- Marks frames delivered after the main app acknowledges the checksum.

`Straylight Studio`

- Runs on Windows or Linux.
- Polls the agent for pending frames.
- Checks whether the exact frame is already present locally.
- Downloads frame bytes over HTTP.
- Writes frames through Tauri `write_frame`.
- Verifies checksum before acknowledging delivery.
- Exposes the frame transfer monitor in the Settings tab and transfer summary in Acquisition.
- Polls Starrunner.Agent for PHD2 guiding status and graph samples.

## Default Network

```text
http://Starrunner.local:4787
```

The main app client uses `VITE_FRAME_AGENT_BASE` when configured, otherwise it defaults to `http://Starrunner.local:4787`.

## Agent Endpoints

```text
GET  /health
GET  /session
POST /session
GET  /frames/pending
GET  /frames/failed
GET  /frames/{id}
POST /frames/{id}/ack
POST /frames/{id}/retry
GET  /phd2/status
```

## PHD2 Monitor

`Starrunner.Agent` connects to PHD2's event server on the miniPC, defaulting to:

```text
127.0.0.1:4400
```

The agent stores recent `GuideStep` events and exposes them through:

```text
GET /phd2/status
```

Straylight Studio uses this for the Acquisition guiding graph. If PHD2 is not running or its server is disabled, the endpoint remains available but reports disconnected status.

## Frame Record

```json
{
  "id": "m31-light-0001-9fc12a",
  "targetName": "M31",
  "imageType": "Light",
  "frameNumber": 1,
  "sourceKind": "sequence",
  "fileName": "M31_LIGHT_0001.fits",
  "sourcePath": "C:\\NINA\\Output\\M31\\Light\\M31_LIGHT_0001.fits",
  "sizeBytes": 42890240,
  "sha256": "0123...",
  "createdAt": "2026-06-14T23:18:04Z",
  "status": "pending"
}
```

## Transfer Flow

1. NINA writes a FITS file on the miniPC.
2. `Starrunner.Agent` waits until the file size is stable.
3. The agent computes SHA-256 and registers the frame as `pending`.
4. Straylight Studio calls `GET /frames/pending`.
5. Straylight Studio checks the expected local session folder for the same file name and SHA-256.
6. If the exact local file already exists, Straylight Studio calls `POST /frames/{id}/ack` and records the history row as `Already present`.
7. Otherwise, Straylight Studio downloads frame bytes from `GET /frames/{id}`.
8. Straylight Studio verifies the downloaded SHA-256.
9. Straylight Studio writes the frame through Tauri `write_frame`.
10. Straylight Studio compares the written file checksum.
11. Straylight Studio calls `POST /frames/{id}/ack`.
12. The agent marks the frame `delivered`.

## NINA File Pattern

The expected NINA save pattern is:

```text
date\target\image-type\target_sensor-temp_exposure_image-type_frame
```

Example:

```text
2015-12-31\M33\LIGHT\M33_-15_10.21_LIGHT_0001.fits
```

The agent treats the target folder as the target name and the image-type folder as the authoritative type for normal sequence frames. Supported type folders include `LIGHT`, `DARK`, `FLAT`, `BIAS`, and `DARKFLAT`. A `SNAPSHOT` folder is classified as `snapshot` and transferred as target `snapshot`, so date folders are not mistaken for targets.

## Agent Configuration

`agents/Starrunner.Agent/appsettings.json`

```json
{
  "Agent": {
    "NinaOutputRoot": "C:\\NINA\\Output",
    "StableDelaySeconds": 3,
    "StateFilePath": "C:\\Astro\\starrunner-agent-state.json",
    "Extensions": [ ".fit", ".fits" ]
  }
}
```

`StateFilePath` stores delivered and failed frame records so the agent does not rediscover already-delivered FITS files as pending after restart.

Run locally:

```bash
dotnet run --project agents/Starrunner.Agent
```

Build:

```bash
dotnet build agents/Starrunner.Agent/Starrunner.Agent.csproj
```

Run parser tests:

```bash
npm run agent:test-metadata
```

Publish a Windows drop folder:

```bash
npm run agent:publish
```

This writes a self-contained Windows x64 build to:

```text
dist/starrunner-agent/
```

Copy that folder to the miniPC. A practical first location is:

```text
C:\Astro\tools\starrunner-agent\
```

Then run:

```powershell
.\Starrunner.Agent.exe
```

The sample Starrunner config is:

```text
agents/Starrunner.Agent/appsettings.Starrunner.sample.json
```

Copy it beside the published `.exe` as `appsettings.json` if the miniPC should watch `C:\Astro\nina-output`.

## Startup Shortcut

Once the agent runs correctly by hand on the miniPC, create a Windows Startup shortcut:

```powershell
cd C:\Astro\tools\starrunner-agent
powershell -ExecutionPolicy Bypass -File .\install-starrunner-agent-startup.ps1 -AgentPath "C:\Astro\tools\starrunner-agent\Starrunner.Agent.exe"
```

This is deliberately a Startup shortcut for now, not a service. It is easier to inspect while the protocol is still young.

## Fake FITS Test

To test the watcher without a real capture, create a small fake FITS-like file:

```bash
npm run agent:fake-fits
```

By default this writes under:

```text
tmp/nina-output/yyyy-MM-dd/M31/LIGHT/
```

To use the real miniPC output path:

```powershell
cd C:\Astro\tools\starrunner-agent
powershell -ExecutionPolicy Bypass -File .\drop-fake-fits.ps1 -OutputRoot "C:\Astro\nina-output"
```

The Straylight Studio Settings tab can use `Check Agent` to poll `/health`, `/frames/pending`, and `/frames/failed`. `Transfer One` transfers or acknowledges the first pending frame. `Transfer All` drains the visible pending queue. `Auto transfer new frames` polls the agent every few seconds and drains pending frames as they arrive. Failed frames stay visible until retried.

Transfer history distinguishes:

- `Transferred`: downloaded, written locally, checksum verified, then acknowledged.
- `Already present`: exact local file and checksum already existed, so the app acknowledged without another write.

## Protected Desktop Writes

The desktop backend now receives the expected size and SHA-256 from the agent, not just the downloaded bytes. It stages and flushes a temporary file, verifies it by reading it back, and publishes it without replacing an existing image. It reads the destination again and commits the manifest before returning a verified result for acknowledgement.

- Same filename and same contents: reuse the verified image.
- Same filename and different contents: report a collision; keep both the original local file and pending agent copy. The batch stops at the error. Resolve the conflicting destination before retrying; it is never silently overwritten or automatically deleted.
- Image saved but manifest commit interrupted: retry verifies the existing image and repairs its manifest entry before acknowledging.
- Failed write, bad checksum/size, or failed manifest commit: no acknowledgement; the agent retains the pending frame.
- Abandoned `.partial` staging files: ignored on retry. No incomplete image is published under its final FITS name.

The current atomic no-replace publication uses hard links and requires filesystem support (NTFS/ext4, not FAT/exFAT). Manifests are updated with a staged rename. This protects normal interruption/retry paths; power-loss durability still depends on the filesystem and storage hardware. Use one Straylight Studio instance per destination session.
