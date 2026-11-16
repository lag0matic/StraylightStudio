import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildNinaSequence, ownedSequence, sequenceNodes } from '../src/ninaSequencePlan.ts';
import { NinaSequenceRunner } from '../src/ninaSequenceRunner.ts';
import { OperationGate } from '../src/operationGate.ts';
import { cleanupActions, cleanupVerified, normalizeCleanupPolicy, readCleanupReport } from '../src/ninaCleanup.ts';
import { readMeridianFlipProfile, flipStatusText, sameMeridianFlipProfile, validateFlipEquipment } from '../src/ninaMeridianFlip.ts';

const input = (imageType = 'Light') => ({ target: { name: 'M31', raDegrees: 10.6847, decDegrees: -0.25, rotationDegrees: 12 }, plan: { imageType, exposureSeconds: 60, frameCount: 3, gain: 200, offset: 8, autofocusBeforeRun: true, guidingRequired: true, dither: true } });
const record = (kind = 'Light') => buildNinaSequence(input(kind), 'test-run', 'http://scope.test:1888');
test('installed Advanced API 2.2.15.2 readback is recognized with all required steps', async () => {
  const data = JSON.parse(await readFile(new URL('./fixtures/nina-sequence-2.2.15.2.json', import.meta.url), 'utf8'));
  const plan = input(); plan.target.name = 'SLS_SEQUENCE_LOAD_TEST'; plan.plan.exposureSeconds = 1; plan.plan.frameCount = 2;
  const run = buildNinaSequence(plan, 'load-probe', 'http://scope.test:1888');
  const actual = ownedSequence(data, run, true);
  assert.equal(actual.completed, 0);
  assert.equal(actual.all.filter((node) => !node.Items).length, 7);
  assert.ok(Math.abs(actual.target.Items[0].Coordinates.RADegrees - 10.6847) < 1e-10);
  assert.equal(actual.target.Items[0].Coordinates.Dec, -0.25);
});
function projection(run, status = 'CREATED', completed = 0) {
  const convert = (node) => {
    const output = { Name: node.Name ? `${node.Name}_Container` : node.$type.split(',')[0].split('.').at(-1), Status: status };
    if (node.Items) output.Items = node.Items.map(convert);
    if (node.Conditions) output.Conditions = node.Conditions.map((condition) => ({ Iterations: condition.Iterations, CompletedIterations: completed }));
    if (node.Triggers) output.Triggers = node.Triggers.map((trigger) => trigger.$type.includes('MeridianFlipTrigger') ? { Name: 'Meridian Flip_Trigger', Status: status, TimeToFlip: 0.25 } : { Name: 'Dither', Status: status, TargetExposures: 1 });
    if (node.ExposureTime !== undefined) Object.assign(output, { ExposureTime: node.ExposureTime, Gain: node.Gain, Offset: node.Offset, Type: node.ImageType });
    return output;
  };
  return [{ GlobalTriggers: [] }, ...run.payload.Items.map(convert)];
}
function harness(saved = null) {
  const run = saved || record();
  let state = saved ? projection(run, 'RUNNING', 1) : [{ GlobalTriggers: [] }, ...['Start','Targets','End'].map((name) => ({ Name: `${name}_Container`, Status: 'CREATED', Items: [] }))];
  let persisted = saved;
  const calls = [];
  const gate = new OperationGate();
  const api = {
    read: async () => structuredClone(state), inspect: ownedSequence, nodes: sequenceNodes,
    load: async (record) => { calls.push('load'); state = projection(record); },
    start: async () => { calls.push('start'); state = projection(run, 'RUNNING'); },
    stop: async () => { calls.push('stop'); state = projection(run, 'CREATED'); },
    idle: async () => true,
    readRecord: async () => persisted,
    writeRecord: async (value) => { persisted = value; calls.push(value ? 'persist' : 'clear'); }
  };
  const runner = new NinaSequenceRunner(gate, api);
  return { run, api, gate, runner, calls, setState(value) { state = value; }, saved: () => persisted };
}
test('light plan has ordered mount, center, focus, guide, capture and guider cleanup with abort-on-error', () => {
  const run = record();
  const [start, targets, end] = run.payload.Items;
  assert.match(start.Strategy.$type, /Container.ExecutionStrategy.SequentialStrategy/);
  assert.deepEqual(start.Items.map((node) => node.$type.split(',')[0].split('.').at(-1)), ['UnparkScope','SetTracking']);
  assert.equal(start.Items[1].TrackingMode, 0);
  const dso = targets.Items[0];
  assert.equal(dso.Target.InputCoordinates.NegativeDec, true);
  assert.equal(dso.Target.InputCoordinates.DecDegrees, 0);
  assert.equal(dso.Target.InputCoordinates.DecMinutes, 15);
  assert.equal(dso.Target.PositionAngle, 12);
  assert.match(dso.Items[0].$type, /Platesolving.Center/);
  assert.match(dso.Items[1].$type, /Autofocus.RunAutofocus/);
  assert.match(dso.Items[2].$type, /Guider.StartGuiding/);
  const capture = dso.Items.at(-1);
  assert.equal(capture.Conditions[0].Iterations, 3);
  assert.equal(capture.Items[0].ExposureTime, 60);
  assert.equal(capture.Triggers[0].AfterExposures, 1);
  assert.match(end.Items[0].$type, /StopGuiding/);
  for (const leaf of [...start.Items, ...dso.Items, ...capture.Items, ...end.Items]) assert.equal(leaf.ErrorBehavior, 2);
});
test('calibration plan contains no mount, focus, guider, or dither actions despite light-only flags', () => {
  const run = record('Dark');
  assert.equal(run.light, false);
  assert.equal(run.guiding, false);
  for (const forbidden of ['UnparkScope','SetTracking','RunAutofocus','StartGuiding','Dither']) assert.ok(!JSON.stringify(run.payload).includes(forbidden));
  assert.throws(() => buildNinaSequence({ ...input(), plan: { ...input().plan, guidingRequired: false } }, 'test', 'http://scope'), /Dithering requires guiding/);
  assert.throws(() => buildNinaSequence({ ...input(), plan: { ...input().plan, frameCount: 0 } }, 'test', 'http://scope'), /Frame count/);
});
test('load and readback precede exactly one start; completion releases ownership', async () => {
  const h = harness(); await h.runner.poll(h.run.origin); await h.runner.start(h.run);
  assert.deepEqual(h.calls.slice(0, 3), ['persist','load','start']);
  assert.equal(h.gate.current.kind, 'sequence');
  h.setState(projection(h.run, 'FINISHED', 3)); await h.runner.poll(h.run.origin);
  assert.equal(h.runner.getSnapshot().phase, 'complete'); assert.equal(h.gate.current, null); assert.equal(h.saved(), null);
});
test('reconnecting a persisted run only monitors and never replays start', async () => {
  const h = harness(record()); await h.runner.poll('http://different-host');
  assert.equal(h.runner.getSnapshot().phase, 'running');
  assert.equal(h.runner.getSnapshot().completedFrames, 1);
  assert.deepEqual(h.calls, []);
  assert.equal(h.gate.begin('capture'), null);
});
test('a saved start intent that never started remains unknown and is not restarted', async () => {
  const h = harness(record()); h.setState(projection(h.run)); await h.runner.poll(h.run.origin);
  assert.equal(h.runner.getSnapshot().phase, 'unknown'); assert.deepEqual(h.calls, []); assert.ok(h.gate.current);
});
test('mismatched loaded exposure settings prevent start', async () => {
  const h = harness(); h.api.load = async () => { const data = projection(h.run); data[2].Items[0].Items.at(-1).Items[0].ExposureTime = 999; h.setState(data); h.calls.push('load'); };
  await h.runner.poll(h.run.origin); await h.runner.start(h.run);
  assert.ok(!h.calls.includes('start')); assert.equal(h.runner.getSnapshot().active, true); assert.ok(h.gate.current);
});
test('stop during a delayed load prevents start and waits for verified idle', async () => {
  const h = harness(); let release;
  h.api.load = async () => { h.calls.push('load'); await new Promise((resolve) => { release = resolve; }); h.setState(projection(h.run)); };
  await h.runner.poll(h.run.origin);
  const starting = h.runner.start(h.run);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  const stopping = h.runner.stop();
  assert.equal(h.gate.begin('preview'), null);
  release(); await starting; await stopping;
  assert.ok(!h.calls.includes('start')); assert.equal(h.runner.getSnapshot().phase, 'aborted'); assert.equal(h.gate.current, null);
});
test('lost start response and failed stop retain the lock until a successful stop retry', async () => {
  const h = harness(); h.api.start = async () => { h.calls.push('start'); h.setState(projection(h.run, 'RUNNING')); throw new Error('lost response'); };
  await h.runner.poll(h.run.origin); await h.runner.start(h.run);
  assert.equal(h.runner.getSnapshot().phase, 'running');
  h.api.stop = async () => { throw new Error('stop failed'); };
  await h.runner.stop(); assert.equal(h.runner.getSnapshot().phase, 'error'); assert.ok(h.gate.current);
  h.api.stop = async () => h.setState(projection(h.run));
  await h.runner.stop(); assert.equal(h.gate.current, null);
});
test('failed sequence is never reported as successful just because it is no longer running', async () => {
  const h = harness(record()); const data = projection(h.run, 'FINISHED', 3); data[2].Items[0].Items[0].Status = 'FAILED'; h.setState(data);
  await h.runner.poll(h.run.origin); assert.equal(h.runner.getSnapshot().phase, 'error'); assert.ok(h.gate.current);
});
test('a failed dither trigger prevents successful completion', async () => {
  const h = harness(record()); const data = projection(h.run, 'FINISHED', 3); data[2].Items[0].Items.at(-1).Triggers[0].Status = 'FAILED'; h.setState(data);
  await h.runner.poll(h.run.origin); assert.equal(h.runner.getSnapshot().phase, 'error'); assert.ok(h.gate.current);
});
test('missing autofocus instruction in readback prevents start', async () => {
  const h = harness(); h.api.load = async () => { const data = projection(h.run); data[2].Items[0].Items.splice(1, 1); h.setState(data); };
  await h.runner.poll(h.run.origin); await h.runner.start(h.run); assert.ok(!h.calls.includes('start'));
});
test('failed persistence prevents any remote load or start', async () => {
  const h = harness(); h.api.writeRecord = async () => { throw new Error('disk full'); };
  await h.runner.poll(h.run.origin); await h.runner.start(h.run);
  assert.ok(!h.calls.includes('load')); assert.ok(!h.calls.includes('start')); assert.ok(h.gate.current);
});

