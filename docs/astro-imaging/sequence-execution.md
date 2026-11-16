# NINA Sequence Execution

Implemented October 31, 2026. Full sequence mode transfers the active target's plan to NINA's Advanced Sequencer. NINA executes the instructions on Starrunner; the indoor app monitors progress and receives files independently. Camera only mode retains the earlier saved-capture loop for diagnostics. Demo mode stays simulated.

## Generated Plan

The native export is a SequenceRootContainer with Start, Targets, and End areas. Every container includes its execution strategy and parent references; omitting Strategy can cause NINA to load unknown instructions while still acknowledging the request.

Light plans contain:

1. Unpark and enable sidereal tracking.
2. Slew and center using NINA's plate-solving profile.
3. Run autofocus when requested, using NINA's configured autofocus implementation.
4. Start guiding when requested; NINA/PHD2 own settling behavior.
5. Execute a sequential exposure loop with the requested count, exposure, gain, offset, and 1x1 binning. Dithering uses NINA's DitherAfterExposures trigger after each exposure when enabled.
6. Execute the configured completion actions: stop guiding, optionally stop tracking or park, and optionally warm the camera. Each is a native NINA End-area instruction.

Calibration plans omit telescope, autofocus, and guider actions. NINA 3.2 represents dark-flat captures as DARK, so DarkFlat is normalized to that native image type. All generated instructions and containers use ErrorBehavior=2 (abort on error), rather than the default continue behavior.

Only the active queue item is executed; this does not iterate the entire Tonight queue. Initial cooling remains under Setup. The plan's Prepare tolerance applies to the separate manual Prepare Target action; full sequences use NINA's plate-solving profile. No rotator instructions are generated. Native meridian flips are opt-in and still require supervised sky validation. Weather handling and real-sky validation remain required before treating this as a complete unattended overnight system.

## Meridian Flips

Settings > Meridian flips enables the native `NINA.Sequencer.Trigger.MeridianFlip.MeridianFlipTrigger` for full light sequences only. It is off by default; calibration, Camera only, and Demo do not acquire a flip trigger. It is attached once to the capture container, before the dither trigger, with the native container strategy and parent reference. NINA evaluates exposure duration, flip windows, tracking, home/park state, and pier side; Straylight does not implement a second timer or issue a manual flip RPC. NINA continues this work if the indoor app closes.

Timing and recovery settings come from the active NINA profile, not fields on the serialized trigger: the native trigger reads those profile properties directly. Read NINA flip profile displays the actual earliest/latest minutes after meridian, pause before meridian, settling seconds, pier-side handling, re-centering, refocus, and preview rotation. This is read-only and never calls profile/change-value. Preview rotation affects NINA's display only, not a physical rotator or Straylight's raw FITS preview. NINA owns guider stop, waiting/tracking changes, flip, optional refocus, re-centering, new guide-star selection, guider restart/settling, and subsequent exposures.

Flip-enabled light runs require planned guiding, profile re-centering enabled, and failure cleanup configured to stop tracking or park. Native flip recovery restarts a connected non-direct guider even if the capture plan did not request it; requiring planned guiding prevents that surprising side effect. Fresh preflight requires a connected slew-capable German equatorial mount, finite driver flip timing, known pier side when the profile uses it, camera/guider connections, and a connected focuser if refocus-after-flip is enabled. Stop/cleanup also waits for that focuser, even when pre-run autofocus was not selected.

The reviewed profile is recorded with the run and checked again before loading and immediately before starting. Profile identity or recovery-setting changes block start. The profile is not locked or overwritten by Straylight: do not switch/edit NINA profiles during an active run. Timing limits must be reviewed against the real mount's hard limits, site coordinates, clock, and cable clearance; a profile value is not a collision guarantee.

Load/readback must contain exactly the requested flip and dither triggers. Missing/unknown/disabled triggers block start. During an owned run, a missing, disabled, failed, or non-running trigger with unavailable timing is treated as failure and uses the existing stop/cleanup path while Straylight is connected. An unavailable clock during the native flip itself is not mistaken for a zero-second countdown. Native RUNNING status is shown as flip in progress without advancing frame count or releasing the equipment gate; reconnect monitors without reloading or replaying a flip. A running flip prevents premature sequence completion.

**NINA 3.2 limitation:** the flip VM treats re-centering as best effort; its boolean result is not propagated by the native trigger, and Advanced API's MOUNT-AFTER-FLIP event omits the success flag. FINISHED is therefore labeled "workflow ended (result not exposed)", not proof of successful physical flipping, centering, or guide recovery. Genuine FAILED trigger states are handled, but swallowed/best-effort errors cannot be reliably inferred from this API alone. This is native flip integration, not an independent telescope-side safety supervisor or a guarantee of fail-closed operation with the app offline. The first real flip, framing, focus, and resumed guiding must be supervised outdoors.

