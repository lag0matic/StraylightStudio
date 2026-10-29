// Hardware-free integration checks. Supply an installed Playwright module via
// PLAYWRIGHT_MODULE if it is not available in the normal Node module search path.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
const envelope = (Response, Success = true) => ({ Response, Success, Error: Success ? '' : 'Simulated failure', StatusCode: Success ? 200 : 500, Type: 'API' });

try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (error) => { errors.push(error.message); console.error(error.stack); });
  page.on('dialog', (dialog) => dialog.accept());
  const equipment = {
    Camera: { Connected: true, IsExposing: false, CameraState: 'Idle', Gain: 200 },
    Mount: { Connected: true, AtPark: true, TrackingEnabled: true, Slewing: false },
    Focuser: { Connected: true, IsMoving: false }, Guider: { Connected: true }
  };
  const commands = [];
  const acknowledgements = [];
  const pending = [];
  const contents = new Map();
  let releaseCapture;
  let releaseUnpark;
  let releaseSlew;
  let releaseStop;
  let holdStop = false;
  let failStop = false;
  let dropCaptureResponse = false;
  const addFrame = (id) => {
    const bytes = Buffer.from(`mock FITS bytes ${id}`);
    contents.set(id, bytes);
    pending.push({ id, targetName: 'M31', imageType: 'LIGHT', frameNumber: pending.length + 1, fileName: `${id}.fits`, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), createdAt: '2026-09-27T22:00:00Z', status: 'pending' });
  };

  await page.addInitScript(() => {
    const plan = { imageType: 'Light', exposureSeconds: 1, frameCount: 3, gain: 200, offset: 8, temperatureC: -10, autofocusBeforeRun: false, guidingRequired: false, dither: false };
    const target = { name: 'M31', raDegrees: 10.68, decDegrees: 41.27, rotationDegrees: 0 };
    const settings = {
      'astro-demo-mode': false,
      'storage-session-root': '/mock/astro',
      'straylight-app-settings-v1': { agentBase: 'http://agent.test', autoTransferEnabled: true, autoLoadLatestFrame: false, autoRenderFitsOnArrival: false, previewRenderSize: 'fast' },
      'astro-planner-state-v1': { activeTab: 'acquisition', target, sequencePlan: plan, activeQueueId: 'test-target', queue: [{ id: 'test-target', target, plan }] }
    };
    for (const [key, value] of Object.entries(settings)) localStorage.setItem(key, typeof value === 'boolean' ? String(value) : JSON.stringify(value));
    window.isTauri = true;
    window.mockWrites = [];
    const sockets = new Map();
    window.__TAURI_INTERNALS__ = { transformCallback: () => 1, unregisterCallback: () => {}, invoke: async (command, args) => {
      if (command === 'network_http') {
        const request = args.request;
        const url = new URL(request.url);
        const target = url.hostname === 'starrunner.local' && url.port === '1888' ? `${location.origin}/nina-api/${url.pathname.replace('/v2/api/', '')}${url.search}` : request.url;
        const response = await fetch(target, { method: request.method, body: request.body || undefined });
        const bytes = new Uint8Array(await response.arrayBuffer());
        return { status: response.status, content_type: response.headers.get('content-type'), body_base64: btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')) };
      }
      if (command === 'network_socket') {
        return new Promise((resolve) => {
          sockets.set(args.id, { events: args.events, resolve });
          setTimeout(() => args.events.onmessage({ kind: 'open' }), 0);
        });
      }
      if (command === 'network_socket_send') {
        if (args.data === null) { sockets.get(args.id)?.resolve(); sockets.delete(args.id); }
        return;
      }
      if (command === 'load_settings') return settings;
      if (command === 'save_settings') return;
      if (command === 'get_default_session_root') return '/mock/astro';
      if (command === 'get_storage_status') return { session_root: '/mock/astro', writable: true };
      if (command === 'find_existing_frame') return { found: false };
      if (command === 'prepare_session_folder') return '/mock/astro/session';
      if (command === 'write_frame') {
        if (window.failWrite) throw new Error('Simulated disk write failure');
        const request = args.request;
        const bytes = Uint8Array.from(atob(request.data_base64), (character) => character.charCodeAt(0));
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
        if (request.expected_sha256 !== sha256 || request.expected_size_bytes !== bytes.length) {
          throw new Error('Incorrect expected image checksum/size passed to storage');
        }
        window.mockWrites.push(request.file_name);
        return { frame: { ...request, path: `/mock/astro/${request.file_name}`, size_bytes: bytes.length, sha256: window.corruptWriteResult ? 'wrong-checksum' : sha256 } };
      }
      throw new Error(`Unexpected desktop command: ${command}`);
    } };
    // No WebSocket, including Vite HMR, can reach any remote equipment in this test.
    window.WebSocket = class extends EventTarget {
      static OPEN = 1;
      readyState = 1;
      constructor() { super(); setTimeout(() => this.dispatchEvent(new Event('open')), 0); }
      send() {}
      close() { this.readyState = 3; }
    };
  });

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const json = (value) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
    if (url.hostname === 'agent.test') {
      if (url.pathname === '/health') return json({ status: 'ready', pendingFrames: pending.length, deliveredFrames: acknowledgements.length });
      if (url.pathname === '/frames/pending') return json([...pending]);
      if (url.pathname === '/frames/failed') return json([]);
      if (url.pathname === '/phd2/status') return json({ connected: true, appState: 'Stopped', samples: [] });
      const [, , id, action] = url.pathname.split('/');
      if (action === 'ack') {
        assert.equal(JSON.parse(route.request().postData()).sha256, pending.find((frame) => frame.id === id).sha256);
        acknowledgements.push(id);
        pending.splice(pending.findIndex((frame) => frame.id === id), 1);
        return json({ status: 'delivered' });
      }
      if (contents.has(id)) return route.fulfill({ contentType: 'application/octet-stream', body: contents.get(id) });
      return route.abort();
    }
    if (url.origin === origin && url.pathname.startsWith('/nina-api/')) {
      const path = url.pathname.replace('/nina-api/', '');
      if (path === 'equipment/info') return json(envelope(equipment));
      if (path === 'equipment/mount/info') return json(envelope(equipment.Mount));
      if (path === 'equipment/camera/info') return json(envelope(equipment.Camera));
      if (path.startsWith('version')) return json(envelope('test'));
      if (path === 'equipment/focuser/last-af') return json(envelope('No AF'));
      commands.push(path);
      if (path === 'equipment/camera/capture') {
        if (dropCaptureResponse) return route.abort('connectionreset');
        await new Promise((resolve) => { releaseCapture = resolve; });
        return json(envelope('Saved'));
      }
      if (path === 'equipment/mount/unpark') {
        await new Promise((resolve) => { releaseUnpark = resolve; });
        equipment.Mount.AtPark = false;
        return json(envelope('Unparked'));
      }
      if (path === 'equipment/mount/slew') {
        await new Promise((resolve) => { releaseSlew = resolve; });
        return json(envelope('Centered'));
      }
      if (path.endsWith('/stop') || path.endsWith('/abort-exposure')) {
        if (failStop) return json(envelope('Stop failed', false));
        if (holdStop) await new Promise((resolve) => { releaseStop = resolve; });
      }
      return json(envelope('OK'));
    }
    if (url.origin === origin) return route.continue();
    return route.abort();
  });

  addFrame('first');
  await page.goto(origin);
  await waitFor(() => acknowledgements.length === 1, 'auto-transfer while Acquisition is open');
  const tab = (name) => page.getByRole('navigation', { name: 'Workflow' }).getByRole('button', { name, exact: true });
  await tab('Targeting').click();
  addFrame('second');
  await waitFor(() => acknowledgements.length === 2, 'auto-transfer while Targeting is open');
  assert.deepEqual(await page.evaluate(() => window.mockWrites), ['first.fits', 'second.fits']);
  console.log('PASS transfer continues across tabs without opening Settings');

  await tab('Acquisition').click();
  await page.getByRole('button', { name: 'Start Run', exact: true }).click();
  await waitFor(() => Boolean(releaseCapture), 'capture started');
  await tab('Settings').click();
  await tab('Acquisition').click();
  holdStop = true;
  await page.getByRole('button', { name: 'Abort Run', exact: true }).click();
  await waitFor(() => Boolean(releaseStop), 'abort requested');
  releaseCapture();
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('button', { name: 'Prepare Target', exact: true }).isDisabled(), true);
  assert.equal(commands.filter((path) => path === 'equipment/camera/capture').length, 1);
  releaseStop();
  holdStop = false;
  await page.getByText('Capture run aborted.', { exact: true }).first().waitFor();
  console.log('PASS capture survives navigation; late abort response blocks overlapping work');

  await page.getByRole('button', { name: 'Prepare Target', exact: true }).click();
  await waitFor(() => Boolean(releaseUnpark), 'unpark started');
  await tab('Setup').click();
  await tab('Acquisition').click();
  await page.getByRole('button', { name: 'Stop Prepare', exact: true }).click();
  releaseUnpark();
  await page.getByText('Target preparation stopped.', { exact: true }).first().waitFor();
  assert.equal(commands.filter((path) => path === 'equipment/mount/tracking').length, 0);
  assert.equal(commands.filter((path) => path === 'equipment/mount/slew').length, 0);
  console.log('PASS stop during unpark prevents subsequent tracking and slew');

  await page.getByRole('button', { name: 'Prepare Target', exact: true }).click();
  await waitFor(() => Boolean(releaseSlew), 'slew started');
  failStop = true;
  await page.getByRole('button', { name: 'Stop Prepare', exact: true }).click();
  await page.getByText('Simulated failure', { exact: true }).first().waitFor();
  releaseSlew();
  assert.equal(await page.getByRole('button', { name: 'Start Run', exact: true }).isDisabled(), true);
  failStop = false;
  await page.getByRole('button', { name: 'Stop Prepare', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare Target', exact: true }).waitFor();
  console.log('PASS failed stop stays locked until a successful retry and idle readback');

  releaseCapture = null;
  await page.getByRole('button', { name: 'Start Run', exact: true }).click();
  await waitFor(() => Boolean(releaseCapture), 'second capture started');
  failStop = true;
  await page.getByRole('button', { name: 'Abort Run', exact: true }).click();
  await page.locator('.run-main').getByText('Simulated failure', { exact: true }).waitFor();
  releaseCapture();
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('button', { name: 'Abort Run', exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Prepare Target', exact: true }).isDisabled(), true);
  failStop = false;
  await page.getByRole('button', { name: 'Abort Run', exact: true }).click();
  await page.getByRole('button', { name: 'Start Run', exact: true }).waitFor();
  console.log('PASS late capture completion preserves a failed abort and allows retry');

  dropCaptureResponse = true;
  await page.getByRole('button', { name: 'Start Run', exact: true }).click();
  await page.locator('.run-main').getByText(/Use Abort Run to verify/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Prepare Target', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Abort Run', exact: true }).click();
  await page.getByRole('button', { name: 'Start Run', exact: true }).waitFor();
  dropCaptureResponse = false;
  console.log('PASS dropped capture response requires stop and idle verification');

  await tab('Settings').click();
  const automaticTransfer = page.getByRole('checkbox', { name: /Auto-transfer new frames/ });
  await automaticTransfer.uncheck();
  addFrame('third');
  await page.waitForTimeout(5500);
  assert.equal(acknowledgements.length, 2);
  await automaticTransfer.check();
  await waitFor(() => acknowledgements.length === 3, 'transfer after re-enabling');
  await tab('Acquisition').click();
  console.log('PASS automatic transfer respects the setting');

  await tab('Settings').click();
  await automaticTransfer.uncheck();
  addFrame('write-failure');
  await page.getByRole('button', { name: 'Check Agent', exact: true }).click();
  await page.evaluate(() => { window.failWrite = true; });
  await page.getByRole('button', { name: 'Transfer One', exact: true }).click();
  await page.getByText('Simulated disk write failure', { exact: true }).waitFor();
  assert.equal(acknowledgements.length, 3);
  assert.equal(pending.length, 1);
  await page.evaluate(() => { window.failWrite = false; window.corruptWriteResult = true; });
  await page.getByRole('button', { name: 'Transfer One', exact: true }).click();
  await page.getByText('Written frame checksum did not match the agent checksum.', { exact: true }).waitFor();
  assert.equal(acknowledgements.length, 3);
  await page.evaluate(() => { window.corruptWriteResult = false; });
  await page.getByRole('button', { name: 'Transfer One', exact: true }).click();
  await waitFor(() => acknowledgements.length === 4, 'acknowledgement after verified retry');
  await automaticTransfer.check();
  await tab('Acquisition').click();
  console.log('PASS write errors and invalid readback results prevent acknowledgement; verified retry succeeds');

  const beforeDemo = commands.length;
  await page.getByRole('button', { name: /Demo Data/i }).click();
  await page.getByRole('button', { name: 'Start Run', exact: true }).click();
  await page.getByText('Demo capture run complete. No files saved.', { exact: true }).first().waitFor();
  addFrame('paused-in-demo');
  await page.waitForTimeout(5500);
  assert.equal(acknowledgements.length, 4);
  assert.equal(commands.length, beforeDemo);
  console.log('PASS demo capture does not send hardware commands');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'ui-offline-workflows.png', fullPage: true });
} finally {
  await browser?.close();
  await server.close();
}
