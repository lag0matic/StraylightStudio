# Architecture

The central design decision is that hardware authority stays at the telescope, while planning and data ownership live inside on the main machine.

## System Shape

```text
Main PC or Linux/Windows laptop
  Stellarium
    selected object and coordinates
        |
        | HTTP Remote Control API
        v
  Straylight Studio
    target planner
    sequence editor
    monitoring dashboard
    storage receiver
    Siril processing queue
        |
        | clean app API over LAN
        v
Telescope miniPC
  scope-agent
    hardware status
    command receiver
    capture spool watcher
    safety monitor
        |
        | local process and driver integration
        v
  NINA / PHD2 / ASCOM / native SDKs / plate solver
    mount
    imaging camera
    guide camera
    focuser
```

## Main Machine Responsibilities

The main machine owns the observing plan and the data.

- Runs Stellarium for sky browsing and target selection.
- Runs the imaging control UI.
- Imports selected target data from Stellarium.
- Builds capture sequences.
- Stores completed FITS frames in the final session folder.
- Runs or schedules Siril calibration, registration, stacking, and review jobs.
- Displays progress, latest frames, guide status, camera state, and warnings.
- Can reconnect to an already-running telescope session after a network interruption.

The main machine should not instantiate telescope-side ASCOM drivers.

The main app should be OS-agnostic. It should run on Windows and Linux first as a packaged desktop app, with the current browser-based Vite/React surface treated as the prototype shell. This keeps the normal control experience available from the main desktop, a Linux laptop, or a lightweight client such as a Steam Deck.

The preferred desktop runtime is Tauri unless a concrete blocker appears. The React UI should talk through adapter clients so browser prototype behavior and desktop backend behavior share the same frontend contract.

## MiniPC Responsibilities

The miniPC owns direct hardware control and local safety.

- Runs Windows and the telescope-side driver stack.
- Connects to mount, imaging camera, guide camera, and focuser through local USB/serial/native drivers.
- Runs NINA and PHD2 for the first implementation.
- Runs a scope-agent service that exposes a narrow API to the main machine.
- Watches capture output folders and transfers completed frames to the main machine.
- Keeps a rolling local spool until frames are verified on the main machine.
- Handles abort, warm camera, stop guiding, and park mount locally.
- Keeps the system safe if the main machine disconnects.

## Boundary Rule

Commands crossing the network should be high-level and hardware-agnostic:

- Good: `import_target`, `slew_and_center`, `start_sequence`, `abort_sequence`, `park_mount`.
- Bad: `set_com_port`, `open_ascom_chooser`, `instantiate_driver`, `click_nina_button`.

The network API should hide the Windows driver stack from the main app.

## Why Not Remote Desktop As The Main UX

Remote desktop is useful for setup and emergency maintenance, but it is a poor normal control surface:

- It makes the miniPC desktop the center of the workflow.
- It is awkward from a laptop or phone.
- It couples capture success to a remote GUI session.
- It makes monitoring and storage feel bolted on.

The desired daily flow is: pick target inside, start sequence, verify it is healthy, go to bed.

## Why Not Network Shares As The Capture Path

The imaging camera should not write its only copy directly to a network share. A dropped connection or sleeping desktop should not break capture.

The preferred pattern is:

1. Capture software writes each completed frame to a local miniPC spool.
2. The scope-agent detects the completed file.
3. The frame is transferred to the main machine.
4. The main machine verifies size and checksum.
5. The miniPC marks the frame as delivered.
6. The miniPC deletes old delivered files only according to a retention policy.

## First Implementation Bias

The first working version should wrap existing tools instead of replacing them:

- NINA for imaging orchestration.
- PHD2 for guiding.
- ASCOM and native drivers locally on the miniPC.
- ASTAP or another proven solver for plate solving.
- Stellarium on the main machine for target selection.
- Siril on the main machine for processing.

Once the distributed workflow is proven, individual modules can be replaced deliberately.

## NINA API Strategy

Use NINA's Advanced API / ninaAPI plugin as the first automation bridge if it exposes the needed operations.

Expected split:

- HTTP requests for deliberate commands such as equipment status, target actions, sequence actions, and safety actions.
- WebSocket events for live state such as image save, sequence start/finish, guiding, autofocus, mount events, and errors.
- A small custom scope-agent only where NINA's API does not cover the need, especially frame transfer, delivery verification, local safety supervision, and process health.

The MCP server for NINA Advanced API is not a core runtime dependency. It may be useful later for AI-assisted development or conversational control, but the main app should talk to the NINA API or our own narrow scope-agent API directly.
