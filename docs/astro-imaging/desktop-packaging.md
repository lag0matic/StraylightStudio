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
- Linux packaging verification.
- A one-click Windows startup installer for the Starrunner agent.