October 31 load-only verification on the installed NINA 3.2.0.9001 / API 2.2.15.2 returned both native flip and dither triggers in CREATED state, with TimeToFlip expressed in **hours**. The observed Home profile had a 5-10 minute after-meridian window, no pre-meridian pause, 30-second settling, pier-side use and re-centering on, refocus and preview rotation off. These are observed settings, not a recommendation for the mount. No sequence was started, no physical flip occurred, and parked/tracking-off/cooler-off states stayed unchanged. The diagnostic load was replaced with an empty, unstarted SLS template. A sanitized real response is retained in `tools/fixtures/nina-meridian-flip-2.2.15.2.json` and exercised through the production parser.

## End-of-Run Actions

Settings contains separate completion, cancellation, and failure policies. Defaults stop guiding when the run planned guiding, leave the mount unchanged, and leave cooling unchanged. Mount actions and warming are opt-in. The selected policy is copied into the run record; changing Settings only changes future runs. Camera-only diagnostic runs do not apply these policies.

Mount actions apply only to light sequences. Calibration sequences never stop tracking, park, or control the guider, even when those settings are selected; camera warming can still be selected. Selecting a mount action forces guider cleanup first, even when guiding was not part of capture, and requires a connected guider. This avoids leaving guide pulses active while tracking is stopped. Parking uses the driver's existing park position; it does not define a new one. Start and retry confirmations explicitly disclose telescope movement.

Normal completion actions are native End-area instructions and continue with NINA while Straylight is closed. StopTracking uses native TrackingMode=5; the Advanced API tracking endpoint instead uses mode=4. Warming uses WarmCamera.Duration in minutes. NINA gradually relaxes cooling, waits, and turns the cooler off; this is not a heater or a guarantee that the sensor reaches ambient/20 C. Initial cooling is not changed.

Cancellation/failure recovery is app-owned, not an agent safety service. After a matching run reports failure, Straylight requests sequence stop; after cancellation, it follows the same path. Both require two idle readbacks before cleanup commands. This requires Straylight running and connected, or reopening it later with the matching run still loaded. A failed stop needs an explicit retry. A replaced sequence or unresolved equipment state blocks recovery rather than touching unrelated work.

Cleanup persists outcome, action order, command intent, start times, and results under the existing run record before sending each command. Reconnect does not resend running/uncertain commands. It first observes equipment state; pending, never-issued actions may continue. Failed/unknown actions require explicit Retry Cleanup confirmation before being resent. Mount commands wait for verified stopped guiding; independent warming can proceed if a guider action fails. A lost park response cannot trigger a repeated park on polling/reconnect. Warming confirmation allows NINA's duration plus its cold-ambient timeout.

An accepted command is not success. Verification requires connected equipment and explicit stopped guider state, stopped tracking/not slewing, parked plus stopped tracking, or CoolerOn=false, respectively. Earlier verified states are checked again while other actions finish. Ownership stays locked until every selected action is verified; a failed capture remains failed even when cleanup succeeds. Acquisition shows each result and its reason. The last cleanup report is retained in `straylight-last-cleanup-v1` after the active record clears.

