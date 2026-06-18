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
- Logs tab shows the expected NINA URL, event WebSocket URL, TPPA WebSocket URL, and frame-agent URL.
- A writable image destination can be selected and survives app restart.
- Demo mode can be toggled without hardware.
- Hardware actions still require explicit confirmation where appropriate.

## Not Yet Solved

- Public code signing.
- Auto-update.
- Installer branding beyond current Tauri defaults.
- Linux packaging verification.
- A one-click Windows startup installer for the Starrunner agent.
