import { connectionClient } from './connectionClient';
import { networkFetch, networkSocket } from './networkClient';

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

async function getJson<T>(path: string, timeoutMs = 6000) {
  const response = await networkFetch(connectionClient.endpoint('nina', path), timeoutMs);
  const body = (await response.json()) as ApiEnvelope<T>;
  return { response, body };
}

function openEventSocket(reconnect = false) {
  return networkSocket(connectionClient.socketUrl(false), reconnect);
}

function openTppaSocket(reconnect = false) {
  return networkSocket(connectionClient.socketUrl(true), reconnect);
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
        EastDirection: settings.directionEast,
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
      socket.close();
      reject(new Error('TPPA WebSocket command failed.'));
    });
    socket.addEventListener('close', () => {
      window.clearTimeout(timeout);
      reject(new Error('TPPA connection closed before a response arrived.'));
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

async function setMountTracking(mode: 0 | 1 | 2 | 3 | 4) {
  return getJson<string>(`equipment/mount/tracking?mode=${mode}`, 8000);
}

async function unparkMount() {
  return getJson<string>('equipment/mount/unpark', 12000);
}

async function slewMount(settings: {
  raDegrees: number;
  decDegrees: number;
  waitForResult?: boolean;
  center?: boolean;
  rotate?: boolean;
  rotationAngle?: number;
}, timeoutMs = 600000) {
  const params = new URLSearchParams({
    ra: String(settings.raDegrees),
    dec: String(settings.decDegrees),
    waitForResult: String(settings.waitForResult ?? true),
    center: String(settings.center ?? true)
  });

  if (settings.rotate !== undefined) {
    params.set('rotate', String(settings.rotate));
  }

  if (settings.rotationAngle !== undefined) {
    params.set('rotationAngle', String(settings.rotationAngle));
  }

  return getJson<string>(`equipment/mount/slew?${params.toString()}`, timeoutMs);
}

async function stopMountSlew() {
  return getJson<string>('equipment/mount/slew/stop', 12000);
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

  return networkFetch(connectionClient.endpoint('nina', `equipment/camera/capture?${params.toString()}`), timeoutMs);
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
    get apiBase() { return connectionClient.endpoint('nina', '').replace(/\/$/, ''); },
    get wsUrl() { return connectionClient.socketUrl(false); },
    get tppaWsUrl() { return connectionClient.socketUrl(true); }
  },
  getJson,
  openEventSocket,
  openTppaSocket,
  sendTppaCommand,
  runAutofocus,
  coolCamera,
  warmCamera,
  abortExposure,
  setMountTracking,
  unparkMount,
  slewMount,
  stopMountSlew,
  capturePreview,
  captureSavedFrame,
  getCaptureStatistics
};
