const host = process.argv[2] ?? process.env.NINA_HOST ?? 'Starrunner.local';
const port = process.env.NINA_PORT ?? '1888';
const baseUrl = `http://${host}:${port}/v2/api`;
const socketUrl = `ws://${host}:${port}/v2/socket`;

const endpoints = [
  'version',
  'version/nina',
  'equipment/info',
  'equipment/camera/info',
  'equipment/mount/info',
  'equipment/focuser/info',
  'equipment/guider/info',
];

async function getJson(path) {
  const response = await fetch(`${baseUrl}/${path}`);
  const text = await response.text();
  let body;

  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return { path, status: response.status, body };
}

function summarizeEquipment(equipment) {
  const response = equipment?.Response ?? {};

  return {
    camera: response.Camera?.Connected ?? false,
    mount: response.Mount?.Connected ?? false,
    focuser: response.Focuser?.Connected ?? false,
    guider: response.Guider?.Connected ?? false,
    mountName: response.Mount?.Name ?? null,
  };
}

async function probeHttp() {
  console.log(`NINA API: ${baseUrl}`);

  for (const endpoint of endpoints) {
    const result = await getJson(endpoint);
    const ok = result.body?.Success === true ? 'ok' : 'warn';
    console.log(`${ok.padEnd(4)} ${endpoint.padEnd(24)} ${result.status}`);

    if (endpoint === 'version' || endpoint === 'version/nina') {
      console.log(`     ${result.body?.Response ?? '(no response)'}`);
    }

    if (endpoint === 'equipment/info') {
      console.log(`     ${JSON.stringify(summarizeEquipment(result.body))}`);
    }
  }
}

function probeWebSocket() {
  return new Promise((resolve) => {
    console.log(`WebSocket: ${socketUrl}`);

    const ws = new WebSocket(socketUrl);
    const timeout = setTimeout(() => {
      console.log('warn websocket timeout');
      ws.close();
      resolve(false);
    }, 5000);

    ws.addEventListener('open', () => {
      clearTimeout(timeout);
      console.log('ok   websocket connected');
      ws.close();
      resolve(true);
    });

    ws.addEventListener('error', () => {
      clearTimeout(timeout);
      console.log('warn websocket error');
      resolve(false);
    });
  });
}

try {
  await probeHttp();
  await probeWebSocket();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