function cleanupHarness(kind = 'Light') {
  const policy = normalizeCleanupPolicy();
  for (const outcome of ['complete', 'aborted', 'failed']) policy[outcome] = { stopGuiding: true, mount: 'park', warm: true };
  const run = buildNinaSequence(input(kind), 'cleanup-test', 'http://scope.test:1888', policy);
  const h = harness(run);
  const hardware = { guide: false, park: false, tracking: false, warm: false };
  h.api.cleanupVerified = async (_, action) => hardware[action];
  h.api.cleanupCommand = async (_, action) => { h.calls.push(`cleanup:${action}`); hardware[action] = true; };
  return { ...h, hardware };
}

test('native completion embeds ordered cleanup, native stopped mode 5, and warming minutes', () => {
  const h = cleanupHarness();
  const end = h.run.payload.Items[2];
  assert.deepEqual(end.Items.map((item) => item.$type.split(',')[0].split('.').at(-1)), ['StopGuiding', 'ParkScope', 'WarmCamera']);
  assert.equal(end.Items[2].Duration, 5);
  assert.equal(h.run.endInstructionCount, 3);
  ownedSequence(projection(h.run), h.run, true);
  const missing = projection(h.run); missing[3].Items.pop();
  assert.throws(() => ownedSequence(missing, h.run, true), /required sequence instructions/);
  const policy = normalizeCleanupPolicy({ complete: { stopGuiding: false, mount: 'tracking', warm: false } });
  const run = buildNinaSequence(input(), 'tracking-test', h.run.origin, policy);
  assert.equal(run.payload.Items[2].Items.at(-1).TrackingMode, 5);
  assert.equal(policy.complete.stopGuiding, true);
  assert.equal(normalizeCleanupPolicy().complete.mount, 'leave');
  assert.equal(normalizeCleanupPolicy().complete.warm, false);
});

