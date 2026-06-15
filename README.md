# Straylight Studio

Straylight Studio is a cross-platform astrophotography control surface for a Windows-based miniPC running NINA, PHD2, ASTAP, and camera/mount/focuser drivers.

The goal is to keep the heavy, flaky hardware stack close to the telescope while letting the main machine handle planning, monitoring, capture orchestration, frame transfer, and eventually processing.

## Current Shape

- React/Vite frontend with a Tauri desktop runtime path for Windows and Linux.
- NINA Advanced API client for equipment status, cooling, autofocus, TPPA, preview capture, saved capture runs, and event streams.
- Stellarium target import through Stellarium Remote Control.
- Starrunner.Agent, a Windows miniPC companion service that watches NINA output and transfers FITS frames to the main machine.
- Local storage naming and frame-transfer verification with SHA-256.
- PHD2 guide event bridge through the miniPC agent.

## Development

Install dependencies:

```bash
npm install
```

Run the browser development shell:

```bash
npm run dev
```

Run the desktop shell:

```bash
npm run desktop:dev
```

Build and test the main pieces:

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
dotnet build agents/Starrunner.Agent/Starrunner.Agent.csproj
npm run agent:test-metadata
```

## MiniPC Agent

Build and publish the Windows-side Starrunner agent:

```bash
npm run agent:publish
```

The publish output is generated under `dist/starrunner-agent` and should be copied to the miniPC when updating the agent.

## Notes

The app is intentionally a wrapper around proven astronomy tools first. Replacement of NINA/PHD2 behavior should happen only where Straylight Studio can make the distributed workflow meaningfully cleaner or more reliable.
