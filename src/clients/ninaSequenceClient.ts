import { connectionClient } from './connectionClient';
import { networkFetch } from './networkClient';
import { tauriClient } from './tauriClient';
import { NinaSequenceRunner } from '../ninaSequenceRunner';
import { ownedSequence, sequenceNodes } from '../ninaSequencePlan';
import type { OperationGate } from '../operationGate';
import type { NinaSequenceRecord } from '../ninaSequencePlan';
import { cleanupVerified, readCleanupReport } from '../ninaCleanup';
import type { CleanupReport } from '../ninaCleanup';
import { readMeridianFlipProfile, sameMeridianFlipProfile, validateMeridianFlipProfile, validateFlipEquipment } from '../ninaMeridianFlip';
import type { MeridianFlipProfile } from '../ninaMeridianFlip';

export const ninaRunKey = 'straylight-nina-run-v1';
const cleanupReportKey = 'straylight-last-cleanup-v1';
async function request(origin: string, path: string, body?: unknown) {
  const url = origin === connectionClient.getSnapshot().ninaOrigin ? connectionClient.endpoint('nina', path) : `${origin}/v2/api/${path}`;
  const response = await networkFetch(url, 30000, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok || data.Success !== true) throw new Error(data.Error || `NINA ${path} failed (HTTP ${response.status}).`);
  return data.Response;
}
export async function readNinaMeridianProfile(origin: string) {
  return readMeridianFlipProfile(await request(origin, 'profile/show?active=true'));
}
export async function prepareNinaMeridianFlip(origin: string): Promise<MeridianFlipProfile> {
  const profile = validateMeridianFlipProfile(await readNinaMeridianProfile(origin));
  const info = await request(origin, 'equipment/info');
  validateFlipEquipment(profile, info);
  return profile;
}
export function createNinaSequenceRunner(gate: OperationGate) {
  return new NinaSequenceRunner(gate, {
    read: (origin) => request(origin, 'sequence/json'), inspect: ownedSequence, nodes: sequenceNodes,
    validate: async (record) => {
      if (record.meridianFlip && !sameMeridianFlipProfile(record.meridianFlip, await prepareNinaMeridianFlip(record.origin))) throw new Error('NINA flip profile changed after preparation. Stop and prepare the run again.');
    },
    load: async (record) => { await request(record.origin, 'sequence/load', record.payload); },
    start: async (origin) => { await request(origin, 'sequence/start?skipValidation=false'); },
    stop: async (record) => {
      await request(record.origin, 'sequence/stop');
      if (record.guiding && !record.cleanupPolicy) await request(record.origin, 'equipment/guider/stop');
    },
    idle: async (record) => {
      const info = await request(record.origin, 'equipment/info');
      return info.Camera?.Connected === true && info.Camera.IsExposing === false
        && (!record.light || info.Mount?.Connected === true && info.Mount.Slewing === false)
        && (!(record.autofocus || record.meridianFlip?.autofocus) || info.Focuser?.Connected === true && info.Focuser.IsMoving === false);
    },
    cleanupVerified: async (record, action) => {
      const info = action === 'guide' ? { Guider: await request(record.origin, 'equipment/guider/info') }
        : action === 'warm' ? { Camera: await request(record.origin, 'equipment/camera/info') }
          : { Mount: await request(record.origin, 'equipment/mount/info') };
      return cleanupVerified(action, info);
    },
    cleanupCommand: async (record, action) => {
      const info = await request(record.origin, 'equipment/info');
      if (info.Camera?.Connected !== true || info.Camera.IsExposing !== false) throw new Error('Camera idle state is not confirmed.');
      if ((record.autofocus || record.meridianFlip?.autofocus) && (info.Focuser?.Connected !== true || info.Focuser.IsMoving !== false)) throw new Error('Focuser idle state is not confirmed.');
      if ((action === 'park' || action === 'tracking') && (info.Mount?.Connected !== true || info.Mount.Slewing !== false)) throw new Error('Mount idle state is not confirmed. No mount command was sent.');
      if (action === 'warm' && info.Camera.CanSetTemperature !== true) throw new Error('Camera temperature control is unavailable.');
      const path = action === 'guide' ? 'equipment/guider/stop' : action === 'park' ? 'equipment/mount/park'
        : action === 'tracking' ? 'equipment/mount/tracking?mode=4' : `equipment/camera/warm?minutes=${record.cleanupPolicy!.warmMinutes}&cancel=false`;
      await request(record.origin, path);
    },
    readCleanupReport: async () => {
      if (tauriClient.isDesktopRuntime()) return readCleanupReport((await tauriClient.invokeIfDesktop<Record<string, unknown>>('load_settings'))?.[cleanupReportKey]);
      try { return readCleanupReport(JSON.parse(localStorage.getItem(cleanupReportKey) || 'null')); } catch { return null; }
    },
    readRecord: async () => {
      if (tauriClient.isDesktopRuntime()) return (await tauriClient.invokeIfDesktop<Record<string, unknown>>('load_settings'))?.[ninaRunKey] ?? null;
      return JSON.parse(localStorage.getItem(ninaRunKey) || 'null');
    },
    writeRecord: async (record: NinaSequenceRecord | null) => {
      const report: CleanupReport | undefined = record?.cleanupState ? { ...record.cleanupState, runId: record.id, targetName: record.targetName } : undefined;
      if (tauriClient.isDesktopRuntime()) await tauriClient.invokeIfDesktop('save_settings', { settings: { [ninaRunKey]: record, ...(report ? { [cleanupReportKey]: report } : {}) } });
      localStorage.setItem(ninaRunKey, JSON.stringify(record));
      if (report) localStorage.setItem(cleanupReportKey, JSON.stringify(report));
    }
  });
}
