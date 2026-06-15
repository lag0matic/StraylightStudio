# Storage And Processing

The main machine should own the final image archive and processing pipeline. The miniPC should keep a local spool so capture survives temporary network problems.

## Frame Flow

```text
NINA on miniPC
  writes completed FITS frame locally
        |
        v
scope-agent spool watcher
  detects stable file
  computes checksum
  transfers to main machine
        |
        v
main machine storage receiver
  writes final raw frame
  verifies checksum
  acknowledges receipt
        |
        v
miniPC scope-agent
  marks frame delivered
  retains or prunes according to policy
```

## Local Spool Rules

- Capture software writes locally first.
- Files are transferred only after they are complete and stable.
- Each transferred file has a checksum.
- The main machine must acknowledge verified receipt.
- The miniPC keeps delivered files until the retention policy permits deletion.
- Failed transfers retry without blocking capture.
- If the main machine is offline, capture continues until the miniPC spool limit is reached.

## Suggested Spool State

Each frame should have a small state record:

```json
{
  "frame_id": "2026-06-12_M13_LIGHT_00042",
  "local_path": "C:\\Astro\\nina-output\\M13\\LIGHT_00042.fit",
  "remote_path": "D:\\AstroSessions\\2026-06-12\\M13\\LIGHT_00042.fit",
  "size_bytes": 38273024,
  "sha256": "example",
  "state": "delivered",
  "captured_at": "2026-06-12T23:52:10-04:00",
  "delivered_at": "2026-06-12T23:52:18-04:00"
}
```

## Main Machine Session Layout

Suggested archive layout:

```text
D:\AstroSessions\
  2026-06-12\
    session.json
    logs\
    targets\
      M13\
        lights\
        darks\
        flats\
        bias\
        calibrated\
        registered\
        stacked\
        previews\
```

The exact root path can be configurable.

## Transfer Protocol

For the MVP, keep the transfer protocol simple and observable:

- HTTP upload from miniPC to main machine storage receiver, or
- Pull-based sync from main machine to miniPC scope-agent.

Push is simpler for near-real-time frame arrival. Pull can be easier for reconnect behavior. Either way, the state machine should be explicit and checksummed.

Avoid SMB shares as the primary camera write path.

## Siril Integration

Siril should run on the main machine because that is where the final frames live and where more CPU, disk, and memory are available.

First Siril goals:

- Generate per-target Siril scripts from the session manifest.
- Calibrate lights with available darks, flats, and bias/dark-flats.
- Register frames.
- Stack frames.
- Emit a preview image.
- Emit a processing log linked to the session.

Later Siril goals:

- Run incremental previews during capture.
- Reject poor subs based on quality metrics.
- Track FWHM/HFR, eccentricity, star count, background, and rejected-frame reasons.
- Produce a morning report.

## Morning Report

The unattended workflow should produce a concise report:

- Targets attempted.
- Frames captured per target.
- Frames delivered to main machine.
- Frames missing or failed.
- Median focus metric.
- Median guide RMS.
- Camera temperature stability.
- Plate solve failures.
- Autofocus events.
- Meridian flip status.
- Any safety aborts or warnings.
