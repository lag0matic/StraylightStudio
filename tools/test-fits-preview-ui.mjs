// Hardware-free preview regression checks; uses an existing Playwright installation.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.addInitScript(() => {
    const settings = {
      'astro-demo-mode': false,
      'storage-session-root': '/mock/storage',
      'straylight-app-settings-v1': { ninaOrigin: 'http://fixture.test:1888', stellariumOrigin: 'http://fixture.test:8090', agentBase: 'http://fixture.test:4787', autoTransferEnabled: false },
      'astro-planner-state-v1': { activeTab: 'acquisition', target: null, queue: [] },
    };
    window.previewSelections = [];
    window.previewRenders = [];
    window.isTauri = true;
    const sockets = new Map();
    window.__TAURI_INTERNALS__ = { transformCallback: () => 1, unregisterCallback: () => {}, invoke: async (command, args) => {
      if (command === 'load_settings') return settings;
      if (command === 'save_settings') return;
      if (command === 'get_default_session_root') return '/mock/storage';
      if (command === 'get_storage_status') return { mode: 'configured', session_root: '/mock/storage', writable: true };
      if (command === 'plugin:dialog|open') return window.previewSelections.shift() ?? null;
      if (command === 'network_http') {
        const pathname = new URL(args.request.url).pathname;
        let value = { Response: [], Success: true, Error: '', StatusCode: 200, Type: 'API' };
        if (pathname.endsWith('/equipment/info')) value.Response = { Camera: { Connected: false }, Mount: { Connected: false }, Focuser: { Connected: false }, Guider: { Connected: false } };
        if (pathname.endsWith('/version') || pathname.endsWith('/version/nina')) value.Response = 'offline';
        if (pathname === '/health') value = { status: 'ready', pendingFrames: 0, deliveredFrames: 0 };
        if (pathname.startsWith('/frames/')) value = [];
        if (pathname === '/phd2/status') value = { connected: false, appState: 'Disconnected', samples: [] };
        return { status: 200, content_type: 'application/json', body_base64: btoa(JSON.stringify(value)) };
      }
      if (command === 'network_socket') return new Promise((resolve) => { sockets.set(args.id, resolve); });
      if (command === 'network_socket_send') { if (args.data === null) { sockets.get(args.id)?.(); sockets.delete(args.id); } return; }
      if (command === 'render_fits_preview' || command === 'render_selected_fits_preview') {
        window.previewRenders.push({ command, ...args.request });
        if (args.request.path.endsWith('broken.fits')) throw 'Invalid FITS header';
        if (command !== 'render_selected_fits_preview') throw 'Path outside storage root';
        const r = args.request;
        const shade = r.auto_stretch ? 200 : Math.round(255 / (r.midtone || 1));
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="rgb(${shade},${shade},${shade})"/></svg>`;
        return { data_url: `data:image/svg+xml;base64,${btoa(svg)}`, width: 64, height: 64, source_path: r.path, size_bytes: 11520, header: [], color: false, black_point: r.auto_stretch ? 100 : r.black_point, midtone: r.auto_stretch ? 1 : r.midtone, white_point: r.auto_stretch ? 400 : r.white_point, analysis: { width: 64, height: 64, valid_samples: 4096, excluded_samples: 0, mean: 250, median: 250, min: 100, max: 400, std_dev: 75, nonpositive_percent: 0, saturation_limit: 65535, saturation_source: 'file ceiling', saturation_percent: 0, histogram: Array(256).fill(16) } };
      }
      throw new Error(`Unexpected desktop command: ${command}`);
    } };
  });
  await page.goto(origin);
  const open = page.getByRole('button', { name: 'Open FITS', exact: true });
  await open.waitFor();
  await page.evaluate(() => window.previewSelections.push('/outside/session/valid.fits'));
  await open.click();
  const image = page.locator('.preview-box img');
  await image.waitFor();
  const rawStats = await page.locator('.histogram-summary, .histogram-axis').allTextContents();
  const originalSrc = await image.getAttribute('src');
  const before = await page.evaluate(() => window.previewRenders.length);
  await page.locator('.stretch-inline input').nth(1).focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((count) => window.previewRenders.length > count && window.previewRenders.at(-1).auto_stretch === false, before);
  await page.waitForFunction((previous) => document.querySelector('.preview-box img')?.src !== previous && !document.querySelector('.preview-rendering'), originalSrc);
  assert.notEqual(await image.getAttribute('src'), originalSrc);
  assert.deepEqual(await page.locator('.histogram-summary, .histogram-axis').allTextContents(), rawStats);
  assert.ok((await page.evaluate(() => window.previewRenders)).every((render) => render.command === 'render_selected_fits_preview'));
  const manualCount = await page.evaluate(() => window.previewRenders.length);
  await page.getByRole('button', { name: 'Auto', exact: true }).click();
  await page.waitForFunction((count) => window.previewRenders.length > count && window.previewRenders.at(-1).auto_stretch === true, manualCount);
  await page.waitForFunction((previous) => document.querySelector('.preview-box img')?.src === previous && !document.querySelector('.preview-rendering'), originalSrc);
  assert.deepEqual(await page.locator('.histogram-summary, .histogram-axis').allTextContents(), rawStats);
  await page.evaluate(() => window.previewSelections.push(null));
  await open.click();
  await page.getByRole('status').filter({ hasText: 'FITS open canceled.' }).waitFor();
  assert.equal(await image.count(), 1);
  await page.evaluate(() => window.previewSelections.push('/outside/session/broken.fits'));
  await open.click();
  await page.getByRole('alert').filter({ hasText: 'Could not render broken.fits: Invalid FITS header' }).waitFor();
  assert.equal(await image.count(), 0);
  assert.equal(await page.locator('.preview-rendering').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS selected FITS stretch access, Auto re-render, stable raw statistics, picker cancel, and visible broken-file error without stale image');
} finally {
  await browser?.close();
  await server.close();
}