test('calibration policies permit warming but never mount or guider actions', () => {
  const h = cleanupHarness('Dark');
  assert.deepEqual(cleanupActions(h.run, 'complete'), ['warm']);
  assert.deepEqual(cleanupActions(h.run, 'failed'), ['warm']);
  assert.deepEqual(h.run.payload.Items[2].Items.map((item) => item.$type.split(',')[0].split('.').at(-1)), ['WarmCamera']);
  ownedSequence(projection(h.run), h.run, true);
});

test('native cleanup completion only verifies state and does not replay instructions', async () => {
  const h = cleanupHarness(); Object.keys(h.hardware).forEach((key) => h.hardware[key] = true);
  h.setState(projection(h.run, 'FINISHED', 3)); await h.runner.poll(h.run.origin);
  assert.equal(h.runner.getSnapshot().phase, 'complete'); assert.equal(h.gate.current, null);
  assert.ok(!h.calls.some((call) => call.startsWith('cleanup:')));
  assert.equal(h.runner.getSnapshot().cleanupReport.steps.length, 3);
  assert.ok(h.runner.getSnapshot().cleanupReport.steps.every((step) => step.status === 'verified'));
});

test('finished native instructions with unconfirmed equipment do not unlock or resend', async () => {
  const h = cleanupHarness(); h.setState(projection(h.run, 'FINISHED', 3));
  await h.runner.poll(h.run.origin); await h.runner.poll(h.run.origin);
  assert.equal(h.runner.getSnapshot().phase, 'error'); assert.ok(h.gate.current);
  assert.ok(!h.calls.some((call) => call.startsWith('cleanup:')));
  Object.keys(h.hardware).forEach((key) => h.hardware[key] = true);
  await h.runner.poll(h.run.origin); assert.equal(h.runner.getSnapshot().phase, 'complete');
});

