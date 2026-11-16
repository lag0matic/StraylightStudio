import { cleanupActions, normalizeCleanupPolicy } from './ninaCleanup.ts';
import type { CleanupPolicy, CleanupState } from './ninaCleanup';
import { flipTriggerState, validateMeridianFlipProfile } from './ninaMeridianFlip.ts';
import type { MeridianFlipProfile } from './ninaMeridianFlip';

export type NinaPlanInput = {
  target: { name: string; raDegrees?: number; decDegrees?: number; rotationDegrees: number };
  plan: { imageType: string; exposureSeconds: number; frameCount: number; gain: number; offset: number; autofocusBeforeRun: boolean; guidingRequired: boolean; dither: boolean };
};
export type NinaSequenceRecord = {
  version: 1; id: string; origin: string; marker: string; captureMarker: string;
  targetName: string; frameCount: number; exposureSeconds: number; imageType: string;
  gain: number; offset: number; light: boolean; autofocus: boolean; guiding: boolean; dither: boolean;
  startedAt: string; stopRequested: boolean; payload: Record<string, unknown>;
  cleanupPolicy?: CleanupPolicy; cleanupState?: CleanupState; endInstructionCount?: number; stopOutcome?: 'complete' | 'aborted' | 'failed';
  meridianFlip?: MeridianFlipProfile;
};
type Node = Record<string, unknown>;
const type = (name: string) => `NINA.Sequencer.${name}, NINA.Sequencer`;

