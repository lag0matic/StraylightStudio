# Straylight Studio

This folder captures the working design for Straylight Studio, a distributed astrophotography control and processing application.

The goal is to make the telescope-side miniPC behave like an equipment appliance, while the main computer or laptop owns planning, monitoring, image storage, and processing. The first implementation should wrap proven tools where they are useful, especially NINA, PHD2, Stellarium, plate solvers, and Siril, then replace pieces only when there is a clear payoff.

## Core Goals

- Run the hardware driver stack locally on the miniPC at the telescope.
- Use the main computer or laptop for target planning, sequence setup, session monitoring, and image storage.
- Integrate with Stellarium on the main machine as the target selection source.
- Avoid remote desktop as the normal operating interface.
- Avoid ASCOM Remote or Alpaca as the primary cross-machine control boundary.
- Keep capture safe during temporary network interruptions.
- Store completed image frames on the main machine, with a miniPC spool as a reliability buffer.
- Support unattended overnight operation with local safety behavior at the telescope.
- Use Siril automation for calibration, registration, stacking, and session review after or during capture.
- Ship as a cross-platform desktop app for Windows and Linux, with the current browser app treated as a prototype shell.

## Non-Goals

- Do not make Stellarium directly responsible for mount control.
- Do not require the main computer to load telescope-side ASCOM drivers.
- Do not make a normal network share the only write target for camera frames.
- Do not replace NINA, PHD2, or plate-solving logic before a wrapper-based MVP proves the workflow.
- Do not depend on the network being perfect for the telescope to remain safe.

## Equipment Context

Current planned hardware:

- Mount: Explore Scientific iEXOS-100-2 / PMC-Eight.
- Imaging camera: ZWO ASI183MC Pro cooled color camera.
- Focuser: Gemini focuser.
- Guide camera: Astromania SGCMOS.
- Telescope-side computer: Windows miniPC.
- Operator computer: more powerful Windows desktop, with possible Windows laptop use when remote.

## First MVP

The first useful milestone is intentionally narrow:

1. Stellarium runs on the main machine.
2. The control app imports the selected target from Stellarium.
3. The control app sends target data to the miniPC scope agent.
4. The miniPC logs or acknowledges the target without touching hardware.
5. NINA still performs actual capture while the file transfer service watches its output folder.
6. Completed FITS frames are spooled locally, transferred to the main machine, verified, and retained on the miniPC until receipt is confirmed.

Once this spine works, the hardware operations can be added one at a time.

## Document Map

- [Architecture](architecture.md): system boundaries and service responsibilities.
- [Client App](client-app.md): current local web client and run commands.
- [Desktop Runtime](desktop-runtime.md): Tauri migration path and frontend/backend adapter boundaries.
- [Frame Transfer Protocol](frame-transfer-protocol.md): miniPC agent endpoints and checksum delivery flow.
- [Current Integration State](current-integration-state.md): live miniPC/API facts discovered during setup.
- [MiniPC Windows Setup](minipc-windows-setup.md): rebuild checklist and driver/software baseline.
- [Stellarium Integration](stellarium-integration.md): target import model using Stellarium on the main machine.
- [UI Principles](ui-principles.md): interface direction based on the Uncodixfy standard.
- [Networking](networking.md): home Ethernet, field hotspot, and discovery assumptions.
- [Power Planning](power-planning.md): battery, voltage conversion, and runtime assumptions.
- [Storage And Processing](storage-and-processing.md): frame spool, transfer, verification, and Siril pipeline.
- [API Concepts](api-concepts.md): initial command, event, and data shapes.
- [Roadmap](roadmap.md): staged implementation path.
