# API Concepts

The network API should be narrow, explicit, and high-level. It should hide the telescope-side driver stack from the main machine.

## Transport

Likely first choices:

- HTTP for commands and file transfer.
- WebSocket for live events and status.

The API should be easy to inspect with normal tools during early development.

The first NINA-facing implementation should use the NINA Advanced API / ninaAPI plugin where possible. As of the current ninaAPI documentation, its versioning uses paths such as `v2/api`, and its WebSocket server is documented at `ws://localhost:1888/v2` when accessed locally on the miniPC.

Our app should make the host configurable, for example:

```text
http://Starrunner.local:1888/v2/api
ws://Starrunner.local:1888/v2/socket
```

Do not hard-code `localhost` in the main app, because NINA is running on the miniPC while the app may run on Windows, Linux, or another browser-capable client.

## Command Categories

- Health and discovery.
- Target import.
- Sequence planning.
- Sequence execution.
- Frame transfer.
- Safety actions.
- Logs and diagnostics.

## API Layers

There are likely two network layers:

1. NINA Advanced API / ninaAPI, exposed by NINA on the miniPC.
2. Our scope-agent API, added only for missing behavior such as frame transfer, checksums, spool retention, process supervision, and extra safety rules.

The main app can talk to both, but it should wrap those calls behind one internal client interface so the UI does not care which backend handled a command.

## Health

Example request:

```http
GET /health
```

Example response:

```json
{
  "status": "ok",
  "agent_version": "0.1.0",
  "hostname": "scope-mini",
  "time": "2026-06-12T23:10:00-04:00",
  "services": {
    "nina": "unknown",
    "phd2": "unknown",
    "spool": "ok"
  }
}
```

## Target Import

Target import is not a hardware movement command.

```http
POST /targets/import
```

```json
{
  "source": "stellarium",
  "name": "M 13",
  "ra_hours": 16.6949,
  "dec_degrees": 36.4613,
  "epoch": "J2000"
}
```

## Sequence Run

Sequence run is a high-level operation. The scope-agent may implement it directly later, but the first version can delegate to NINA where possible.

```http
POST /sequences/run
```

```json
{
  "target": {
    "name": "M 13",
    "ra_hours": 16.6949,
    "dec_degrees": 36.4613
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
  }
}
```

## Safety Commands

Safety commands must be handled locally on the miniPC.

Examples:

- `POST /safety/abort`
- `POST /mount/park`
- `POST /camera/warm`
- `POST /guiding/stop`

`abort` should stop capture first, stop guiding if appropriate, warm the camera if requested, and park the mount if requested.

Example:

```json
{
  "reason": "manual",
  "warm_camera": true,
  "park_mount": true
}
```

## Event Stream

The main app should subscribe to status events.

```text
WS /events
```

Example events:

```json
{
  "type": "frame.delivered",
  "frame_id": "2026-06-12_M13_LIGHT_00042",
  "target": "M13",
  "remote_path": "D:\\AstroSessions\\2026-06-12\\M13\\lights\\LIGHT_00042.fit",
  "sha256": "example"
}
```

```json
{
  "type": "warning",
  "severity": "high",
  "message": "Main machine unavailable; capture continues to local spool.",
  "spool_used_gb": 42.3
}
```

## Error Shape

Errors should be structured and useful:

```json
{
  "error": {
    "code": "PLATE_SOLVE_FAILED",
    "message": "Plate solve failed after 3 attempts.",
    "recoverable": true,
    "details": {
      "attempts": 3,
      "last_solver": "ASTAP"
    }
  }
}
```

## Versioning

Use explicit API versions from the start:

```text
/api/v1/health
/api/v1/targets/import
/api/v1/sequences/run
```

This keeps early experiments from becoming accidental permanent contracts.
