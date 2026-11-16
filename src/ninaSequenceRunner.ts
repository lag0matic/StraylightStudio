import type { Operation, OperationGate } from './operationGate';
import type { NinaSequenceRecord, NinaNode } from './ninaSequencePlan';
import { cleanupActions, cleanupLabels, validateCleanupState } from './ninaCleanup.ts';
import type { CleanupAction, CleanupOutcome, CleanupReport } from './ninaCleanup';
import { validateMeridianFlipProfile } from './ninaMeridianFlip.ts';
import type { NativeFlipState } from './ninaMeridianFlip';

export type NinaRunState = {
  ready: boolean; active: boolean; phase: 'checking' | 'idle' | 'loading' | 'starting' | 'running' | 'stopping' | 'cleanup' | 'complete' | 'aborted' | 'failed' | 'error' | 'unknown';
  message: string; completedFrames: number; record: NinaSequenceRecord | null; steps: Array<{ name: string; status: string }>;
  lastRecord: NinaSequenceRecord | null;
  cleanupReport: CleanupReport | null;
  flip: NativeFlipState | null;
};
export type SequenceInspection = { all: NinaNode[]; target: NinaNode; capture: NinaNode; completed: number; failed?: NinaNode; running?: NinaNode; flip?: NativeFlipState | null };
export type NinaSequenceAdapter = {
  read: (origin: string) => Promise<unknown>;
  inspect: (data: unknown, record: NinaSequenceRecord, verify?: boolean) => SequenceInspection;
  nodes: (data: unknown) => NinaNode[];
  load: (record: NinaSequenceRecord) => Promise<void>;
  start: (origin: string) => Promise<void>;
  stop: (record: NinaSequenceRecord) => Promise<void>;
  idle: (record: NinaSequenceRecord) => Promise<boolean>;
  readRecord: () => Promise<unknown>;
  writeRecord: (record: NinaSequenceRecord | null) => Promise<void>;
  cleanupVerified?: (record: NinaSequenceRecord, action: CleanupAction) => Promise<boolean>;
  cleanupCommand?: (record: NinaSequenceRecord, action: CleanupAction) => Promise<void>;
  readCleanupReport?: () => Promise<CleanupReport | null>;
  validate?: (record: NinaSequenceRecord) => Promise<void>;
};
const text = (error: unknown) => error instanceof Error ? error.message : String(error);

export class NinaSequenceRunner {
  private state: NinaRunState = { ready: false, active: false, phase: 'checking', message: 'Checking NINA sequencer...', completedFrames: 0, record: null, lastRecord: null, steps: [], cleanupReport: null, flip: null };
  private listeners = new Set<() => void>();
  private operation: Operation | null = null;
  private initialized = false;
  private startup: Promise<void> | null = null;
  private polling = false;
  private stopping = false;
  private cleaning = false;
  private stoppedRecord: string | null = null;
  private externalOperation: Operation | null = null;
  private revision = 0;
  private gate: OperationGate;
  private api: NinaSequenceAdapter;
  constructor(gate: OperationGate, api: NinaSequenceAdapter) { this.gate = gate; this.api = api; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private update(patch: Partial<NinaRunState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener()); }
  private own() { if (!this.operation) this.operation = this.gate.begin('sequence'); if (!this.operation) throw new Error('Another equipment operation is active.'); }
  resetCompletedView() {
    if (!this.state.active && this.state.ready) this.update({ phase: 'idle', message: 'NINA sequencer ready.', completedFrames: 0, lastRecord: null, steps: [], flip: null });
  }

  private async saveCleanup(record: NinaSequenceRecord) {
    await this.api.writeRecord(record);
    this.update({ record, lastRecord: record, cleanupReport: record.cleanupState ? { ...record.cleanupState, runId: record.id, targetName: record.targetName } : null });
  }

  private async beginCleanup(record: NinaSequenceRecord, outcome: CleanupOutcome, mode: 'native' | 'client') {
    const next = { ...record, cleanupState: { outcome, mode, capturedFrames: this.state.completedFrames, steps: cleanupActions(record, outcome).map((action) => ({ action, status: 'pending' as const, message: 'Awaiting verification' })) } };
    await this.saveCleanup(next);
    await this.cleanupTick(next);
  }