test('cancellation stops NINA, verifies idle, then runs selected cleanup in order', async () => {
  const h = cleanupHarness(); await h.runner.poll(h.run.origin); await h.runner.stop();
  assert.deepEqual(h.calls.filter((call) => call.startsWith('cleanup:')), ['cleanup:guide', 'cleanup:park', 'cleanup:warm']);
  assert.equal(h.runner.getSnapshot().phase, 'aborted'); assert.equal(h.saved(), null); assert.equal(h.gate.current, null);
});

test('failed capture performs selected recovery but retains failed outcome', async () => {
  const h = cleanupHarness(); const data = projection(h.run, 'FINISHED', 1); data[2].Items[0].Items[0].Status = 'FAILED'; h.setState(data);
  await h.runner.poll(h.run.origin);
  assert.equal(h.runner.getSnapshot().phase, 'failed'); assert.equal(h.runner.getSnapshot().active, false);
  assert.equal(h.runner.getSnapshot().cleanupReport.outcome, 'failed');
  assert.deepEqual(h.calls.filter((call) => call.startsWith('cleanup:')), ['cleanup:guide', 'cleanup:park', 'cleanup:warm']);
});

test('an uncertain park is not resent on polls or reconnect; observed success reconciles it', async () => {
  const h = cleanupHarness();
  h.api.cleanupCommand = async (_, action) => { h.calls.push(`cleanup:${action}`); if (action === 'park') throw new Error('response lost'); h.hardware[action] = true; };
  await h.runner.poll(h.run.origin); await h.runner.stop();
  assert.equal(h.runner.getSnapshot().phase, 'error'); assert.ok(h.gate.current);
  await h.runner.poll(h.run.origin); await h.runner.poll(h.run.origin);
  assert.equal(h.calls.filter((call) => call === 'cleanup:park').length, 1);
  const resumed = harness(structuredClone(h.saved())); resumed.setState(projection(resumed.run, 'SKIPPED'));
  resumed.api.cleanupVerified = h.api.cleanupVerified; resumed.api.cleanupCommand = async () => assert.fail('Must not resend an uncertain command');
  await resumed.runner.poll(resumed.run.origin); assert.equal(resumed.runner.getSnapshot().phase, 'error');
  h.hardware.park = true; await resumed.runner.poll(resumed.run.origin);
  assert.equal(resumed.runner.getSnapshot().phase, 'aborted'); assert.equal(resumed.gate.current, null);
});

