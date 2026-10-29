import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationGate } from '../src/operationGate.ts';

test('only one equipment operation can own the gate', () => {
  const gate = new OperationGate();
  const operation = gate.begin('capture');
  assert.equal(gate.begin('prepare'), null);
  gate.finishWork(operation);
  assert.ok(gate.begin('prepare'));
});

test('a successful stop reply cannot unlock an outstanding command', () => {
  const gate = new OperationGate();
  const operation = gate.begin('prepare');
  assert.equal(gate.requestStop(operation), true);
  gate.finishStop(operation, true);
  assert.equal(gate.begin('capture'), null);
  gate.finishWork(operation);
  assert.equal(gate.current, null);
});

test('a late stop reply keeps the lock after work finishes', async () => {
  const gate = new OperationGate();
  const operation = gate.begin('capture');
  gate.requestStop(operation);
  gate.finishWork(operation);
  await operation.settled;
  assert.equal(gate.begin('preview'), null);
  gate.finishStop(operation, true);
  assert.equal(gate.current, null);
});

test('failed or unverified stops remain locked and can be retried', () => {
  const gate = new OperationGate();
  const operation = gate.begin('prepare');
  gate.requestStop(operation);
  gate.finishStop(operation, false);
  gate.finishWork(operation);
  assert.equal(gate.begin('capture'), null);
  assert.equal(gate.requestStop(operation), true);
  gate.finishStop(operation, true);
  assert.equal(gate.current, null);
});

test('repeated stop clicks do not send overlapping stop requests', () => {
  const gate = new OperationGate();
  const operation = gate.begin('preview');
  assert.equal(gate.requestStop(operation), true);
  assert.equal(gate.requestStop(operation), false);
});

test('late callbacks from a previous operation cannot unlock a new one', () => {
  const gate = new OperationGate();
  const old = gate.begin('prepare');
  gate.requestStop(old);
  gate.finishWork(old);
  gate.finishStop(old, true);
  const next = gate.begin('capture');
  gate.finishWork(old);
  gate.finishStop(old, true);
  assert.equal(gate.requestStop(old), false);
  assert.equal(gate.current, next);
  assert.equal(next.cancelled, false);
});

test('subscribers see lock acquisition and release', () => {
  const gate = new OperationGate();
  const states = [];
  const unsubscribe = gate.subscribe(() => states.push(gate.getSnapshot()));
  const operation = gate.begin('capture');
  gate.requestStop(operation);
  gate.finishWork(operation);
  assert.deepEqual(states, ['capture']);
  gate.finishStop(operation, true);
  unsubscribe();
  assert.deepEqual(states, ['capture', null]);
});

test('a lost command response requires stop verification before another run', () => {
  const gate = new OperationGate();
  const operation = gate.begin('capture');
  gate.requireStop(operation);
  gate.finishWork(operation);
  assert.equal(gate.begin('prepare'), null);
  gate.requestStop(operation);
  gate.finishStop(operation, true);
  assert.ok(gate.begin('prepare'));
});
