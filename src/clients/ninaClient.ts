export type ApiEnvelope<T> = {
  Response: T;
  Error: string;
  StatusCode: number;
  Success: boolean;
  Type: string;
};

export type TppaCommandSettings = {
  manualMode: boolean;
  startFromCurrentPosition: boolean;
  directionEast: boolean;
  targetDistance: number;
  moveRate: number;
  exposureTime: number;
  binning: number;
  gain: number;
  offset: number;
  searchRadius: number;
};

export type PreviewCaptureSettings = {
  duration: number;
  gain: number;
  imageType: string;
  targetName: string;
  resize?: boolean;
  scale?: number;
  quality?: number;
};

export type SavedCaptureSettings = {
  duration: number;
  gain: number;
  offset: number;
  imageType: string;
  targetName: string;
};

const apiBase = import.meta.env.VITE_NINA_HTTP_BASE || '/nina-api';
const wsUrl =
  import.meta.env.VITE_NINA_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/nina-ws`;
const tppaWsUrl =
  import.meta.env.VITE_NINA_TPPA_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/nina-tppa`;

async function fetchWithTimeout(url: string, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function getJson<T>(path: string, timeoutMs = 6000) {
  const response = await fetchWithTimeout(`${apiBase}/${path}`, timeoutMs);
  const body = (await response.json()) as ApiEnvelope<T>;
  return { response, body };
}

function openEventSocket() {
  return new WebSocket(wsUrl);
}

function openTppaSocket() {
  return new WebSocket(tppaWsUrl);
}

function sendTppaCommand(action: string, settings: TppaCommandSettings) {
  return new Promise<string>((resolve, reject) => {
    const socket = openTppaSocket();
    const timeout = window.setTimeout(() => {
      socket.close();
      reject(new Error('TPPA command timed out.'));
    }, 6000);

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        Action: action,
        ManualMode: settings.manualMode,
        StartFromCurrentPosition: settings.startFromCurrentPosition,
        DirectionEast: settings.directionEast,
        TargetDistance: settings.targetDistance,
        MoveRate: settings.moveRate,
        ExposureTime: settings.exposureTime,
        Binning: settings.binning,
        Gain: settings.gain,
        Offset: settings.offset,
        SearchRadius: settings.searchRadius
      }));
    });

    socket.addEventListener('message', (message) => {
      window.clearTimeout(timeout);
      socket.close();
      resolve(String(message.data));
    });

    socket.addEventListener('error', () => {
      window.clearTimeout(timeout);
      reject(new Error('TPPA WebSocket command failed.'));
    });
  });
}

async function runAutofocus(cancel = false) {
  return getJson<string>(`equipment/focuser/auto-focus${cancel ? '?cancel=true' : ''}`, 12000);
}

async function coolCamera(temperature: number, minutes: number, cancel: boolean) {
  const params = new URLSearchParams({
    temperature: String(temperature),
    minutes: String(minutes),
    cancel: String(cancel)
  });

  return getJson<string>(`equipment/camera/cool?${params.toString()}`, 12000);
}

async function warmCamera(minutes: number, cancel: boolean) {
  const params = new URLSearchParams({
    minutes: String(minutes),
    cancel: String(cancel)
  });

  return getJson<string>(`equipment/camera/warm?${params.toString()}`, 12000);
}

async function abortExposure() {
  return getJson<string>('equipment/camera/abort-exposure', 8000);
}

async function capturePreview(settings: PreviewCaptureSettings, timeoutMs: number) {
  const params = new URLSearchParams({
    duration: String(settings.duration),
    gain: String(settings.gain),
    imageType: settings.imageType,
    targetName: settings.targetName,
    waitForResult: 'true',
    stream: 'true',
    save: 'false',
    resize: String(settings.resize ?? true),
    scale: String(settings.scale ?? 0.35),
    quality: String(settings.quality ?? -1),
    skipAutoStretch: 'false'
  });

  return fetchWithTimeout(`${apiBase}/equipment/camera/capture?${params.toString()}`, timeoutMs);
}

async function captureSavedFrame(settings: SavedCaptureSettings, timeoutMs: number) {
  const params = new URLSearchParams({
    duration: String(settings.duration),
    gain: String(settings.gain),
    offset: String(settings.offset),
    imageType: settings.imageType,
    targetName: settings.targetName,
    waitForResult: 'true',
    stream: 'false',
    save: 'true'
  });

  return getJson<string>(`equipment/camera/capture?${params.toString()}`, timeoutMs);
}

async function getCaptureStatistics<T>() {
  return getJson<T>('equipment/camera/capture/statistics', 15000);
}

export const ninaClient = {
  urls: {
    apiBase,
    wsUrl,
    tppaWsUrl
  },
  getJson,
  openEventSocket,
  openTppaSocket,
  sendTppaCommand,
  runAutofocus,
  coolCamera,
  warmCamera,
  abortExposure,
  capturePreview,
  captureSavedFrame,
  getCaptureStatistics
};