test('explicit cleanup retry only retries unverified actions', async () => {
  const h = cleanupHarness(); let rejectPark = true;
  h.api.cleanupCommand = async (_, action) => { h.calls.push(`cleanup:${action}`); if (action === 'park' && rejectPark) throw new Error('park failed'); h.hardware[action] = true; };
  await h.runner.poll(h.run.origin); await h.runner.stop(); rejectPark = false;
  await h.runner.stop();
  assert.equal(h.calls.filter((call) => call === 'cleanup:park').length, 2);
  assert.equal(h.calls.filter((call) => call === 'cleanup:guide').length, 1);
  assert.equal(h.calls.filter((call) => call === 'cleanup:warm').length, 1);
  assert.equal(h.runner.getSnapshot().phase, 'aborted');
});

test('unconfirmed guiding blocks mount commands but not independent warming', async () => {
  const h = cleanupHarness();
  h.api.cleanupCommand = async (_, action) => { h.calls.push(`cleanup:${action}`); if (action === 'guide') throw new Error('guide disconnected'); h.hardware[action] = true; };
  await h.runner.poll(h.run.origin); await h.runner.stop();
  assert.ok(!h.calls.includes('cleanup:park')); assert.ok(h.calls.includes('cleanup:warm')); assert.ok(h.gate.current);
});

test('previously verified guiding is checked again before warming completes', async () => {
  const h = cleanupHarness();
  h.api.cleanupCommand = async (_, action) => { h.calls.push(`cleanup:${action}`); if (action !== 'warm') h.hardware[action] = true; };
  await h.runner.poll(h.run.origin); await h.runner.stop(); assert.equal(h.runner.getSnapshot().phase, 'cleanup');
  h.hardware.guide = false; h.hardware.warm = true; await h.runner.poll(h.run.origin);
  assert.equal(h.runner.getSnapshot().phase, 'error'); assert.ok(h.gate.current);
});

test('replacement sequence or corrupt cleanup journal blocks recovery commands', async () => {
  const h = cleanupHarness(); const run = { ...h.run, cleanupState: { outcome: 'aborted', mode: 'client', steps: cleanupActions(h.run, 'aborted').map((action) => ({ action, status: 'pending', message: '' })) } };
  const resumed = harness(run); resumed.setState([{ GlobalTriggers: [] }, ...['Start', 'Targets', 'End'].map((Name) => ({ Name, Status: 'CREATED', Items: [] }))]);
  resumed.api.cleanupCommand = async () => assert.fail('Foreign sequence must not be touched');
  await resumed.runner.poll(run.origin); assert.equal(resumed.runner.getSnapshot().phase, 'error'); assert.ok(resumed.gate.current);
  const corrupt = harness({ ...run, cleanupState: { ...run.cleanupState, steps: [{ action: 'unpark', status: 'pending' }] } });
  await corrupt.runner.poll(run.origin); assert.equal(corrupt.runner.getSnapshot().ready, false); assert.deepEqual(corrupt.calls, []);
});

test('a persisted cleanup command intent is mandatory before sending a command', async () => {
  const h = cleanupHarness(); const save = h.api.writeRecord;
  h.api.writeRecord = async (value) => { if (value?.cleanupState?.steps.some((step) => step.status === 'running')) throw new Error('disk full'); await save(value); };
  await h.runner.poll(h.run.origin); await h.runner.stop();
  assert.ok(!h.calls.some((call) => call.startsWith('cleanup:'))); assert.ok(h.gate.current);
});

test('cleanup verification requires explicit connected device state, not zero power or command acknowledgement', () => {
  assert.equal(cleanupVerified('warm', { Camera: { Connected: true, CoolerPower: 0 } }), false);
  assert.equal(cleanupVerified('warm', { Camera: { Connected: true, CoolerOn: false } }), true);
  assert.equal(cleanupVerified('park', { Mount: { Connected: true, AtPark: true, Slewing: false } }), false);
  assert.equal(cleanupVerified('park', { Mount: { Connected: true, AtPark: true, Slewing: false, TrackingEnabled: false } }), true);
  assert.equal(cleanupVerified('guide', { Guider: { Connected: false, State: 'Stopped' } }), false);
  assert.equal(cleanupVerified('guide', { Guider: { Connected: true, State: 'Guiding' } }), false);
  assert.equal(readCleanupReport({ steps: 'bad' }), null);
});