These controls do not handle power loss, a crashed/unreachable NINA instance, or bad physical park positions. Supervised indoor checks on October 31 passed for isolated native End-area guider-stop/tracking-off/park instructions, the recovery parking endpoint, native completion warming, and real cancellation warming. The capped scope was explicitly cleared for movement. End-only mount tests omitted all targeting/solving/focus/capture steps, and PHD2 was already Stopped. These are not proof of full light-sequence execution, stopping active guiding, or automatic failure-triggered cleanup. See [Current Integration State](current-integration-state.md#supervised-cleanup-checks) for timings and final states; these remaining cases still need validation before unattended use.

## API Contract

- POST `/v2/api/sequence/load`: body is NINA's full native export, not the sequence status projection.
- GET `/v2/api/sequence/start?skipValidation=false`: dispatch start with NINA validation enabled.
- GET `/v2/api/sequence/json`: read the projected instruction tree and loop progress.
- GET `/v2/api/sequence/stop`: dispatch cancellation.
- GET `/v2/api/equipment/info`: verify connected camera is idle and, for a light plan, the mount is connected and not slewing; verify the focuser has stopped when autofocus was requested.

Load replaces NINA's current advanced sequence after an explicit confirmation. A unique run marker is placed in the target container's display name while the imaging target name stays unchanged. Before start, the app checks the marker, capture loop, exposure parameters, required instruction count, dither trigger, and absence of unknown instructions. Native error/validation responses stop progression. There is no skip-validation path.

An API start/stop success response acknowledges dispatch, not completion. A SEQUENCE-FINISHED event alone does not prove success either. Completion requires the matching tree, all instruction/container statuses FINISHED, and the full loop count. Failed instructions, conditions, and triggers cannot be reported as successful completion.

## Ownership And Reconnection

The `straylight-nina-run-v1` settings record is written and awaited before loading or starting NINA. Settings are published through a flushed, verified temporary file and rename. The record contains the server origin, native plan, run markers, count, and stop intent.

On restart, the app reads the existing record and polls that server. It never automatically reloads, resets, or starts the sequence. A saved start intent whose tree is still CREATED remains uncertain until reconciled. A missing/mismatched tree or network failure retains ownership of the operation gate and prevents overlapping commands.

Stop records intent, waits for any in-flight load/start request to settle, and prevents a later start after cancellation. It refuses to cancel a different running sequence. For an owned run, it requests NINA cancellation and requires two stable idle readbacks before applying the run's cleanup policy. Ownership clears only after cleanup verification. Older records without a cleanup policy retain their previous stop behavior. Failed/uncertain stops remain retryable. A local settings failure does not prevent attempting the remote stop, but prevents new cleanup command dispatch.

Captured progress comes from NINA's loop status and is not proof of successful file delivery. Recent verified counts use timestamped local transfer receipts for the target and are limited to the recent history window. Actual FITS delivery still requires the agent's size/SHA-256 and local readback checks.

## Verification

- Unit tests cover plan ordering, J2000 coordinate conversion including negative declinations below one degree, calibration exclusions, readback mismatches, missing autofocus, failure/trigger failure, lost responses, reconnect-without-replay, cancellation during load, and persistence failures.
- Cleanup tests cover native End ordering, state-only verification, explicit retries, lost park responses, guiding-before-mount interlocks, independent warming, malformed policies/journals, stop/completion races, and capture progress across reopening. Settings persistence and guide-stop interlocks also have hardware-free UI coverage.
- A real API 2.2.15.2 light-plan response is retained as `tools/fixtures/nina-sequence-2.2.15.2.json`.
- The installed NINA 3.2.0.9001 loaded the full light recipe and returned its mount, center, autofocus, guide, exposure loop, and dither instructions. Light instructions were not executed indoors.
- A three-frame, five-second DARK sequence continued to completion after the indoor app was closed during the first exposure. The agent queued all three frames. Reopening the app recognized the completed run without restarting it, transferred all three frames, and verified their SHA-256 hashes.
- Stopping a separate two-frame, twenty-second DARK sequence during the first exposure took about 1.9 seconds, verified an idle camera, and prevented the second exposure.
- The mount became connected with tracking enabled during the session; camera-only tests did not issue telescope commands or change that existing state. Guiding/settling, autofocus accuracy, centering, and light-frame execution still need real-sky validation. Linux execution remains unverified.

## Primary Sources

- [Advanced API sequence implementation](https://github.com/christian-photo/ninaAPI/blob/353a853fb598cfa358900340396806c945a0de36/ninaAPI/WebService/V2/Application/Sequence.cs)
- [NINA 3.2 sequence serializer](https://github.com/isbeorn/nina/blob/2393eae581145ed5b8114bf07c48ca2580540fd5/NINA.Sequencer/Serialization/SequenceJsonConverter.cs)
- [Container detection requires Strategy metadata](https://github.com/isbeorn/nina/blob/2393eae581145ed5b8114bf07c48ca2580540fd5/NINA.Sequencer/Serialization/SequenceItemCreationConverter.cs)
- [NINA instruction failure behavior](https://github.com/isbeorn/nina/blob/2393eae581145ed5b8114bf07c48ca2580540fd5/NINA.Sequencer/SequenceItem/SequenceItem.cs)
- [NINA WarmCamera instruction](https://github.com/isbeorn/nina/blob/2393eae581145ed5b8114bf07c48ca2580540fd5/NINA.Sequencer/SequenceItem/Camera/WarmCamera.cs)
- [NINA warm-up and cooler-off implementation](https://github.com/isbeorn/nina/blob/2393eae581145ed5b8114bf07c48ca2580540fd5/NINA.WPF.Base/ViewModel/Equipment/Camera/CameraVM.cs)
- [NINA ParkScope instruction](https://github.com/isbeorn/nina/blob/2393eae581145ed5b8114bf07c48ca2580540fd5/NINA.Sequencer/SequenceItem/Telescope/ParkScope.cs)
- [Advanced API park/tracking mapping](https://github.com/christian-photo/ninaAPI/blob/353a853fb598cfa358900340396806c945a0de36/ninaAPI/WebService/V2/Equipment/Mount.cs)
- [Native flip trigger and exposure-window calculation](https://github.com/isbeorn/nina/blob/2393eae581145ed5b8114bf07c48ca2580540fd5/NINA.Sequencer/Trigger/MeridianFlip/MeridianFlipTrigger.cs)
- [Native flip workflow and best-effort recovery](https://github.com/isbeorn/nina/blob/2393eae581145ed5b8114bf07c48ca2580540fd5/NINA.WPF.Base/ViewModel/MeridianFlipVM.cs)
- [Read-only active profile endpoint](https://github.com/christian-photo/ninaAPI/blob/353a853fb598cfa358900340396806c945a0de36/ninaAPI/WebService/V2/Application/Profile.cs)
