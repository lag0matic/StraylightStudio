// Windows packaged-WebView check; uses a separate app identity and localhost fixtures only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.platform, 'win32', 'This packaged WebView2 check requires Windows');
const root = fileURLToPath(new URL('../', import.meta.url));
const playwrightUrl = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(playwrightUrl);
const require = createRequire(playwrightUrl.startsWith('file:') ? playwrightUrl : import.meta.url);
const { wsServer: WebSocketServer } = require(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/utilsBundle.js'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(test, label, ms = 20000) {
  const deadline = Date.now() + ms;
  while (!(await test())) { assert.ok(Date.now() < deadline, `Timed out: ${label}`); await sleep(100); }
}
function build(config) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'build', '--debug', '--no-bundle', ...(config ? ['--config', config] : [])], { cwd: root, windowsHide: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Desktop build failed: ${code}`)));
  });
}
const equipment = {
  Camera: { Connected: true, IsExposing: false, CameraState: 'Idle', Gain: 200 },
  Mount: { Connected: true, AtPark: true, TrackingEnabled: false, Slewing: false },
  Focuser: { Connected: true, IsMoving: false }, Guider: { Connected: true }
};
const envelope = (Response) => ({ Response, Success: true, Error: '', StatusCode: 200, Type: 'API' });
const requests = [];
const hosts = [];
const sockets = [];
const messages = [];
const server = createServer((req, res) => {
  requests.push(req.url);
  hosts.push(req.headers.host);
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/binary') { res.end(Buffer.from([0, 1, 254, 255])); return; }
  if (pathname === '/redirect') { res.writeHead(302, { Location: '/must-not-follow' }); res.end(); return; }
  if (pathname === '/slow') { setTimeout(() => res.end('{}'), 500); return; }
  let value = envelope('test');
  if (pathname.endsWith('/equipment/info')) value = envelope(equipment);
  if (pathname.endsWith('/equipment/camera/info')) value = envelope(equipment.Camera);
  if (pathname.endsWith('/equipment/mount/info')) value = envelope(equipment.Mount);
  if (pathname.endsWith('/equipment/focuser/info')) value = envelope(equipment.Focuser);
  if (pathname.endsWith('/equipment/guider/info')) value = envelope(equipment.Guider);
  if (pathname === '/health') value = { status: 'ready', pendingFrames: 0, deliveredFrames: 0 };
  if (pathname.startsWith('/frames/')) value = [];
  if (pathname === '/phd2/status') value = { connected: true, appState: 'Stopped', samples: [] };
  if (pathname === '/api/objects/info') value = { name: 'Offline M31', ra: 10.68, dec: 41.27, type: 'Galaxy' };
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(value));
});
const ws = new WebSocketServer({ server });
ws.on('connection', (socket, req) => {
  sockets.push(req.url);
  socket.on('message', (data) => { messages.push(String(data)); socket.send(JSON.stringify({ Response: 'offline reply' })); });
  socket.send(JSON.stringify({ Response: { Event: 'CONNECTION-ESTABLISHED' } }));
});
let app, browser;
const errors = [];
const output = path.join(root, 'tmp', 'standalone-network');
try {
  await build('tools/standalone-test.conf.json');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const debugPortServer = createServer();
  await new Promise((resolve) => debugPortServer.listen(0, '127.0.0.1', resolve));
  const debugPort = debugPortServer.address().port;
  await new Promise((resolve) => debugPortServer.close(resolve));
  const configDir = path.join(process.env.APPDATA, 'com.straylightastro.networktest');
  await mkdir(configDir, { recursive: true });
  await mkdir(output, { recursive: true });
  await writeFile(path.join(configDir, 'settings.json'), JSON.stringify({
    'astro-demo-mode': false,
    'straylight-app-settings-v1': { ninaOrigin: origin, stellariumOrigin: origin, agentBase: origin, autoTransferEnabled: false, autoLoadLatestFrame: false, autoRenderFitsOnArrival: false, previewRenderSize: 'fast' },
    'astro-planner-state-v1': { activeTab: 'settings' }
  }));
  app = spawn(path.join(root, 'src-tauri/target/debug/straylight-studio.exe'), [], {
    cwd: root, windowsHide: true, env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`, WEBVIEW2_USER_DATA_FOLDER: path.join(output, 'webview') }
  });
  app.on('error', (error) => errors.push(error.message));
  const debugOrigin = `http://127.0.0.1:${debugPort}`;
  await until(async () => { try { return (await fetch(`${debugOrigin}/json/version`)).ok; } catch { return false; } }, 'WebView debugger', 30000);
  browser = await chromium.connectOverCDP(debugOrigin);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.waitForEvent('page');
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.waitForURL('**tauri.localhost/**');
  assert.ok(!page.url().includes('5174'));
  await until(() => requests.includes('/v2/api/equipment/info') && requests.includes('/phd2/status'), 'native status and guiding requests');
  await page.getByLabel('NINA address', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('NINA address', { exact: true }).inputValue(), origin);
  console.log('PASS bundled desktop interface, saved addresses, NINA and guiding HTTP without Vite');

  const http = (pathname, timeout_ms = 2000) => page.evaluate(({ url, timeout_ms }) => window.__TAURI_INTERNALS__.invoke('network_http', { request: { url, method: 'GET', body: null, timeout_ms } }), { url: `${origin}${pathname}`, timeout_ms });
  assert.equal((await http('/binary')).body_base64, Buffer.from([0, 1, 254, 255]).toString('base64'));
  assert.equal((await http('/redirect')).status, 302);
  assert.ok(!requests.includes('/must-not-follow'));
  await assert.rejects(() => http('/slow', 100), /Timed out/);
  console.log('PASS native binary responses, no command redirects, and timeout errors');

  await page.getByRole('button', { name: 'Targeting', exact: true }).click();
  await page.getByRole('button', { name: 'Import From Stellarium', exact: true }).click();
  await until(() => requests.includes('/api/objects/info?format=map'), 'Stellarium import');
  await page.getByText('Imported Offline M31 from Stellarium.', { exact: true }).waitFor();
  console.log('PASS Stellarium target import through native HTTP');

  await until(() => sockets.includes('/v2/socket'), 'native event monitoring');
  const before = sockets.filter((url) => url === '/v2/socket').length;
  for (const socket of ws.clients) socket.terminate();
  await until(() => sockets.filter((url) => url === '/v2/socket').length > before, 'monitor reconnect');
  assert.equal(messages.length, 0, 'Reconnection must not replay commands');
  console.log('PASS event socket reconnect without command replay');

  // Exercise the real Tauri Channel wire format and a bidirectional TPPA socket.
  const replies = await page.evaluate(async (origin) => {
    const api = window.__TAURI_INTERNALS__;
    const id = crypto.randomUUID();
    const events = [];
    const callback = api.transformCallback(({ message }) => {
      if (!message) return;
      events.push(message);
      if (message.kind === 'open') void api.invoke('network_socket_send', { id, data: 'offline-test' });
      if (message.kind === 'message' && message.data.includes('offline reply')) void api.invoke('network_socket_send', { id, data: null });
    });
    let timer;
    try {
      await Promise.race([
        api.invoke('network_socket', { id, url: origin.replace('http:', 'ws:') + '/v2/tppa', events: `__CHANNEL__:${callback}` }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('TPPA test timed out')), 15000); })
      ]);
    } finally {
      clearTimeout(timer);
      await api.invoke('network_socket_send', { id, data: null });
      api.unregisterCallback(callback);
    }
    return events;
  }, origin);
  assert.ok(replies.some((event) => event.kind === 'message' && event.data.includes('offline reply')));
  assert.deepEqual(messages, ['offline-test']);
  console.log('PASS TPPA native channel send, receive, and close');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('NINA address', { exact: true }).fill(`${origin}/wrong-path`);
  await page.getByRole('button', { name: 'Save Connections', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'without a path' }).waitFor();
  const changedOrigin = origin.replace('127.0.0.1', 'localhost');
  await page.getByLabel('NINA address', { exact: true }).fill(changedOrigin);
  await page.getByRole('button', { name: 'Save Connections', exact: true }).click();
  await until(() => hosts.includes(new URL(changedOrigin).host), 'HTTP switches to saved address');
  await until(async () => JSON.parse(await readFile(path.join(configDir, 'settings.json'), 'utf8'))['straylight-app-settings-v1'].ninaOrigin === changedOrigin, 'saved connection settings');
  await page.reload();
  await page.getByLabel('NINA address', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('NINA address', { exact: true }).inputValue(), changedOrigin);
  for (const width of [1920, 3440]) {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 1440 });
    await page.screenshot({ path: path.join(output, `settings-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No page-wide horizontal overflow');
  }
  assert.deepEqual(errors, []);
  console.log('PASS connection validation, persistence, and desktop/ultrawide layouts');

  const fitsPath = path.join(output, 'analysis-fixture.fits');
  const cards = ['SIMPLE  =                    T', 'BITPIX  =                   16', 'NAXIS   =                    2', 'NAXIS1  =                  512', 'NAXIS2  =                  256', 'BZERO   =                32768', 'BSCALE  =                    1', 'EXPTIME =                 60.0', 'CCD-TEMP=                -15.0', 'GAIN    =                  200', "IMAGETYP= 'DARK'", 'END'];
  const fits = Buffer.alloc(2880 + 512 * 256 * 2);
  fits.fill(32, 0, 2880);
  cards.forEach((card, index) => fits.write(card.padEnd(80), index * 80, 'ascii'));
  for (let i = 0; i < 512 * 256; i++) fits.writeInt16BE((i % 4096) - 32768, 2880 + i * 2);
  await writeFile(fitsPath, fits);
  const renders = await page.evaluate(async (path) => {
    const request = { path, max_size: 128, auto_stretch: false, black_point: 0, white_point: 4095, midtone: 1 };
    const first = await window.__TAURI_INTERNALS__.invoke('render_selected_fits_preview', { request });
    const second = await window.__TAURI_INTERNALS__.invoke('render_selected_fits_preview', { request: { ...request, black_point: 500, midtone: 2 } });
    return { first: first.analysis, second: second.analysis, changed: first.data_url !== second.data_url, width: first.width };
  }, fitsPath);
  assert.ok(Math.abs(renders.first.mean - 2047.5) < 1e-8);
  assert.equal(renders.first.median, 2047.5);
  assert.equal(renders.first.valid_samples, 512 * 256);
  assert.equal(renders.width, 128);
  assert.deepEqual(renders.first, renders.second);
  assert.ok(renders.changed);
  // Seed the test profile's transfer history; rendering still uses native Rust.
  await page.evaluate(async ({ path, root, size }) => {
    await window.__TAURI_INTERNALS__.invoke('save_settings', { settings: { 'storage-session-root': root } });
    localStorage.setItem('astro-transfer-history-v1', JSON.stringify({ items: [{
      id: 'analysis-fixture', destinationPath: path, fileName: 'analysis-fixture.fits', sizeBytes: size,
      targetName: 'Test', imageType: 'Dark', sourceKind: 'test', transferredAt: new Date().toISOString(), sha256: ''
    }] }));
  }, { path: fitsPath, root: output, size: fits.length });
  await page.getByRole('button', { name: 'Acquisition', exact: true }).click();
  await page.getByRole('button', { name: 'Reload Latest', exact: true }).click();
  await page.getByRole('figure', { name: 'Loaded FITS histogram' }).waitFor();
  assert.equal(await page.locator('.fits-histogram rect').count(), 256);
  assert.ok(await page.locator('.fits-histogram rect').evaluateAll((bars) => bars.some((bar) => Number(bar.getAttribute('height')) > 0)));
  await page.getByLabel('Log counts', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Frame Stats', exact: true }).click();
  await page.getByText('Loaded FITS, full-resolution raw samples', { exact: true }).waitFor();
  for (const width of [1920, 3440]) {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 1440 });
    await page.screenshot({ path: path.join(output, `fits-analysis-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  assert.equal(await page.getByRole('figure', { name: 'Loaded FITS histogram' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS full-resolution FITS statistics, cached stretch invariance, histogram, and clear');

  const reviewRoot = path.join(output, `review-fixtures-${Date.now()}`);
  await mkdir(reviewRoot);
  for (let i = 1; i <= 12; i++) await writeFile(path.join(reviewRoot, `${i}.fits`), fits);
  await writeFile(path.join(reviewRoot, '13-broken.fit'), 'bad header');
  await page.evaluate(async (root) => {
    await window.__TAURI_INTERNALS__.invoke('save_settings', { settings: { 'straylight-review-folder-v1': { root } } });
  }, reviewRoot);
  await page.reload();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Reopen Folder', exact: true }).click();
  const review = page.getByRole('region', { name: 'Session review' });
  await review.locator('.review-image img').waitFor();
  await until(() => review.locator('.review-thumb img').count().then((count) => count === 10), 'visible review thumbnails');
  assert.equal(await review.locator('.review-file-title').innerText(), '1.fits');
  assert.ok((await review.locator('.review-frame').first().innerText()).includes('DARK | 60.0 s | -15.0 C | Gain 200'));
  await review.getByLabel('Review sort order').selectOption('exposure');
  await review.getByRole('button', { name: 'Keep', exact: true }).click();
  await review.getByRole('status').filter({ hasText: 'Saved keep: 1.fits' }).waitFor();
  await review.getByRole('button', { name: 'Next review frame', exact: true }).click();
  assert.equal(await review.locator('.review-file-title').innerText(), '2.fits');
  await review.getByRole('button', { name: 'Reject', exact: true }).click();
  await review.getByRole('status').filter({ hasText: 'Saved reject: 2.fits' }).waitFor();
  await review.getByLabel('Review decision filter').selectOption('reject');
  assert.equal(await review.locator('.review-frame').count(), 1);
  assert.equal(await review.locator('.review-file-title').innerText(), '2.fits');
  await review.getByRole('button', { name: 'Refresh review folder' }).click();
  await review.locator('.review-image img').waitFor();
  assert.equal(await review.getByRole('button', { name: 'Keep', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.reload();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Reopen Folder', exact: true }).click();
  await review.locator('.review-image img').waitFor();
  assert.equal(await review.getByRole('button', { name: 'Keep', exact: true }).getAttribute('aria-pressed'), 'true');
  for (const width of [1280, 1920, 3440]) {
    await page.setViewportSize({ width, height: width === 3440 ? 1440 : 1080 });
    await page.screenshot({ path: path.join(output, `review-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await review.getByRole('button', { name: 'Next frame page', exact: true }).click();
  await review.getByRole('button', { name: /13-broken.fit/ }).click();
  await review.locator('.review-image').filter({ hasText: 'Incomplete FITS header' }).waitFor();
  await review.getByRole('button', { name: 'Reject', exact: true }).click();
  await review.getByRole('status').filter({ hasText: 'Saved reject: 13-broken.fit' }).waitFor();
  const decisions = JSON.parse(await readFile(path.join(reviewRoot, '.straylight-review.json'), 'utf8'));
  assert.equal(decisions.frames['1.fits'].decision, 'keep');
  assert.equal(decisions.frames['2.fits'].decision, 'reject');
  assert.deepEqual(await readFile(path.join(reviewRoot, '1.fits')), fits);
  assert.deepEqual(await readFile(path.join(reviewRoot, '2.fits')), fits);
  assert.deepEqual(errors, []);
  console.log('PASS session review thumbnails, decisions, filter, pagination, refresh, restart, and corrupt frame isolation');
  if (process.env.STRAYLIGHT_REVIEW_SHARE) {
    // Read-only verification against an explicitly supplied network folder.
    const share = await page.evaluate(async (root) => {
      const api = window.__TAURI_INTERNALS__;
      const result = await api.invoke('review_open', { root });
      if (result.frames.some((frame) => /^[\\/]/.test(frame.relative_path))) throw new Error('Scan returned a rooted frame path');
      const frame = result.frames.find((item) => !item.error);
      if (!frame) throw new Error('No readable FITS frame on the supplied share');
      const args = { root: result.root, relative: frame.relative_path, expected: frame.fingerprint };
      const thumbnail = await api.invoke('review_preview', { ...args, thumbnail: true });
      const preview = await api.invoke('review_preview', { ...args, thumbnail: false });
      return { frames: result.frames.length, thumbnail: thumbnail.width, width: preview.analysis?.width, height: preview.analysis?.height, samples: preview.analysis?.valid_samples };
    }, process.env.STRAYLIGHT_REVIEW_SHARE);
    assert.ok(share.frames > 0 && share.thumbnail > 0 && share.samples > 0);
    console.log(`PASS read-only network-share scan and rendering: ${share.frames} frames, ${share.width} x ${share.height}, ${share.samples} analyzed samples`);
  }
} finally {
  if (app && app.exitCode === null) {
    const exited = new Promise((resolve) => app.once('exit', resolve));
    app.kill();
    await exited;
  }
  await browser?.close().catch(() => {});
  for (const socket of ws.clients) socket.terminate();
  ws.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  // Do not leave the normal development executable with a test app identity.
  await build();
}
