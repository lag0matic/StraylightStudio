# MiniPC Windows Setup

This checklist is for rebuilding the telescope-side miniPC as a Windows equipment appliance.

The miniPC should be reliable, boring, and locally authoritative over hardware. It does not need to be pleasant as a workstation because it should not be the normal user interface.

## Operating System Setup

- Install Windows 11 or Windows 10 with current updates.
- Give the machine a stable hostname, for example `scope-mini`.
- Create a dedicated local admin account for equipment setup.
- Disable sleep while plugged in.
- Disable USB selective suspend.
- Set Windows Update active hours to avoid the normal imaging window.
- Configure automatic login only if the machine is physically secured and convenience is worth the risk.
- Set the Wi-Fi or Ethernet network profile to private.
- Prefer Ethernet if the observing location makes it practical.
- Reserve a DHCP address in the router, or set a static IP.

## Folder Layout

Suggested telescope-side folders:

```text
C:\Astro\
  config\
  logs\
  spool\
    incoming\
    delivered\
    failed\
  tools\
  nina-output\
```

The miniPC spool is a reliability buffer, not the final archive.

## Required Software Baseline

Install and verify each layer independently before integrating.

- ASCOM Platform.
- Explore Scientific PMC-Eight / iEXOS-100 ASCOM driver and support tools.
- ZWO native camera driver and SDK package.
- Gemini focuser ASCOM driver.
- Astromania guide camera driver.
- NINA.
- PHD2.
- Plate solver, likely ASTAP for the first pass.
- Optional remote maintenance tool, such as Remote Desktop, RustDesk, or VNC.

## Ancillary Tools

These are not the core imaging stack, but they make setup, debugging, and unattended operation easier.

Recommended:

- PowerShell 7 for better scripting and service diagnostics.
- Git for Windows for installing, updating, and testing custom agent code.
- 7-Zip for unpacking driver packages and logs.
- Visual C++ Redistributable bundle, because astronomy drivers and camera SDKs often depend on it.
- Current .NET Desktop Runtime, and the .NET SDK if the scope-agent is built on the miniPC.
- A stable remote maintenance tool, such as Windows Remote Desktop, RustDesk, or AnyDesk.
- Tailscale or ZeroTier if the rig may be controlled away from the home LAN.
- HWiNFO or a similar lightweight hardware monitor for temperature, CPU, memory, and disk checks.
- CrystalDiskInfo for quick storage health checks.
- USBDeview or USBTreeView for USB device troubleshooting.
- ASCOM Diagnostics, installed with the ASCOM Platform, for driver sanity checks.
- NINA Advanced API or ninaAPI-style plugin if using NINA as the first automation bridge.
- NINA Hocus Focus plugin if the Gemini focuser behaves well and autofocus quality becomes important.

Optional:

- Stellarium for local debugging on the miniPC, though the normal design keeps Stellarium on the main machine.
- ASTAP star databases appropriate for the camera and field of view.
- A lightweight log viewer or text editor such as Notepad++ or VS Code.
- Sync tool such as Syncthing only for manual backup or experiments, not as the primary capture-write path.
- UPS monitoring software if the miniPC or mount power chain uses a UPS.

Avoid adding multiple remote-control, sync, and driver-wrapper tools before the baseline works. Fewer always-on background services make USB and driver problems easier to isolate.

## NINA Baseline

Create a NINA equipment profile for the rig:

- Mount: iEXOS-100-2 through the PMC-Eight ASCOM driver.
- Camera: ZWO ASI183MC Pro through native ZWO support where possible.
- Focuser: Gemini focuser through ASCOM.
- Guider: PHD2.
- Plate solver: ASTAP or selected solver.
- Image save path: local miniPC path under `C:\Astro\nina-output`.

Do not point NINA directly at a network share for the main capture output.

## PHD2 Baseline

Create and test a PHD2 profile:

- Guide camera: Astromania SGCMOS.
- Mount guiding path: preferred mount/ASCOM connection, or ST4 only if necessary.
- Calibration succeeds.
- Looping exposure works.
- Guide corrections are accepted by the mount.
- PHD2 can reconnect after disconnecting and reconnecting the camera.

## Hardware Smoke Tests

Before any custom control software is added, verify:

- Mount connects, slews, stops, and parks.
- Camera connects, cools, warms, and captures a frame.
- Focuser connects, moves in and out, and reports position.
- Guide camera loops exposures in PHD2.
- Plate solver can solve a captured frame.
- NINA can run a short sequence locally.
- PHD2 guiding can be started from NINA.
- NINA writes completed frames to the local output folder.

## Scope-Agent Installation Goals

The scope-agent should eventually run as a Windows service or background tray app.

Responsibilities:

- Expose health/status endpoints to the main machine.
- Receive high-level commands.
- Watch the NINA output folder.
- Transfer completed frames to the main machine.
- Verify delivery with checksums.
- Keep local delivery state.
- Execute local safety actions when commanded or when critical failure rules trigger.

## Starrunner.Agent First Install

The current agent is a small HTTP file-transfer service, not a full hardware controller yet. It watches the NINA output folder and exposes completed FITS files to Straylight Studio.

On the development machine:

```bash
npm run agent:publish
```

Copy the published folder:

```text
D:\AstroImagingStack\dist\starrunner-agent\
```

to the miniPC:

```text
C:\Astro\tools\starrunner-agent\
```

On Starrunner, verify `appsettings.json` points to the NINA output folder:

```json
{
  "Agent": {
    "NinaOutputRoot": "C:\\Astro\\nina-output",
    "StableDelaySeconds": 3,
    "StateFilePath": "C:\\Astro\\starrunner-agent-state.json",
    "Extensions": [ ".fit", ".fits" ]
  }
}
```

Run once by hand from PowerShell:

```powershell
cd C:\Astro\tools\starrunner-agent
.\Starrunner.Agent.exe
```

From the main machine, Straylight Studio should be able to reach:

```text
http://Starrunner.local:4787/health
```

After the manual run works, create a Startup shortcut on Starrunner:

```powershell
cd C:\Astro\tools\starrunner-agent
powershell -ExecutionPolicy Bypass -File .\install-starrunner-agent-startup.ps1 -AgentPath "C:\Astro\tools\starrunner-agent\Starrunner.Agent.exe"
```

If Windows Firewall prompts, allow private-network access for the agent.

## Maintenance Access

Remote desktop remains useful for setup, driver updates, and emergency recovery. It should not be required for a normal imaging session.

Keep a simple maintenance checklist:

- Can the main machine ping `scope-mini`?
- Can the main app reach the scope-agent health endpoint?
- Is NINA installed and profile configured?
- Is PHD2 installed and profile configured?
- Is the spool folder writable?
- Is there enough free disk for a full night of local fallback capture?
