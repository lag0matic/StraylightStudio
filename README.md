# Straylight Studio

This was coded with assistance from AI agents (Codex) I am not a professional coder - and there will be bugs/rough edges. Use at your own risk.

Straylight Studio is a cross-platform astrophotography control surface for a Windows-based miniPC running NINA, PHD2, ASTAP, and camera/mount/focuser drivers.

The goal is to keep the heavy, flaky hardware stack close to the telescope while letting the main machine handle planning, monitoring, capture orchestration, frame transfer, and eventually processing.

## Current Shape

- React/Vite frontend with a Tauri desktop runtime path for Windows and Linux.
- Native desktop HTTP/WebSocket connections with configurable NINA, Stellarium, and agent addresses. Packaged apps do not need a development server.
- NINA Advanced API client for equipment status, cooling, autofocus, TPPA, preview capture, saved capture runs, and event streams.
- Stellarium target import through Stellarium Remote Control.
- Starrunner.Agent, a Windows miniPC companion service that watches NINA output and transfers FITS frames to the main machine.
- Local storage naming, FITS manifests, frame-transfer verification, and duplicate-safe acknowledgement with SHA-256.
- PHD2 guide event bridge through the miniPC agent.
- Prepare Target command path that can unpark, enable sidereal tracking, and ask NINA to slew/center the active target.
- Desktop FITS preview rendering, Bayer color preview, stretch controls, and FITS header inspection.
- Full-resolution FITS statistics and a histogram, cached independently of display stretch.
- Offline session review from local folders or network shares: thumbnails, frame navigation, metadata comparison, and persistent keep/reject/undecided decisions. Original images remain untouched.
- Acquisition cancellation guards and automatic transfer that continue across tab navigation, with staged, verified local image writes.

## Current Limits

- Start Run is still a camera saved-capture loop, not a full unattended sequence engine.
- Prepare Target is separate from Start Run and still needs real-sky validation.
- Guiding start/stop, autofocus-before-run orchestration, dithering, meridian behavior, and Siril processing are not finished.
- Windows desktop behavior has been tested; Linux builds and packaging remain unverified.
- This is still development software; hardware-moving actions require attention and physical clearance.

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
npm run check:app
dotnet build agents/Starrunner.Agent/Starrunner.Agent.csproj
npm run agent:test-metadata
```

Additional hardware-free UI checks are available through `npm run test:workflow-ui` and, on Windows, `npm run test:standalone-network`. They require an existing Playwright installation; setup and test coverage are described in [Desktop Packaging](docs/astro-imaging/desktop-packaging.md). The standalone harness uses local simulated services and a separate app settings profile.

Build the packaged desktop app:

```bash
npm run desktop:build
```

See `docs/astro-imaging/desktop-packaging.md` for the current release checklist.

See [Current Integration State](docs/astro-imaging/current-integration-state.md) for the latest implementation status, verified behavior, and remaining work.

## MiniPC Agent

Build and publish the Windows-side Starrunner agent:

```bash
npm run agent:publish
```

The publish output is generated under `dist/starrunner-agent` and should be copied to the miniPC when updating the agent.

## Notes

The app is intentionally a wrapper around proven astronomy tools first. Replacement of NINA/PHD2 behavior should happen only where Straylight Studio can make the distributed workflow meaningfully cleaner or more reliable.