  private async cleanupTick(record: NinaSequenceRecord) {
    if (this.cleaning || !record.cleanupState) return;
    this.cleaning = true;
    try {
      validateCleanupState(record);
      const next = structuredClone(record);
      const cleanup = next.cleanupState!;
      this.update({ phase: 'cleanup', ready: false, active: true, message: 'Verifying end-of-run actions...' });
      const nodes = this.api.nodes(await this.api.read(record.origin));
      if (nodes.some((node) => node.Status === 'RUNNING')) throw new Error('NINA is still running a sequence. Cleanup commands were not sent.');
      if (cleanup.steps.length && !nodes.some((node) => node.Name === `${record.marker}_Container`)) throw new Error('NINA no longer has this run loaded. Cleanup commands were not sent.');
      if (!await this.api.idle(record) && !cleanup.steps.some((step) => step.action === 'park' && step.status === 'running')) {
        this.update({ message: 'Waiting for confirmed idle equipment before cleanup.' }); return;
      }
      for (const step of cleanup.steps) {
        try {
          if (!this.api.cleanupVerified) throw new Error('Cleanup verification is unavailable.');
          if (await this.api.cleanupVerified(next, step.action)) { step.status = 'verified'; step.message = 'Verified from equipment state'; }
          else if (step.status === 'verified') { step.status = 'unknown'; step.message = 'Previously verified state is no longer confirmed'; }
          else if (cleanup.mode === 'client' && step.status === 'pending') {
            if ((step.action === 'park' || step.action === 'tracking') && cleanup.steps.some((other) => other.action === 'guide' && other.status !== 'verified')) { step.message = 'Waiting for guiding to stop'; await this.saveCleanup(structuredClone(next)); continue; }
            if (!this.api.cleanupCommand) throw new Error('Cleanup commands are unavailable.');
            step.status = 'running'; step.startedAt = new Date().toISOString(); step.message = 'Command intent saved; awaiting equipment confirmation';
            await this.saveCleanup(structuredClone(next));
            await this.api.cleanupCommand(next, step.action);
            if (await this.api.cleanupVerified(next, step.action)) { step.status = 'verified'; step.message = 'Verified from equipment state'; }
          } else if (cleanup.mode === 'native') { step.status = 'unknown'; step.message = 'NINA finished the instruction, but equipment state is not confirmed'; }
          else if (step.status === 'running' && Date.now() - Date.parse(step.startedAt!) > (step.action === 'warm' ? ((record.cleanupPolicy?.warmMinutes ?? 5) + 16) * 60000 : 180000)) {
            step.status = 'unknown'; step.message = 'Confirmation timed out; command will not be resent automatically';
          }
        } catch (error) { step.status = 'unknown'; step.message = text(error); }
        await this.saveCleanup(structuredClone(next));
      }
      if (cleanup.steps.every((step) => step.status === 'verified')) {
        await this.api.writeRecord(null);
        if (this.operation) this.gate.finishWork(this.operation);
        this.operation = null;
        this.update({ record: null, ready: true, active: false, phase: cleanup.outcome,
          message: `${cleanup.outcome === 'complete' ? 'NINA sequence complete' : cleanup.outcome === 'failed' ? 'NINA sequence failed' : 'NINA sequence stopped'}; end-of-run actions verified. Frame delivery continues independently.` });
      } else {
        const uncertain = cleanup.steps.some((step) => step.status === 'unknown');
        this.update({ phase: uncertain ? 'error' : 'cleanup', ready: false, active: true, message: uncertain ? 'End-of-run actions need attention. Inspect the results; Retry Cleanup requires confirmation.' : `End-of-run: ${cleanupLabels[cleanup.steps.find((step) => step.status !== 'verified')!.action]}...` });
      }
    } catch (error) { this.update({ phase: 'error', ready: false, active: true, message: `Cleanup not confirmed: ${text(error)}` }); }
    finally { this.cleaning = false; }
  }

