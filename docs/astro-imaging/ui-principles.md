# UI Principles

The imaging control UI should be purpose-built for an observing session: clear controls, readable data, and an obvious next action. Uncodixfy is a useful reference, not a rigid template. Workflow and usability take precedence over blanket stylistic rules; avoid generic dashboard decoration without stripping away useful affordances.

Source reference: https://github.com/cyxzdev/Uncodixfy/blob/main/Uncodixfy.md

## Product Posture

This app is an operations tool for running an astrophotography session. It should feel calm, precise, and trustworthy.

The UI should not cosplay as a spacecraft console. The telescope, frame previews, guiding data, and session state are already interesting. The interface should make them easier to understand, not compete with them.

## Design Rules

- Use straightforward layout, normal spacing, and clear hierarchy.
- Prefer dense but readable panels over oversized decorative sections.
- Use simple borders and surface changes instead of dramatic shadows or glow effects.
- Keep border radius modest, generally 8px or less unless a native control needs otherwise.
- Use normal buttons: solid fills or simple borders, no gradients, no pill overload.
- Use icons where they improve scan speed, especially for toolbar actions.
- Use tabs, segmented controls, tables, split panes, and lists where they match the workflow.
- Prefer stateful controls over separate start/stop/cancel button clusters when the action is naturally a mode.
- Put secondary detail behind local tabs when a workflow panel starts reading like a spreadsheet.
- Use fixed, task-focused columns with independent vertical stacks. Do not stretch one section to match an unrelated tall neighbor.
- Make sections collapsible, remembering the user's choice. Hiding a section must not unmount active work or interrupt capture, transfer, or rendering.
- Keep transitions short and functional: color, opacity, or simple state changes.
- Let real content carry the screen: frame previews, target data, guide metrics, equipment state, logs, and session progress.

## Things To Avoid

- No hero sections inside the app.
- No marketing copy in the operating interface.
- No decorative eyebrow labels.
- No glassmorphism, blur haze, soft corporate gradients, glowing cards, or decorative background blobs.
- No fake charts, fake metrics, or filler panels.
- No big metric-card grid as the first dashboard instinct.
- No nested cards inside cards.
- No colorful badges for every status.
- No dramatic transform hover animations.
- No overpadded layouts that reduce operational density.
- No generic "control room" visual language unless a feature genuinely needs that metaphor.

## Information Architecture

The app should be organized around real astrophotography workflows:

- Persistent status bar: miniPC connection plus camera, mount, focuser, and guiding status lights.
- Setup tab: compact camera/cooling and mount readiness controls beside polar alignment and focus. Keep device inventories, alignment capture settings, and prior results in disclosures.
- Targeting tab: selection and framing in one column; exposure planning and Tonight queue in the other. Source metadata, notes, and output-path detail are secondary.
- Acquisition tab: Prepare Target, current capture state, live frame preview, PHD2 guiding graph, non-destructive preview stretching, delivery status, and quality checks.
- Review tab: folder-based FITS inspection and keep/reject decisions, separate from live acquisition.
- Settings tab: Connections & Storage, Run Policies, and Preview sections. Keep transfer monitoring mounted across section changes. Readiness links should select the relevant section.
- Diagnostics tab: timestamped events, API status, raw event inspection, capability checks, and parser probes.

The first screen should be the actual working session view, not a landing page.

Do not recreate the entire NINA UI. Keep only the controls that are useful from the main-machine command surface.

November 14, 2026: fixed layouts and collapsible sections are the current scope. Docking/movable panels are explicitly deferred; no new UI framework is required for this pass. The desktop content area can grow to 2560px on ultrawide screens without enlarging type.

## Live Preview And Processing

The acquisition view should eventually support inspection-focused image tools:

- Latest frame preview.
- Non-destructive screen stretch controls.
- Basic statistics: min, max, median, star count, HFR/FWHM, eccentricity, background.
- PHD2 guiding graph with RA/Dec traces and readable state at 1920x1080.
- Frame delivery state from miniPC spool to main-machine storage.
- Siril-assisted live stacking or preview stacking when practical.

These tools should help answer one question quickly: is the data good enough to keep the session running?

## Visual Direction

Prefer a dark, muted operational palette, but avoid the common blue-black plus cyan "premium dashboard" look. If no project palette exists, start near neutral graphite:

```text
Background: #111113
Surface:    #1a1a1d
Surface 2:  #222226
Border:     #34343a
Text:       #f2f2f3
Muted:      #a7a7ad
Primary:    #d0a85c
Accent:     #8fbc8f
Danger:     #d36b6b
Success:    #76a875
```

Color should indicate meaning, not decoration.

## Component Bias

- Sidebar only if navigation depth justifies it. If used, keep it fixed, plain, and narrow.
- Header should be a practical toolbar, not a title billboard.
- Tables are appropriate for frame lists, events, device properties, and processing queues.
- Split panes are appropriate for preview plus controls.
- Logs should be compact, filterable, and timestamped.
- Status should be text-first, with color as reinforcement.
- Charts should appear only for real data: guide RMS, focus curves, temperature, star count, HFR/FWHM, eccentricity, sky background.

## Mobile And Laptop Behavior

The app should work from a laptop first. Mobile can be a monitoring and emergency-control surface later.

Responsive behavior should preserve task clarity:

- Collapse secondary panels before hiding primary controls.
- Keep abort, pause, and safety actions reachable.
- Avoid turning the interface into one long stack of unrelated panels.
- Keep latest frame, sequence state, and critical warnings visible.

## Copy

Use plain operational language:

- `Import From Stellarium`
- `Add To Tonight`
- `Prepare Target`
- `Start Sequence`
- `Abort`
- `Warm Camera`
- `Park Mount`
- `Frame Delivered`
- `Guide Star Lost`

Avoid decorative product voice inside the working UI.