test('stop racing completion persistence cannot release the gate before recovery finishes', async () => {
  const h = cleanupHarness(); await h.runner.poll(h.run.origin);
  const write = h.api.writeRecord; let release;
  h.api.writeRecord = async (value) => {
    if (value?.cleanupState?.mode === 'native' && !release) await new Promise((resolve) => { release = resolve; });
    await write(value);
  };
  h.api.cleanupCommand = async (_, action) => { h.calls.push(`cleanup:${action}`); if (action !== 'warm') h.hardware[action] = true; };
  h.setState(projection(h.run, 'FINISHED', 3));
  const polling = h.runner.poll(h.run.origin);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  const stopping = h.runner.stop();
  assert.ok(h.gate.current); assert.ok(!h.calls.includes('stop'));
  release(); await polling; await stopping;
  assert.equal(h.runner.getSnapshot().phase, 'cleanup'); assert.equal(h.gate.current.kind, 'sequence');
  assert.equal(h.runner.getSnapshot().active, true);
  h.hardware.warm = true; await h.runner.poll(h.run.origin);
  assert.equal(h.gate.current, null); assert.equal(h.runner.getSnapshot().phase, 'complete');
});

test('capture progress survives reopening during cleanup', async () => {
  const h = cleanupHarness(); h.setState(projection(h.run, 'FINISHED', 3)); await h.runner.poll(h.run.origin);
  const resumed = harness(structuredClone(h.saved())); resumed.setState(projection(resumed.run, 'FINISHED', 3));
  resumed.api.cleanupVerified = async () => true;
  await resumed.runner.poll(resumed.run.origin);
  assert.equal(resumed.runner.getSnapshot().phase, 'complete');
  assert.equal(resumed.runner.getSnapshot().completedFrames, 3);
  assert.ok(!resumed.calls.includes('start'));
});

test('a corrupt saved cleanup policy cannot dispatch recovery commands', async () => {
  const h = cleanupHarness(); const bad = structuredClone(h.run); bad.cleanupPolicy.failed.mount = 'unpark';
  const resumed = harness(bad);
  resumed.api.cleanupCommand = async () => assert.fail('Invalid policy must not dispatch');
  await resumed.runner.poll(bad.origin);
  assert.equal(resumed.runner.getSnapshot().ready, false); assert.ok(resumed.gate.current); assert.deepEqual(resumed.calls, []);
});

const flipProfileResponse = { Id: 'test-profile', Name: 'Test GEM', MeridianFlipSettings: { MinutesAfterMeridian: 5, MaxMinutesAfterMeridian: 10, PauseTimeBeforeMeridian: 0, SettleTime: 30, UseSideOfPier: true, Recenter: true, AutoFocusAfterFlip: false, RotateImageAfterFlip: false } };
function flipRun(kind = 'Light') {
  const policy = normalizeCleanupPolicy(); policy.failed.mount = 'tracking';
  return buildNinaSequence(input(kind), 'flip-run', 'http://scope.test:1888', policy, readMeridianFlipProfile(flipProfileResponse));
}

test('flip profile parsing rejects missing/coerced settings and reversed windows', () => {
  const profile = readMeridianFlipProfile(flipProfileResponse);
  assert.equal(profile.minutesAfter, 5); assert.equal(profile.maximumMinutesAfter, 10);
  for (const patch of [{ MinutesAfterMeridian: '5' }, { Recenter: undefined }, { MaxMinutesAfterMeridian: 1 }, { PauseTimeBeforeMeridian: -1 }]) {
    assert.throws(() => readMeridianFlipProfile({ ...flipProfileResponse, MeridianFlipSettings: { ...flipProfileResponse.MeridianFlipSettings, ...patch } }));
  }
  assert.equal(sameMeridianFlipProfile(profile, { ...profile, settleSeconds: 31 }), false);
});