export function buildNinaSequence(input: NinaPlanInput, id: string, origin: string, cleanup?: CleanupPolicy, flip?: MeridianFlipProfile): NinaSequenceRecord {
  const { target, plan } = input;
  const imageType = plan.imageType.toUpperCase() === 'DARKFLAT' ? 'DARK' : plan.imageType.toUpperCase();
  if (!['LIGHT', 'DARK', 'BIAS', 'FLAT', 'DARKFLAT'].includes(imageType)) throw new Error('Unsupported sequence image type.');
  if (!target.name.trim() || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('Invalid sequence target or run identifier.');
  if (!Number.isFinite(target.rotationDegrees)) throw new Error('Target rotation must be finite.');
  if (!Number.isInteger(plan.frameCount) || plan.frameCount < 1 || plan.frameCount > 500) throw new Error('Frame count must be between 1 and 500.');
  if (!Number.isFinite(plan.exposureSeconds) || plan.exposureSeconds <= 0 || plan.exposureSeconds > 2000) throw new Error('Exposure must be greater than zero and at most 2000 seconds.');
  if (![plan.gain, plan.offset].every((value) => Number.isInteger(value) && value >= 0)) throw new Error('Gain and offset must be nonnegative integers.');
  const light = imageType === 'LIGHT';
  const cleanupPolicy = cleanup ? normalizeCleanupPolicy(cleanup) : undefined;
  const meridianFlip = light && flip ? validateMeridianFlipProfile(flip) : undefined;
  if (meridianFlip && !plan.guidingRequired) throw new Error('Enable guiding for native meridian-flip recovery.');
  if (meridianFlip && (!cleanupPolicy || cleanupPolicy.failed.mount === 'leave')) throw new Error('Automatic flips require failure cleanup to stop tracking or park.');
  if (light && (!Number.isFinite(target.raDegrees) || target.raDegrees! < 0 || target.raDegrees! >= 360 || !Number.isFinite(target.decDegrees) || Math.abs(target.decDegrees!) > 90)) throw new Error('Light sequences require valid J2000 coordinates.');
  if (light && plan.dither && !plan.guidingRequired) throw new Error('Dithering requires guiding.');
  let nextId = 0;
  const container = (name: string, label: string, parent?: Node): Node => ({
    $id: String(++nextId), $type: type(`Container.${name}`), Name: label,
    ...(parent ? { Parent: { $ref: parent.$id } } : {}), Attempts: 1, ErrorBehavior: 2,
    Strategy: { $type: type('Container.ExecutionStrategy.SequentialStrategy') },
    Items: [], Conditions: [], Triggers: [], IsExpanded: true
  });
  const leaf = (name: string, parent: Node, fields: Node = {}): Node => ({ $type: type(`SequenceItem.${name}`), Parent: { $ref: parent.$id }, Attempts: 1, ErrorBehavior: 2, ...fields });
  const root = container('SequenceRootContainer', `Straylight Studio ${id}`);
  const start = container('StartAreaContainer', 'Start', root);
  const targets = container('TargetAreaContainer', 'Targets', root);
  const end = container('EndAreaContainer', 'End', root);
  const marker = `SLS ${id} ${target.name}`;
  const captureMarker = `SLS Capture ${id}`;
  const dso = container('DeepSkyObjectContainer', marker, targets);
  const capture = container('SequentialContainer', captureMarker, dso);
  const ra = (target.raDegrees ?? 0) / 15;
  const dec = Math.abs(target.decDegrees ?? 0);
  dso.Target = {
    $type: 'NINA.Astrometry.InputTarget, NINA.Astrometry', TargetName: target.name,
    PositionAngle: target.rotationDegrees,
    InputCoordinates: {
      $type: 'NINA.Astrometry.InputCoordinates, NINA.Astrometry',
      RAHours: Math.floor(ra), RAMinutes: Math.floor(ra * 60) % 60, RASeconds: (ra * 3600) % 60,
      NegativeDec: (target.decDegrees ?? 0) < 0, DecDegrees: Math.trunc(target.decDegrees ?? 0) || 0, DecMinutes: Math.floor(dec * 60) % 60, DecSeconds: (dec * 3600) % 60
    }
  };
  if (light) {
    start.Items = [leaf('Telescope.UnparkScope', start), leaf('Telescope.SetTracking', start, { TrackingMode: 0 })];
    (dso.Items as Node[]).push(leaf('Platesolving.Center', dso, { Inherited: true }));
    if (plan.autofocusBeforeRun) (dso.Items as Node[]).push(leaf('Autofocus.RunAutofocus', dso));
    if (plan.guidingRequired) {
      (dso.Items as Node[]).push(leaf('Guider.StartGuiding', dso, { ForceCalibration: false }));
      end.Items = [leaf('Guider.StopGuiding', end)];
    }
  }
  if (cleanupPolicy) {
    end.Items = cleanupActions({ light, guiding: light && plan.guidingRequired, cleanupPolicy }, 'complete').map((action) =>
      action === 'guide' ? leaf('Guider.StopGuiding', end) : action === 'park' ? leaf('Telescope.ParkScope', end)
        : action === 'tracking' ? leaf('Telescope.SetTracking', end, { TrackingMode: 5 }) : leaf('Camera.WarmCamera', end, { Duration: cleanupPolicy.warmMinutes }));
  }
  capture.Conditions = [{ $type: type('Conditions.LoopCondition'), Parent: { $ref: capture.$id }, Iterations: plan.frameCount, CompletedIterations: 0 }];
  capture.Items = [leaf('Imaging.TakeExposure', capture, {
    ExposureTime: plan.exposureSeconds, Gain: plan.gain, Offset: plan.offset,
    Binning: { $type: 'NINA.Core.Model.Equipment.BinningMode, NINA.Core', X: 1, Y: 1 }, ImageType: imageType, ExposureCount: 0
  })];
  if (meridianFlip) {
    (capture.Triggers as Node[]).push({ $type: type('Trigger.MeridianFlip.MeridianFlipTrigger'), Parent: { $ref: capture.$id }, TriggerRunner: container('SequentialContainer', 'Meridian flip') });
  }
  if (light && plan.dither) {
    const runner = container('SequentialContainer', 'Dither');
    runner.Items = [leaf('Guider.Dither', runner)];
    (capture.Triggers as Node[]).push({ $type: type('Trigger.Guider.DitherAfterExposures'), Parent: { $ref: capture.$id }, AfterExposures: 1, TriggerRunner: runner });
  }
  (dso.Items as Node[]).push(capture);
  targets.Items = [dso];
  root.Items = [start, targets, end];
  return { version: 1, id, origin, marker, captureMarker, targetName: target.name, frameCount: plan.frameCount, exposureSeconds: plan.exposureSeconds, imageType,
    gain: plan.gain, offset: plan.offset, light, autofocus: light && plan.autofocusBeforeRun, guiding: light && plan.guidingRequired, dither: light && plan.dither,
    startedAt: new Date().toISOString(), stopRequested: false, payload: root, cleanupPolicy, endInstructionCount: (end.Items as Node[]).length, meridianFlip };
}

export type NinaNode = { Name: string; Status: string; Items?: NinaNode[]; Conditions?: Array<Record<string, unknown>>; Triggers?: Array<Record<string, unknown>>; [key: string]: unknown };
export function sequenceNodes(value: unknown): NinaNode[] {
  if (!Array.isArray(value) || value.length < 3) throw new Error('Invalid NINA sequence status response.');
  const roots = value.filter((item) => item && typeof item === 'object' && typeof item.Name === 'string');
  if (roots.length < 3) throw new Error('NINA sequence status is incomplete.');
  const nodes: NinaNode[] = [];
  const walk = (node: NinaNode) => {
    if (!node || typeof node.Name !== 'string' || !['CREATED','RUNNING','FINISHED','FAILED','SKIPPED','DISABLED'].includes(node.Status)) throw new Error('Unrecognized NINA sequence state.');
    nodes.push(node);
    if (node.Items !== undefined) { if (!Array.isArray(node.Items)) throw new Error('Invalid sequence items.'); node.Items.forEach(walk); }
    for (const auxiliary of [...(node.Triggers ?? []), ...(node.Conditions ?? [])]) {
      if (auxiliary.Status === 'FAILED') nodes.push({ Name: String(auxiliary.Name ?? 'Sequence condition or trigger'), Status: 'FAILED' });
    }
  };
  roots.forEach(walk);
  return nodes;
}
export function ownedSequence(value: unknown, record: NinaSequenceRecord, verify = false) {
  const all = sequenceNodes(value);
  const target = all.find((node) => node.Name === `${record.marker}_Container`);
  const capture = target?.Items?.find((node) => node.Name === `${record.captureMarker}_Container`);
  if (!target || !capture) throw new Error('The loaded NINA sequence does not match this run.');
  if (verify && all.some((node) => /^NINA\..*,\s*NINA/.test(node.Name))) throw new Error('NINA loaded an unknown instruction. Start was cancelled.');
  const expectedLeaves = (record.light ? 4 + Number(record.autofocus) + Number(record.guiding) : 1) + (record.endInstructionCount ?? Number(record.guiding));
  if (verify && (all.some((node) => node.Status !== 'CREATED') || all.filter((node) => !node.Items).length !== expectedLeaves)) throw new Error('NINA did not load all required sequence instructions. Start was cancelled.');
  const flipState = flipTriggerState(capture.Triggers);
  if (verify && ((capture.Triggers?.length ?? 0) !== Number(record.dither) + Number(Boolean(record.meridianFlip))
    || (capture.Triggers ?? []).some((trigger) => /^NINA\..*,\s*NINA/.test(String(trigger.Name)) || trigger.Status !== 'CREATED')
    || Boolean(flipState) !== Boolean(record.meridianFlip) || Boolean(record.meridianFlip && flipState?.hoursToFlip === null)
    || (capture.Triggers?.filter((trigger) => trigger.TargetExposures === 1).length ?? 0) !== Number(record.dither))) throw new Error('NINA did not load the requested flip/dither triggers. Start was cancelled.');
  if (record.meridianFlip && (!flipState || !['CREATED', 'RUNNING', 'FINISHED'].includes(flipState.status) || flipState.status !== 'RUNNING' && flipState.hoursToFlip === null)) all.push({ Name: 'Meridian flip protection missing, disabled, failed, or timing unavailable', Status: 'FAILED' });
  const loops = capture.Conditions?.filter((condition) => typeof condition.Iterations === 'number') ?? [];
  const exposure = capture.Items?.find((node) => typeof node.ExposureTime === 'number');
  if (verify && (loops.length !== 1 || loops[0].Iterations !== record.frameCount || exposure?.ExposureTime !== record.exposureSeconds || exposure.Gain !== record.gain || exposure.Offset !== record.offset || exposure.Type !== record.imageType)) throw new Error('NINA did not load the requested exposure settings. Start was cancelled.');
  const completed = Number(loops[0]?.CompletedIterations ?? exposure?.ExposureCount ?? 0);
  const failed = all.find((node) => node.Status === 'FAILED');
  const running = record.meridianFlip && flipState?.status === 'RUNNING' ? { Name: 'Meridian flip (NINA)', Status: 'RUNNING' }
    : all.find((node) => node.Status === 'RUNNING' && !node.Items?.some((child) => child.Status === 'RUNNING'));
  return { all, target, capture, completed: Math.min(record.frameCount, Math.max(0, Number.isFinite(completed) ? completed : 0)), failed, running, flip: record.meridianFlip ? flipState : null };
}
