# Current Integration State

Last updated: 2026-06-14.

## MiniPC

- Hostname: `Starrunner`.
- Preferred mDNS hostname: `Starrunner.local`.
- NINA Advanced API / ninaAPI port: `1888`.
- Starrunner.Agent frame-transfer port: `4787`.
- API base URL: `http://Starrunner.local:1888/v2/api`.
- WebSocket URL: `ws://Starrunner.local:1888/v2/socket`.
- Frame agent URL currently verified by IPv4: `http://192.168.4.251:4787`.

## Confirmed From Main Machine

- `Starrunner.local` resolves on the local network.
- TCP port `1888` is reachable over Ethernet.
- `GET /v2/api` returns the ninaAPI banner.
- `GET /v2/api/version` returns Advanced API version `2.2.15.1`.
- `GET /v2/api/version/nina` returns NINA version `3.2.0.9001`.
- `GET /v2/api/equipment/info` returns equipment state.
- WebSocket connection opens at `ws://Starrunner.local:1888/v2/socket`.
- `GET http://192.168.4.251:4787/health` reaches `Starrunner.Agent`.
- The agent reports `missing-output-root` until `C:\Astro\nina-output` exists on Starrunner.
- `Starrunner.local:4787` currently hangs from the main machine because name resolution prefers an IPv6 route that does not complete for this service. Use the editable Frame Transfer URL in Straylight Studio and set it to `http://192.168.4.251:4787` for now.

## Equipment State Observed Through API

The latest API probe reported:

- Mount connected: yes.
- Mount driver: `DeviceHub -> Explore Scientific PMC-Eight ASCOM Driver`.
- Camera connected: yes.
- Focuser connected: yes.
- Guider connected: yes.

The network and NINA API baseline is now good enough to begin building the first main-machine client.

## Useful Probe Command

From the project folder:

```bash
node tools/probe-nina-api.mjs
```

Or with an explicit host:

```bash
node tools/probe-nina-api.mjs Starrunner.local
```

The script uses only Node's built-in `fetch` and `WebSocket`, so it should remain OS-agnostic.