test('installed NINA accepts the native flip alongside dither and its real readback matches ownership checks', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/nina-meridian-flip-2.2.15.2.json', import.meta.url), 'utf8'));
  const policy = normalizeCleanupPolicy(); policy.failed.mount = 'tracking';
  const value = input(); value.target.name = 'SLS_FLIP_LOAD_PROBE'; value.target.decDegrees = 41.269; value.target.rotationDegrees = 0;
  value.plan.exposureSeconds = 1; value.plan.frameCount = 2; value.plan.autofocusBeforeRun = false;
  const run = buildNinaSequence(value, 'flip-load-probe', 'http://scope.test:1888', policy, fixture.profile);
  const inspected = ownedSequence(fixture.sequence, run, true);
  assert.equal(inspected.flip.status, 'CREATED'); assert.equal(inspected.capture.Triggers.length, 2);
  assert.equal(inspected.completed, 0);
});

test('light capture has exactly one native flip trigger alongside dither, with no fake per-trigger timing settings', () => {
  const run = flipRun(); const capture = run.payload.Items[1].Items[0].Items.at(-1);
  assert.equal(capture.Triggers.length, 2);
  assert.match(capture.Triggers[0].$type, /Trigger.MeridianFlip.MeridianFlipTrigger/);
  assert.deepEqual(capture.Triggers[0].Parent, { $ref: capture.$id });
  assert.equal(capture.Triggers[0].MinutesAfterMeridian, undefined);
  assert.match(capture.Triggers[0].TriggerRunner.Strategy.$type, /SequentialStrategy/);
  ownedSequence(projection(run), run, true);
  const dark = flipRun('Dark'); assert.equal(dark.meridianFlip, undefined);
  assert.ok(!JSON.stringify(dark.payload).includes('MeridianFlipTrigger'));
});

test('flip-enabled plans require planned guiding, recentering, and failure mount cleanup', () => {
  const profile = readMeridianFlipProfile(flipProfileResponse); const policy = normalizeCleanupPolicy();
  assert.throws(() => buildNinaSequence(input(), 'flip', 'http://scope', policy, profile), /failure cleanup/);
  policy.failed.mount = 'park';
  assert.throws(() => buildNinaSequence({ ...input(), plan: { ...input().plan, guidingRequired: false, dither: false } }, 'flip', 'http://scope', policy, profile), /Enable guiding/);
  assert.throws(() => buildNinaSequence(input(), 'flip', 'http://scope', policy, { ...profile, recenter: false }), /re-centering/);
});

test('flip preflight requires GEM slew support, finite timing, appropriate pier side, and recovery equipment', () => {
  const profile = readMeridianFlipProfile(flipProfileResponse);
  const info = { Mount: { Connected: true, AlignmentMode: 'GermanPolar', CanSlew: true, TimeToMeridianFlip: 1.2, SideOfPier: 'pierEast' }, Camera: { Connected: true }, Guider: { Connected: true }, Focuser: { Connected: false } };
  validateFlipEquipment(profile, info);
  for (const patch of [{ Connected: false }, { AlignmentMode: 'AltAz' }, { CanSlew: false }, { TimeToMeridianFlip: 'NaN' }, { TimeToMeridianFlip: NaN }, { SideOfPier: 'pierUnknown' }]) assert.throws(() => validateFlipEquipment(profile, { ...info, Mount: { ...info.Mount, ...patch } }));
  assert.throws(() => validateFlipEquipment(profile, { ...info, Guider: { Connected: false } }), /guider/);
  assert.throws(() => validateFlipEquipment(profile, { ...info, Camera: { Connected: false } }), /camera/);
  assert.throws(() => validateFlipEquipment({ ...profile, autofocus: true }, info), /focuser/);
  validateFlipEquipment({ ...profile, useSideOfPier: false }, { ...info, Mount: { ...info.Mount, SideOfPier: 'pierUnknown' } });
});

