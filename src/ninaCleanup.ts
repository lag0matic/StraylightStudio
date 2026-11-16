import type { NinaSequenceRecord } from './ninaSequencePlan';

export type CleanupOutcome = 'complete' | 'aborted' | 'failed';
export type CleanupAction = 'guide' | 'tracking' | 'park' | 'warm';
export type CleanupOptions = { stopGuiding: boolean; mount: 'leave' | 'tracking' | 'park'; warm: boolean };
export type CleanupPolicy = { complete: CleanupOptions; aborted: CleanupOptions; failed: CleanupOptions; warmMinutes: number };
export type CleanupStep = { action: CleanupAction; status: 'pending' | 'running' | 'verified' | 'unknown'; message: string; startedAt?: string };
export type CleanupState = { outcome: CleanupOutcome; mode: 'native' | 'client'; steps: CleanupStep[]; capturedFrames?: number };
export type CleanupReport = CleanupState & { runId: string; targetName: string };
export const cleanupLabels: Record<CleanupAction, string> = { guide: 'Stop guiding', tracking: 'Stop tracking', park: 'Park mount', warm: 'Warm camera / cooler off' };

export function normalizeCleanupPolicy(value?: Partial<CleanupPolicy>): CleanupPolicy {
  const options = (row?: CleanupOptions): CleanupOptions => {
    const mount = row?.mount === 'tracking' || row?.mount === 'park' ? row.mount : 'leave';
    return { stopGuiding: mount !== 'leave' || row?.stopGuiding !== false, mount, warm: row?.warm === true };
  };
  return { complete: options(value?.complete), aborted: options(value?.aborted), failed: options(value?.failed),
    warmMinutes: Number.isFinite(value?.warmMinutes) && value!.warmMinutes! >= 1 && value!.warmMinutes! <= 60 ? value!.warmMinutes! : 5 };
}

export function cleanupActions(record: Pick<NinaSequenceRecord, 'light' | 'guiding' | 'cleanupPolicy'>, outcome: CleanupOutcome): CleanupAction[] {
  if (!record.cleanupPolicy) return [];
  const policy = record.cleanupPolicy[outcome];
  return [...(record.light && policy.stopGuiding && (record.guiding || policy.mount !== 'leave') ? ['guide' as const] : []),
    ...(record.light && policy.mount !== 'leave' ? [policy.mount] : []), ...(policy.warm ? ['warm' as const] : [])];
}

export function cleanupConfirmation(policy: CleanupPolicy, light = true, guiding = true): string {
  return (['complete', 'aborted', 'failed'] as const).map((outcome) => {
    const row = policy[outcome];
    return `${outcome === 'complete' ? 'Completion' : outcome === 'aborted' ? 'Cancellation' : 'Failure'}: ${[
      ...(light && row.stopGuiding && (guiding || row.mount !== 'leave') ? ['stop guiding'] : []), !light ? 'no mount actions' : row.mount === 'park' ? 'PARK MOUNT (moves telescope)' : row.mount === 'tracking' ? 'stop tracking' : 'leave mount unchanged',
      ...(row.warm ? [`warm camera over ${policy.warmMinutes} min, then cooler off`] : [])].join('; ')}.`;
  }).join('\n');
}

export type CleanupEquipment = {
  Camera?: { Connected?: boolean; CoolerOn?: boolean; IsExposing?: boolean };
  Mount?: { Connected?: boolean; AtPark?: boolean; Slewing?: boolean; TrackingEnabled?: boolean };
  Guider?: { Connected?: boolean; State?: string };
};
export function cleanupVerified(action: CleanupAction, info: CleanupEquipment): boolean {
  if (action === 'guide') return info.Guider?.Connected === true && ['stopped', 'idle', 'selected', 'starselected', 'looping'].includes(info.Guider.State?.toLowerCase() ?? '');
  if (action === 'warm') return info.Camera?.Connected === true && info.Camera.CoolerOn === false;
  return info.Mount?.Connected === true && info.Mount.Slewing === false && info.Mount.TrackingEnabled === false && (action !== 'park' || info.Mount.AtPark === true);
}

export function validateCleanupState(record: NinaSequenceRecord) {
  if (record.cleanupPolicy) {
    const policy = record.cleanupPolicy;
    if (!Number.isFinite(policy.warmMinutes) || policy.warmMinutes < 1 || policy.warmMinutes > 60 || (['complete', 'aborted', 'failed'] as const).some((outcome) => {
      const row = policy[outcome];
      return !row || typeof row.stopGuiding !== 'boolean' || typeof row.warm !== 'boolean' || !['leave', 'tracking', 'park'].includes(row.mount) || row.mount !== 'leave' && !row.stopGuiding;
    })) throw new Error('Invalid saved cleanup policy.');
  }
  const state = record.cleanupState;
  if (!state) return;
  if (!['complete', 'aborted', 'failed'].includes(state.outcome) || !['native', 'client'].includes(state.mode) || !Array.isArray(state.steps)) throw new Error('Invalid saved cleanup state.');
  if (state.capturedFrames !== undefined && (!Number.isInteger(state.capturedFrames) || state.capturedFrames < 0 || state.capturedFrames > record.frameCount)) throw new Error('Invalid saved capture progress.');
  const expected = cleanupActions(record, state.outcome);
  if (state.steps.length !== expected.length || state.steps.some((step, index) => step.action !== expected[index] || !['pending', 'running', 'verified', 'unknown'].includes(step.status) || step.status === 'running' && !Number.isFinite(Date.parse(step.startedAt ?? '')))) throw new Error('Invalid saved cleanup actions.');
}

export function readCleanupReport(value: unknown): CleanupReport | null {
  if (!value || typeof value !== 'object') return null;
  const report = value as CleanupReport;
  return typeof report.targetName === 'string' && typeof report.runId === 'string' && ['complete', 'aborted', 'failed'].includes(report.outcome)
    && ['native', 'client'].includes(report.mode) && Array.isArray(report.steps)
    && report.steps.every((step) => step && Object.hasOwn(cleanupLabels, step.action) && ['pending', 'running', 'verified', 'unknown'].includes(step.status) && typeof step.message === 'string') ? report : null;
}