  async poll(origin: string) {
    if (this.polling || this.startup || this.stopping || this.cleaning) return;
    this.polling = true;
    const revision = this.revision;
    let failedRun = false;
    try {
      if (!this.initialized) {
        const saved = await this.api.readRecord();
        if (this.api.readCleanupReport) this.update({ cleanupReport: await this.api.readCleanupReport() });
        if (saved != null) {
          const record = saved as NinaSequenceRecord;
          if (record.version !== 1 || typeof record.id !== 'string' || typeof record.origin !== 'string' || typeof record.marker !== 'string' || typeof record.captureMarker !== 'string' || !Number.isInteger(record.frameCount)) throw new Error('Saved NINA run record is invalid.');
          this.own();
          validateCleanupState(record);
          if (record.meridianFlip) validateMeridianFlipProfile(record.meridianFlip);
          this.update({ active: true, record, lastRecord: record, completedFrames: record.cleanupState?.capturedFrames ?? 0, cleanupReport: record.cleanupState ? { ...record.cleanupState, runId: record.id, targetName: record.targetName } : null, phase: 'unknown', message: 'Reconnecting to the saved NINA run...' });
        }
        this.initialized = true;
      }
      const record = this.state.record;
      if (record?.cleanupState) { await this.cleanupTick(record); return; }
      const data = await this.api.read(record?.origin ?? origin);
      if (revision !== this.revision) return;
      const nodes = this.api.nodes(data);
      if (!record) {
        const external = nodes.some((node) => node.Status === 'RUNNING');
        if (external && !this.externalOperation) this.externalOperation = this.gate.begin('sequence');
        if (!external && this.externalOperation) { this.gate.finishWork(this.externalOperation); this.externalOperation = null; }
        const terminal = ['complete', 'aborted', 'failed'].includes(this.state.phase);
        this.update({ ready: !external, active: false, phase: external ? 'unknown' : terminal ? this.state.phase : 'idle', message: external ? 'A sequence is running in NINA. Control it there until it finishes.' : terminal ? this.state.message : 'NINA sequencer ready.' });
        return;
      }
      const result = this.api.inspect(data, record);
      this.update({ flip: result.flip ?? null });
      const steps = result.all.filter((node) => !node.Items).map((node) => ({ name: node.Name, status: node.Status }));
      if (record.stopRequested) { this.update({ phase: 'unknown', message: 'A stop was requested before disconnect. Retry Stop to verify NINA is idle.', ready: false, active: true, completedFrames: result.completed, steps }); return; }
      if (result.failed) {
        this.update({ ready: false, phase: 'error', message: `NINA failed: ${result.failed.Name}. Stopping and verifying equipment.`, completedFrames: result.completed, steps });
        failedRun = Boolean(record.cleanupPolicy);
        return;
      }
      if (!result.running && result.all.every((node) => node.Status === 'FINISHED') && result.completed === record.frameCount) {
        if (record.cleanupPolicy) { this.update({ completedFrames: result.completed, steps }); await this.beginCleanup(record, 'complete', 'native'); return; }
        await this.api.writeRecord(null);
        if (revision !== this.revision) return;
        if (this.operation) this.gate.finishWork(this.operation);
        this.operation = null;
        this.update({ ready: true, active: false, phase: 'complete', message: 'NINA sequence complete. Frame delivery continues independently.', completedFrames: result.completed, steps, record: null });
        return;
      }
      this.update({ ready: false, active: true, phase: result.running ? 'running' : this.state.phase === 'error' ? 'error' : 'unknown', completedFrames: result.completed, steps,
        message: result.running ? `NINA: ${result.running.Name}` : this.state.phase === 'error' ? this.state.message : 'NINA has not confirmed completion. Check NINA or Stop this run.' });
    } catch (error) {
      if (revision !== this.revision) return;
      this.update({ ready: false, phase: 'unknown', message: `NINA sequence status unavailable: ${text(error)}`, active: Boolean(this.state.record) });
    } finally { this.polling = false; if (failedRun) await this.stop('failed'); }
  }