test('a lost flip clock is a failure outside the native flip, not a zero-second countdown', () => {
  const run = flipRun(); const data = projection(run, 'RUNNING', 1); const trigger = data[2].Items[0].Items.at(-1).Triggers[0];
  trigger.TimeToFlip = 'NaN'; trigger.Status = 'CREATED';
  assert.ok(ownedSequence(data, run).failed);
  trigger.Status = 'RUNNING'; assert.equal(ownedSequence(data, run).failed, undefined);
  assert.equal(ownedSequence(data, run).flip.hoursToFlip, null);
});

test('load readback must contain both requested triggers, with created status and known metadata', () => {
  const run = flipRun();
  for (const change of ['missing', 'disabled', 'duplicate', 'unknown', 'clock']) {
    const data = projection(run); const triggers = data[2].Items[0].Items.at(-1).Triggers;
    if (change === 'missing') triggers.shift();
    if (change === 'disabled') triggers[0].Status = 'DISABLED';
    if (change === 'duplicate') triggers[1] = { ...triggers[0] };
    if (change === 'unknown') triggers[0].Name = 'NINA.Unknown, NINA.Sequencer';
    if (change === 'clock') triggers[0].TimeToFlip = 'NaN';
    assert.throws(() => ownedSequence(data, run, true), /triggers/);
  }
});

test('running native flip is monitored without issuing flip or repeat-start commands', async () => {
  const run = flipRun(); const h = harness(run);
  await h.runner.poll(run.origin);
  assert.equal(h.runner.getSnapshot().flip.status, 'RUNNING');
  assert.equal(h.runner.getSnapshot().message, 'NINA: Meridian flip (NINA)');
  assert.equal(h.gate.current.kind, 'sequence'); assert.deepEqual(h.calls, []);
  assert.equal(flipStatusText(h.runner.getSnapshot().flip), 'NINA flip in progress');
  assert.match(flipStatusText({ status: 'FINISHED', hoursToFlip: 1 }), /result not exposed/);
  assert.match(flipStatusText({ status: 'CREATED', hoursToFlip: null }), /unavailable/);
});

test('missing or disabled runtime flip protection stops the owned run through failure cleanup', async () => {
  for (const disabled of [false, true]) {
    const run = flipRun(); const h = harness(run); const data = projection(run, 'RUNNING', 1);
    if (disabled) data[2].Items[0].Items.at(-1).Triggers[0].Status = 'DISABLED';
    else data[2].Items[0].Items.at(-1).Triggers.shift();
    h.setState(data); h.api.cleanupVerified = async () => true;
    await h.runner.poll(run.origin);
    assert.ok(h.calls.includes('stop')); assert.equal(h.runner.getSnapshot().phase, 'failed'); assert.equal(h.gate.current, null);
    assert.ok(!h.calls.includes('start'));
  }
});

test('all finished instructions cannot complete a run while the flip trigger is still running', async () => {
  const run = flipRun(); const h = harness(run); const data = projection(run, 'FINISHED', 3);
  data[2].Items[0].Items.at(-1).Triggers[0].Status = 'RUNNING'; h.setState(data);
  await h.runner.poll(run.origin);
  assert.equal(h.runner.getSnapshot().active, true); assert.ok(h.gate.current); assert.equal(h.runner.getSnapshot().phase, 'running');
});

test('changed profile validation prevents start after the loaded plan was checked', async () => {
  const h = harness(); await h.runner.poll(h.run.origin); let checks = 0;
  h.api.validate = async () => { if (++checks === 2) throw new Error('NINA flip profile changed'); };
  await h.runner.start(flipRun());
  assert.ok(h.calls.includes('load')); assert.ok(!h.calls.includes('start')); assert.ok(h.gate.current);
});

test('stop during final profile validation prevents a late start', async () => {
  const h = harness(); const run = flipRun(); await h.runner.poll(run.origin); let checks = 0, release;
  h.api.validate = async () => { if (++checks === 2) await new Promise((resolve) => { release = resolve; }); };
  h.api.stop = async () => h.setState(projection(run)); h.api.cleanupVerified = async () => true;
  const starting = h.runner.start(run);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  const stopping = h.runner.stop(); release(); await starting; await stopping;
  assert.ok(!h.calls.includes('start')); assert.equal(h.gate.current, null); assert.equal(h.runner.getSnapshot().phase, 'aborted');
});
