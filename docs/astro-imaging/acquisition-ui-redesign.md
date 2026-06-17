# Acquisition UI Redesign

The Acquisition view should behave like a live imaging console, not a report dashboard. During a session, the most important questions are:

- Is the camera currently doing what I asked?
- Is the newest frame arriving and transferring?
- Does the latest data look usable?
- Is guiding stable enough to keep going?
- If something fails, where should I look first?

The current prototype has the right plumbing, but too many values are shown as large table panels. The next iteration should make the live workflow visible at a glance and push less urgent detail one layer deeper.

## Default Workflow

Auto transfer should be enabled by default for normal desktop operation. Manual transfer remains useful as a fallback and diagnostic tool, but the expected workflow is:

1. NINA saves a FITS frame on Starrunner.
2. Starrunner.Agent detects the completed file.
3. Straylight Studio downloads and verifies the frame.
4. The local file is written under the selected storage root.
5. The latest transferred frame becomes the current preview target.

If no writable storage root is selected, the app should clearly show that auto-transfer is blocked and route the user to choose a destination.

## Always Visible

These items should be visible during acquisition without switching tabs:

- Connection state for NINA and Starrunner.Agent.
- Camera state, current exposure/run progress, and abort control.
- Active target and compact plan summary.
- Transfer summary: pending, delivered, failed.
- Latest image preview.
- Display-only stretch controls for the preview.
- Compact guiding graph and RMS/status.

The display should answer "are we okay?" in a few seconds.

## Run Bar

Replace the large Active Plan panel with a compact run bar.

Example:

```text
M31 | Light | 30 x 120s | Frame 4/30 | Camera Exposing | Auto-transfer On | Pending 0 | Failed 0
```

When idle, the same area should summarize the selected queue item:

```text
M31 | Light | 30 x 120s | Gain 200 | Offset 8 | -10 C | Ready
```

The run bar should contain the primary `Start Capture Run` / `Abort Capture Run` action. Full plan details can live behind a tab or disclosure panel.

## Preview Stage

The latest frame preview should be the visual center of Acquisition.

Short-term behavior:

- Keep PNG/JPEG/WebP preview loading.
- Continue showing streamed NINA preview captures.
- After a FITS transfer, show the latest transferred FITS metadata and mark it as the latest frame.

Next required step:

- Add a desktop preview adapter that can read a local FITS file and produce a display bitmap.
- Apply stretch non-destructively to the rendered preview.

Longer-term behavior:

- Show histogram-derived stretch controls.
- Show FITS-derived stats such as median, mean, min/max, star count, HFR/HFD, and eccentricity.
- Allow quick reject/flag notes without deleting source data.

## Stretch Controls

Stretch controls belong directly under the image preview. They should not be hidden in their own tab because they operate on the preview itself.

Controls:

- Black point.
- Midtone.
- White point.
- Auto stretch.
- Reset.

These controls are display-only. They must not modify source FITS data.

## Guiding Strip

Guiding should be visible at a glance during acquisition.

The default view should show:

- Small RA/Dec graph.
- PHD2 state.
- RMS.
- Latest RA/Dec correction.

Detailed PHD2 values can move behind a `Guiding` or `Stats` details tab.

## Details Tabs

Use details tabs for information that matters, but does not need to occupy first-level space.

Recommended tabs:

- `Plan`: full active plan fields, storage paths, notes, autofocus/guiding/dither settings.
- `Transfer`: pending frames, failed frames, recent transfer history, retry controls.
- `Frames`: planned frame list and recent capture events.
- `Stats`: preview/FITS statistics.
- `Events`: raw NINA and app event feed.

The tabbed area should live near the preview rather than spread across separate large panels.

## Queue

Tonight Queue should stay visible, but it should be compact.

On 1920x1080, it can be a right-side or lower-side strip. On ultrawide, it can become a dedicated side column.

Queue rows should emphasize:

- Target name.
- Image type.
- Frame count and exposure.
- Active/queued state.

## Layout Targets

### 1920x1080

The Acquisition view should fit the core live workflow without excessive scrolling.

Suggested structure:

- Top: run bar.
- Center-left: preview stage and stretch controls.
- Center-right: compact queue and plan/transfer details.
- Bottom: guiding strip and event/status tabs.

### 3440x1440

Ultrawide should expand horizontally instead of making panels huge.

Suggested structure:

- Left: queue and target/session context.
- Center: large preview stage.
- Right: plan, transfer, stats, and events.
- Bottom or side strip: guiding graph.

## Panel Density

Avoid treating every value as a full table row. Use:

- Compact key-value grids.
- Status dots.
- Small chips.
- Dense rows for repeated frame lists.
- Disclosure panels for infrequent detail.

Large cards should be reserved for the preview stage and genuinely important live controls.

## Movable Panels

A movable or dockable panel system may be useful later, but it should not be the first redesign step. Docking systems add a large amount of UI state and layout complexity.

Preferred progression:

1. Build a fixed acquisition console layout.
2. Add collapsible panels and responsive split panes where useful.
3. Consider movable/dockable panels only if the fixed layout remains limiting after real use.

## Phased Implementation

### Phase 1: Console Layout

- Add run bar.
- Move stretch controls under preview.
- Add compact guiding strip near preview.
- Collapse active plan into summary plus details tab.
- Move pipeline into transfer summary/details.

### Phase 2: Latest Frame Preview

- Make successful transfer update latest-frame state.
- Add Tauri command for local FITS read/preview rendering.
- Render latest FITS in the preview stage.
- Apply display-only stretch.

### Phase 3: Better Data Review

- Add FITS statistics.
- Add frame quality summary.
- Add lightweight frame flags or notes.
- Prepare session manifest data for Siril processing.

### Phase 4: Optional Layout Flexibility

- Add resizable panes.
- Persist user layout preferences.
- Reconsider dockable/movable panels if fixed layouts are still restrictive.
