# Networking

The app should support both home and field operation.

## Home Topology

Preferred home setup:

```text
Main PC
  wired or normal home network
        |
Home router / switch
        |
Gigabit Ethernet
        |
MiniPC at telescope
  NINA / PHD2 / ASTAP / drivers / ninaAPI
```

This is the best default for local imaging because Ethernet is faster and more reliable than Wi-Fi through walls.

## Field Topology

Preferred field setup:

```text
Laptop / Steam Deck / tablet
        |
Wi-Fi LAN
        |
MiniPC at telescope
  NINA / PHD2 / ASTAP / drivers / ninaAPI
```

This network does not need internet. It only needs local IP connectivity between the operator device and the miniPC.

## Windows Mobile Hotspot

Windows can share an Ethernet, Wi-Fi, or cellular connection over Wi-Fi using Mobile hotspot. This is useful at home if the miniPC has Ethernet and its Wi-Fi adapter can broadcast a hotspot.

Potential issue: Windows Mobile hotspot is designed around sharing an existing internet connection. Starting a pure local hotspot with no upstream internet can be unreliable or require workarounds. Do not make field operation depend on this behavior until it has been tested on the actual miniPC.

## Recommended Field Router Option

A small travel router is the most reliable field networking option.

Benefits:

- Creates a normal Wi-Fi LAN with no internet required.
- Gives the miniPC and laptop stable DHCP addresses.
- Avoids Windows hotspot startup quirks.
- Can stay mounted in the telescope kit.
- Can optionally bridge to home Wi-Fi, phone hotspot, or Ethernet when available.

The app should work with either a Windows hotspot or a travel-router LAN.

## Discovery And Addressing

The app should support:

- Manual host entry, such as `Starrunner.local` or `192.168.8.20`.
- Configurable NINA API base URL, such as `http://Starrunner.local:1888/v2/api`.
- Configurable WebSocket URL, such as `ws://Starrunner.local:1888/v2/socket`.
- Optional mDNS discovery later.
- A saved connection profile for `Home Ethernet`.
- A saved connection profile for `Field Wi-Fi`.

Manual host entry is the MVP. Discovery is convenience, not a dependency.

## Network Loss Behavior

If the client disconnects:

- The miniPC should continue safe capture if a sequence is already running.
- The miniPC should keep spooling frames locally.
- The main app should reconnect and reconcile session state.
- Safety actions must remain available locally on the miniPC.

Network loss should degrade monitoring and transfer, not immediately break the imaging run.
