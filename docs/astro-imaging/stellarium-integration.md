# Stellarium Integration

Stellarium should be the target selection source, not the mount controller.

The preferred workflow is Option A: run Stellarium on the main machine and let the imaging control app import the selected target through Stellarium's local Remote Control HTTP API.

## Workflow

```text
Stellarium on main machine
  user selects a sky object
        |
        | local HTTP Remote Control API
        v
Imaging control app on main machine
  imports target identity and coordinates
  displays target details
  adds target to tonight or runs now
        |
        | app API
        v
MiniPC scope-agent
  receives target or sequence command
  delegates hardware work locally
```

## Design Rules

- Stellarium does not connect directly to the mount.
- Stellarium does not need ASCOM, Alpaca, PHD2, the focuser, or the camera.
- The imaging app decides whether an imported target becomes a saved plan, a framing action, or an immediate sequence.
- Importing a target and running a sequence are separate operations.

## Target Import

At minimum, an imported target should include:

- Source: `stellarium`.
- Display name.
- Right ascension.
- Declination.
- Coordinate epoch if known.
- Import time.

Useful optional fields:

- Object type.
- Magnitude.
- Angular size.
- Altitude and azimuth now.
- Transit time.
- Rise and set times.
- Notes from Stellarium or SIMBAD-style metadata.

## Example Imported Target

```json
{
  "type": "target.imported",
  "source": "stellarium",
  "name": "M 13",
  "ra_hours": 16.6949,
  "dec_degrees": 36.4613,
  "epoch": "J2000",
  "created_at": "2026-06-12T23:14:00-04:00"
}
```

## Example Action From Imported Target

```json
{
  "type": "sequence.run",
  "target": {
    "name": "M 13",
    "ra_hours": 16.6949,
    "dec_degrees": 36.4613,
    "source": "stellarium"
  },
  "centering": {
    "plate_solve": true,
    "tolerance_arcsec": 30
  },
  "autofocus": {
    "mode": "before_sequence"
  },
  "guiding": {
    "enabled": true,
    "dither": true
  },
  "capture": {
    "exposure_seconds": 180,
    "gain": 120,
    "offset": 30,
    "count": 60,
    "temperature_c": -10
  },
  "storage": {
    "destination": "main_pc",
    "verify_checksum": true,
    "spool_on_minipc": true
  }
}
```

## Current Behavior

The Stellarium path now proves the data path and feeds the current planning workflow:

1. User selects a target in Stellarium.
2. User clicks `Import From Stellarium` in the imaging app.
3. Imaging app reads `GET /api/objects/info?format=map` through the local Stellarium Remote Control server.
4. Imaging app displays the imported target.
5. Imaging app shows a survey preview and frame overlay for the RedCat 51 / ASI183MC Pro field of view.
6. User can add the imported target to Tonight and use it as the active Acquisition target.
7. User can run Prepare Target from Acquisition, which asks NINA to unpark if needed, enable sidereal tracking, and slew/center.

Importing from Stellarium alone does not move hardware. Prepare Target is the separate hardware-moving action and asks for confirmation.

NINA can show framing and rotation after plate solving. Without a rotator, this app should initially treat rotation as a manually entered planning value. Later, after capture/plate-solve events are wired into the acquisition flow, the app can update the current rotation from solved image metadata.

## Later Behavior

After the import path is stable:

- Add target altitude and transit checks.
- Refine framing previews and rotation feedback from solved images.
- Add sequence templates.
- Decide whether Start Run should optionally call Prepare Target automatically.
- Add a target queue for unattended sessions.