  async start(record: NinaSequenceRecord) {
    if (!this.state.ready || this.state.active || this.startup || this.stopping || this.cleaning || this.gate.current) throw new Error('NINA sequence is not ready to start.');
    this.own();
    ++this.revision;
    this.stoppedRecord = null;
    this.update({ ready: false, active: true, phase: 'loading', message: 'Saving and loading the plan into NINA...', record, lastRecord: record, completedFrames: 0, steps: [], cleanupReport: null, flip: null });
    const work = async () => {
      try {
        // Persist ownership before any remote mutation; never replay load/start after reconnect.
        await this.api.writeRecord(record);
        if (this.stoppedRecord === record.id) return;
        await this.api.validate?.(record);
        const existing = this.api.nodes(await this.api.read(record.origin));
        if (existing.some((node) => node.Status === 'RUNNING')) throw new Error('NINA already has a running sequence.');
        if (this.stoppedRecord === record.id) return;
        await this.api.load(record);
        const loaded = await this.api.read(record.origin);
        this.api.inspect(loaded, record, true);
        await this.api.validate?.(record);
        if (this.stoppedRecord === record.id) return;
        this.update({ phase: 'starting', message: 'Starting the validated NINA sequence...' });
        await this.api.start(record.origin);
        if (this.stoppedRecord !== record.id) this.update({ phase: 'running', message: 'NINA accepted the start request. Waiting for execution status...' });
      } catch (error) {
        if (this.stoppedRecord !== record.id) this.update({ phase: 'error', ready: false, active: true, message: `${text(error)} Stop the run to reconcile NINA's state.` });
      }
    };
    this.startup = work();
    await this.startup;
    this.startup = null;
    await this.poll(record.origin);
  }

  async stop(outcome: CleanupOutcome = 'aborted') {
    // Let a completion/cleanup observation settle before taking over its record and gate.
    while (this.polling || this.cleaning) await new Promise((resolve) => setTimeout(resolve, 25));
    const record = this.state.record;
    if (!record || !this.operation || this.stopping || this.cleaning || !this.gate.requestStop(this.operation)) return;
    this.stopping = true;
    ++this.revision;
    this.stoppedRecord = record.id;
    const operation = this.operation;
    this.update({ phase: 'stopping', ready: false, active: true, message: 'Stopping NINA sequence and verifying idle equipment...' });
    let confirmed = false;
    try {
      outcome = record.stopOutcome ?? outcome;
      this.update({ record: { ...record, stopRequested: true, stopOutcome: outcome } });
      try { await this.api.writeRecord({ ...record, stopRequested: true, stopOutcome: outcome }); } catch { /* Stopping equipment must remain possible when local storage fails. */ }
      await this.startup;
      const current = await this.api.read(record.origin);
      const nodes = this.api.nodes(current);
      const owned = nodes.some((node) => node.Name === `${record.marker}_Container`);
      if (!owned && nodes.some((node) => node.Status === 'RUNNING')) throw new Error('A different sequence is running in NINA. It was not stopped.');
      if (owned) await this.api.stop(record);
      let stable = 0;
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        const status = this.api.nodes(await this.api.read(record.origin));
        const idle = !status.some((node) => node.Status === 'RUNNING') && await this.api.idle(record);
        stable = idle ? stable + 1 : 0;
        if (stable >= 2) { confirmed = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!confirmed) throw new Error('NINA stop is not yet confirmed. Check the equipment and retry Stop.');
      if (record.cleanupPolicy) {
        if (record.cleanupState) {
          const retry = structuredClone(record);
          retry.cleanupState!.mode = 'client';
          retry.cleanupState!.steps.forEach((step) => { if (step.status === 'unknown') { step.status = 'pending'; step.message = 'Explicit retry requested'; } });
          await this.saveCleanup(retry); await this.cleanupTick(retry);
        } else await this.beginCleanup({ ...record, stopRequested: true, stopOutcome: outcome }, outcome, 'client');
        return;
      }
      await this.api.writeRecord(null);
      this.gate.finishWork(operation);
      this.operation = null;
      this.update({ ready: true, active: false, phase: 'aborted', message: 'NINA sequence stopped; equipment is idle.', record: null });
    } catch (error) {
      confirmed = false;
      this.update({ ready: false, active: true, phase: 'error', message: text(error) });
    } finally { this.gate.finishStop(operation, confirmed); this.stopping = false; }
  }
}
