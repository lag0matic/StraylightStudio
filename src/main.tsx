import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, Dispatch, ReactNode, SetStateAction } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Aperture,
  Camera,
  CircleStop,
  Crosshair,
  Focus,
  ListTree,
  Play,
  RefreshCw,
  Save,
  Search,
  Send,
  SlidersHorizontal,
  Telescope,
  Thermometer,
  Wifi,
  WifiOff
} from 'lucide-react';
import { frameTransferClient } from './clients/frameTransferClient';
import type { AgentFrame, AgentHealth } from './clients/frameTransferClient';
import { ninaClient } from './clients/ninaClient';
import type { ApiEnvelope } from './clients/ninaClient';
import { phd2Client } from './clients/phd2Client';
import type { Phd2Status, PhdGuideSample } from './clients/phd2Client';
import { settingsClient } from './clients/settingsClient';
import { storageClient } from './clients/storageClient';
import { tauriClient } from './clients/tauriClient';
import './styles.css';

type CameraInfo = {
  Connected: boolean;
  DisplayName?: string;
  Name?: string;
  CanSetTemperature?: boolean;
  Temperature?: number;
  TargetTemp?: number;
  TemperatureSetPoint?: number;
  CoolerOn?: boolean;
  CoolerPower?: number;
  Gain?: number;
  Offset?: number;
  XSize?: number;
  YSize?: number;
  PixelSize?: number;
  CameraState?: string;
  IsExposing?: boolean;
};

type MountInfo = {
  Connected: boolean;
  DisplayName?: string;
  Name?: string;
  TrackingEnabled?: boolean;
  TrackingMode?: string;
  Slewing?: boolean;
  AtPark?: boolean;
  RightAscensionString?: string;
  DeclinationString?: string;
  AltitudeString?: string;
  AzimuthString?: string;
  SideOfPier?: string;
  TimeToMeridianFlipString?: string;
};

type FocuserInfo = {
  Connected: boolean;
  DisplayName?: string;
  Name?: string;
  Position?: number;
  Temperature?: number | string;
  IsMoving?: boolean;
  TempComp?: boolean;
};

type GuiderInfo = {
  Connected: boolean;
  PixelScale?: number;
};

type EquipmentInfo = {
  Camera: CameraInfo;
  Mount: MountInfo;
  Focuser: FocuserInfo;
  Guider: GuiderInfo;
};

type LastAutofocus = {
  AutoFocuserName?: string;
  InitialFocusPoint?: number;
  CalculatedFocusPoint?: number;
  PreviousFocusPoint?: number;
  Duration?: string;
  Method?: string;
};

type NinaEvent = {
  id: number;
  receivedAt: string;
  event: string;
  detail: string;
};

type AcquisitionEvent = {
  id: number;
  receivedAt: string;
  event: string;
  target?: string;
  imageType?: string;
  fileName?: string;
  detail: string;
};

type DiagnosticStatus = 'pending' | 'ok' | 'warn' | 'error';
type CoolingTask = '' | 'cooling' | 'warming';
type AcquisitionMonitorTab = 'preview' | 'guiding' | 'stretch' | 'stats' | 'recent' | 'planned';
type PipelineDetailTab = 'recent' | 'pending' | 'failed';

type DiagnosticResult = {
  name: string;
  status: DiagnosticStatus;
  detail: string;
  durationMs?: number;
};

type CapabilityProbe = {
  name: string;
  kind: 'http' | 'websocket';
  path?: string;
  socketUrl?: string;
  commandSurface: string;
  routeExistsOnFailure?: boolean;
};

type CapabilityResult = DiagnosticResult & {
  commandSurface: string;
};

type TransferHistoryItem = {
  id: string;
  transferredAt: string;
  targetName: string;
  imageType: string;
  sourceKind: string;
  fileName: string;
  destinationPath: string;
  sizeBytes: number;
  sha256: string;
};

type AcquisitionPipelineState = {
  health: AgentHealth | null;
  pending: AgentFrame[];
  failed: AgentFrame[];
  history: TransferHistoryItem[];
  autoTransfer: boolean;
  message: string;
  checkedAt: string;
};

type TabKey = 'setup' | 'targeting' | 'acquisition' | 'logs';
type ConnectionStatus = 'checking' | 'online' | 'offline' | 'demo';

type ImportedTarget = {
  name: string;
  objectType?: string;
  raDegrees?: number;
  decDegrees?: number;
  raText?: string;
  decText?: string;
  magnitude?: string;
  size?: string;
  altitude?: string;
  azimuth?: string;
  rotationDegrees: number;
  source: 'Stellarium' | 'Demo';
  importedAt: string;
};

type SequencePlan = {
  imageType: string;
  exposureSeconds: number;
  frameCount: number;
  gain: number;
  offset: number;
  temperatureC: number;
  centeringToleranceArcsec: number;
  autofocusBeforeRun: boolean;
  guidingRequired: boolean;
  dither: boolean;
  notes: string;
};

type QueueItem = {
  id: string;
  target: ImportedTarget;
  plan: SequencePlan;
  createdAt: string;
};

type PreviewImage = {
  name: string;
  sizeBytes: number;
  type: string;
  dataUrl: string;
  width?: number;
  height?: number;
  sourcePath?: string;
  sourceKind?: 'bitmap' | 'fits';
};

type CaptureStats = {
  Stars?: number;
  HFR?: number;
  Median?: number;
  MedianAbsoluteDeviation?: number;
  Mean?: number;
  Max?: number;
  Min?: number;
  StDev?: number;
};

type SequenceRunState = {
  running: boolean;
  currentFrame: number;
  totalFrames: number;
  message: string;
  startedAt: string;
  completedAt: string;
};

type StretchSettings = {
  blackPoint: number;
  midtone: number;
  whitePoint: number;
};

type PersistedPlannerState = {
  activeTab: TabKey;
  target: ImportedTarget | null;
  sequencePlan: SequencePlan;
  queue: QueueItem[];
  activeQueueId: string;
};

type TppaSettings = {
  manualMode: boolean;
  startFromCurrentPosition: boolean;
  targetDistance: number;
  moveRate: number;
  exposureTime: number;
  binning: number;
  gain: number;
  offset: number;
  searchRadius: number;
};

type TppaWorkflowState = {
  socket: 'idle' | 'connecting' | 'open' | 'closed' | 'error';
  step: string;
  status: string;
  azimuthError?: number;
  altitudeError?: number;
  totalError?: number;
  instruction: string;
  lastMessage: string;
  lastUpdated: string;
  rawEvents: Array<{ id: number; receivedAt: string; event: string; detail: string }>;
};

const defaultTppaWorkflow: TppaWorkflowState = {
  socket: 'idle',
  step: 'Idle',
  status: 'Waiting',
  instruction: 'Start TPPA when the mount and camera are ready.',
  lastMessage: '',
  lastUpdated: '-',
  rawEvents: []
};

const { apiBase, wsUrl, tppaWsUrl } = ninaClient.urls;
const stellariumBase = import.meta.env.VITE_STELLARIUM_HTTP_BASE || '/stellarium-api';
const capabilityProbes: CapabilityProbe[] = [
  {
    name: 'Core API',
    kind: 'http',
    path: 'version',
    commandSurface: 'Read-only'
  },
  {
    name: 'Installed Plugins',
    kind: 'http',
    path: 'application/plugins',
    commandSurface: 'Read-only'
  },
  {
    name: 'Equipment Summary',
    kind: 'http',
    path: 'equipment/info',
    commandSurface: 'Read-only'
  },
  {
    name: 'Camera Capture',
    kind: 'http',
    path: 'equipment/camera/info',
    commandSurface: 'camera/capture'
  },
  {
    name: 'Cooling Control',
    kind: 'http',
    path: 'equipment/camera/info',
    commandSurface: 'camera/cooler endpoints'
  },
  {
    name: 'Mount Slew / Center',
    kind: 'http',
    path: 'equipment/mount/info',
    commandSurface: 'mount/slew, mount/slew/stop'
  },
  {
    name: 'Autofocus',
    kind: 'http',
    path: 'equipment/focuser/last-af',
    commandSurface: 'equipment/focuser/auto-focus',
    routeExistsOnFailure: true
  },
  {
    name: 'Sequence State',
    kind: 'http',
    path: 'sequence/state',
    commandSurface: 'sequence/load, sequence/skip'
  },
  {
    name: 'Image History',
    kind: 'http',
    path: 'image-history',
    commandSurface: 'image-history, image/{index}',
    routeExistsOnFailure: true
  },
  {
    name: 'Prepared Image',
    kind: 'http',
    path: 'prepared-image',
    commandSurface: 'prepared-image, prepared-image/solve',
    routeExistsOnFailure: true
  },
  {
    name: 'Livestack',
    kind: 'http',
    path: 'livestack/status',
    commandSurface: 'livestack/start, livestack/stop, livestack/image'
  },
  {
    name: 'TPPA',
    kind: 'websocket',
    socketUrl: tppaWsUrl,
    commandSurface: 'TPPA WebSocket commands'
  },
  {
    name: 'Event Stream',
    kind: 'websocket',
    socketUrl: wsUrl,
    commandSurface: 'NINA event WebSocket'
  }
];
const redcatFrame = {
  widthDegrees: 3.02,
  heightDegrees: 2.02,
  previewFovDegrees: 4
};
const plannerStorageKey = 'astro-planner-state-v1';
const frameAgentStorageKey = 'astro-frame-agent-v1';
const autoTransferStorageKey = 'astro-auto-transfer-enabled-v1';
const autoTransferDefaultedStorageKey = 'astro-auto-transfer-defaulted-v2';
const transferHistoryStorageKey = 'astro-transfer-history-v1';
const defaultSequencePlan: SequencePlan = {
  imageType: 'Light',
  exposureSeconds: 180,
  frameCount: 60,
  gain: 200,
  offset: 8,
  temperatureC: -10,
  centeringToleranceArcsec: 30,
  autofocusBeforeRun: true,
  guidingRequired: true,
  dither: true,
  notes: ''
};

const defaultStretch: StretchSettings = {
  blackPoint: 0,
  midtone: 1,
  whitePoint: 65535
};

const defaultSequenceRun: SequenceRunState = {
  running: false,
  currentFrame: 0,
  totalFrames: 0,
  message: 'Idle',
  startedAt: '-',
  completedAt: '-'
};

function loadAutoTransferEnabled() {
  if (!settingsClient.loadBoolean(autoTransferDefaultedStorageKey)) {
    settingsClient.saveBoolean(autoTransferStorageKey, true);
    settingsClient.saveBoolean(autoTransferDefaultedStorageKey, true);
    return true;
  }

  return settingsClient.loadBoolean(autoTransferStorageKey, true);
}

const demoEquipment: EquipmentInfo = {
  Camera: {
    Connected: true,
    DisplayName: 'ZWO ASI183MC Pro (demo)',
    Temperature: -9.7,
    TargetTemp: -10,
    CoolerOn: true,
    CoolerPower: 42.6,
    Gain: 200,
    Offset: 8,
    XSize: 5496,
    YSize: 3672,
    PixelSize: 2.4,
    CameraState: 'Idle',
    IsExposing: false
  },
  Mount: {
    Connected: true,
    DisplayName: 'Explore Scientific PMC-Eight (demo)',
    TrackingEnabled: true,
    TrackingMode: 'Sidereal',
    Slewing: false,
    AtPark: false,
    RightAscensionString: '00:42:44',
    DeclinationString: '41° 16\' 09"',
    AltitudeString: '63° 18\' 22"',
    AzimuthString: '074° 11\' 03"',
    SideOfPier: 'pierEast',
    TimeToMeridianFlipString: '03:12:44'
  },
  Focuser: {
    Connected: true,
    DisplayName: 'Gemini Focuser (demo)',
    Position: 5553,
    Temperature: 18,
    IsMoving: false,
    TempComp: false
  },
  Guider: {
    Connected: true,
    PixelScale: 4.83
  }
};

const demoAutofocus: LastAutofocus = {
  AutoFocuserName: 'Hocus Focus',
  InitialFocusPoint: 5408,
  CalculatedFocusPoint: 5553,
  PreviousFocusPoint: 5527,
  Duration: '00:02:18',
  Method: 'Hyperbolic'
};

const demoEvents: NinaEvent[] = [
  { id: 3, receivedAt: '22:17:08', event: 'ImageSaved', detail: 'M31_LIGHT_0003.fit | HFR: 2.6 | Stars: 184' },
  { id: 2, receivedAt: '22:14:02', event: 'AutoFocusFinished', detail: 'Calculated focus point: 5553' },
  { id: 1, receivedAt: '22:10:31', event: 'SequenceStarting', detail: 'Target: M31 | Exposure: 180s | Count: 60' }
];

const demoTarget: ImportedTarget = {
  name: 'M 31',
  objectType: 'Galaxy',
  raDegrees: 10.6847,
  decDegrees: 41.269,
  raText: '00h 42m 44s',
  decText: '+41° 16′ 09″',
  magnitude: '3.4',
  size: '190′ x 60′',
  altitude: '63°',
  azimuth: '74°',
  rotationDegrees: 0,
  source: 'Demo',
  importedAt: new Date().toLocaleTimeString()
};

async function fetchWithTimeout(url: string, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function formatValue(value: unknown, fallback = '-') {
  if (value === null || value === undefined || value === '' || Number.isNaN(value)) {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  return String(value);
}

function formatTemp(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }

  return `${value.toFixed(1)} C`;
}

function formatTppaError(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '-';
}

function summarizeEnvelopeResponse(path: string, body: ApiEnvelope<unknown>) {
  if (path === 'equipment/info' && body.Response && typeof body.Response === 'object') {
    const equipment = body.Response as Partial<EquipmentInfo>;
    const camera = equipment.Camera?.Connected ? 'camera on' : 'camera off';
    const mount = equipment.Mount?.Connected ? 'mount on' : 'mount off';
    const focuser = equipment.Focuser?.Connected ? 'focuser on' : 'focuser off';
    const guider = equipment.Guider?.Connected ? 'guider on' : 'guider off';
    return `${camera}, ${mount}, ${focuser}, ${guider}`;
  }

  if (body.Response === undefined || body.Response === null || body.Response === '') {
    return body.Success ? 'OK' : body.Error || 'No response';
  }

  if (typeof body.Response === 'string' || typeof body.Response === 'number' || typeof body.Response === 'boolean') {
    return String(body.Response);
  }

  if (Array.isArray(body.Response)) {
    return body.Response.length ? body.Response.map((item) => String(item)).join(', ') : 'none';
  }

  if (body.Response && typeof body.Response === 'object' && 'Connected' in body.Response) {
    const device = body.Response as { Connected?: boolean; DisplayName?: string; Name?: string };
    const deviceName = device.DisplayName || device.Name;
    return `${device.Connected ? 'connected' : 'disconnected'}${deviceName ? ` - ${deviceName}` : ''}`;
  }

  return 'OK';
}

async function runHttpDiagnostic(name: string, path: string): Promise<DiagnosticResult> {
  const startedAt = performance.now();

  try {
    const { response, body } = await ninaClient.getJson<unknown>(path, 6000);
    const durationMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      return { name, status: 'error', detail: `HTTP ${response.status}`, durationMs };
    }

    if (!body.Success) {
      return { name, status: 'warn', detail: body.Error || `HTTP ${response.status}`, durationMs };
    }

    return { name, status: 'ok', detail: summarizeEnvelopeResponse(path, body), durationMs };
  } catch (caught) {
    return {
      name,
      status: 'error',
      detail: caught instanceof Error && caught.name !== 'AbortError' ? caught.message : 'Timed out',
      durationMs: Math.round(performance.now() - startedAt)
    };
  }
}

function runSocketDiagnostic(name: string, socketUrl: string): Promise<DiagnosticResult> {
  const startedAt = performance.now();

  return new Promise((resolve) => {
    let settled = false;
    const socket = socketUrl === tppaWsUrl ? ninaClient.openTppaSocket() : ninaClient.openEventSocket();
    const timeout = window.setTimeout(() => {
      finish({ name, status: 'error', detail: 'Timed out' });
    }, 6000);
    const finish = (result: DiagnosticResult) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeout);
      socket.close();
      resolve({ ...result, durationMs: Math.round(performance.now() - startedAt) });
    };

    socket.addEventListener('open', () => {
      finish({ name, status: 'ok', detail: 'connected' });
    });

    socket.addEventListener('error', () => {
      finish({ name, status: 'error', detail: 'connection failed' });
    });
  });
}

function runWebSocketDiagnostic(): Promise<DiagnosticResult> {
  return runSocketDiagnostic('Event WebSocket', wsUrl);
}

async function runCapabilityHttpProbe(probe: CapabilityProbe): Promise<CapabilityResult> {
  const startedAt = performance.now();

  try {
    const { response, body } = await ninaClient.getJson<unknown>(probe.path ?? '', 6000);
    const durationMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      return { name: probe.name, status: 'error', detail: `HTTP ${response.status}`, commandSurface: probe.commandSurface, durationMs };
    }

    if (!body.Success) {
      return {
        name: probe.name,
        status: probe.routeExistsOnFailure ? 'warn' : 'error',
        detail: probe.routeExistsOnFailure ? `route present - ${body.Error || `status ${body.StatusCode}`}` : body.Error || 'request failed',
        commandSurface: probe.commandSurface,
        durationMs
      };
    }

    return {
      name: probe.name,
      status: 'ok',
      detail: summarizeEnvelopeResponse(probe.path ?? '', body),
      commandSurface: probe.commandSurface,
      durationMs
    };
  } catch (caught) {
    return {
      name: probe.name,
      status: 'error',
      detail: caught instanceof Error && caught.name !== 'AbortError' ? caught.message : 'Timed out',
      commandSurface: probe.commandSurface,
      durationMs: Math.round(performance.now() - startedAt)
    };
  }
}

async function runCapabilityProbe(probe: CapabilityProbe): Promise<CapabilityResult> {
  if (probe.kind === 'websocket') {
    const result = await runSocketDiagnostic(probe.name, probe.socketUrl ?? wsUrl);
    return { ...result, commandSurface: probe.commandSurface };
  }

  return runCapabilityHttpProbe(probe);
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findMapValue(map: Record<string, unknown>, candidates: string[]) {
  const normalized = new Map(Object.entries(map).map(([key, value]) => [normalizeKey(key), value]));

  for (const candidate of candidates) {
    const value = normalized.get(normalizeKey(candidate));
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return undefined;
}

function parseSexagesimal(value: string, isRa: boolean) {
  const sign = value.trim().startsWith('-') ? -1 : 1;
  const parts = value
    .replace(/[−-]/g, ' ')
    .replace(/[hHdDmMsS°º'′"″:+]/g, ' ')
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((part) => !Number.isNaN(part));

  if (!parts.length) {
    return undefined;
  }

  const magnitude = Math.abs(parts[0]) + (parts[1] ?? 0) / 60 + (parts[2] ?? 0) / 3600;
  return sign * magnitude * (isRa ? 15 : 1);
}

function parseDegrees(value: unknown, isRa = false) {
  if (typeof value === 'number') {
    return isRa && value <= 24 ? value * 15 : value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  const decimal = Number(trimmed.replace(/[°º]/g, ''));

  if (!Number.isNaN(decimal) && trimmed !== '') {
    return isRa && decimal <= 24 ? decimal * 15 : decimal;
  }

  return parseSexagesimal(trimmed, isRa);
}

function asText(value: unknown) {
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

function integrationSeconds(plan: SequencePlan) {
  return Math.max(0, plan.exposureSeconds) * Math.max(0, plan.frameCount);
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${remainingSeconds}s`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Unable to read image response.'));
      }
    };
    reader.onerror = () => reject(new Error('Unable to read image response.'));
    reader.readAsDataURL(blob);
  });
}

function blobToBase64(blob: Blob) {
  return blobToDataUrl(blob).then((dataUrl) => dataUrl.split(',')[1] ?? '');
}

async function sha256Hex(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function stretchFilter(settings: StretchSettings) {
  const span = Math.max(1, settings.whitePoint - settings.blackPoint);
  const contrast = Math.min(4, Math.max(0.75, 65535 / span));
  const brightness = Math.min(2.5, Math.max(0.35, 1 + settings.blackPoint / 65535 - (settings.midtone - 1) * 0.25));
  return `contrast(${contrast.toFixed(2)}) brightness(${brightness.toFixed(2)})`;
}

function loadPlannerState(): Partial<PersistedPlannerState> {
  return settingsClient.loadJson<Partial<PersistedPlannerState>>(plannerStorageKey, {});
}

function targetFromStellariumMap(map: Record<string, unknown>): ImportedTarget {
  const name = asText(findMapValue(map, ['name', 'localized name', 'english name', 'designation', 'object name'])) || 'Selected object';
  const raRaw = findMapValue(map, ['ra', 'right ascension', 'right ascension j2000', 'ra j2000', 'ra/dec j2000']);
  const decRaw = findMapValue(map, ['dec', 'declination', 'declination j2000', 'dec j2000']);
  const raDegrees = parseDegrees(raRaw, true);
  const decDegrees = parseDegrees(decRaw, false);

  return {
    name,
    objectType: asText(findMapValue(map, ['type', 'object type', 'objecttype'])),
    raDegrees,
    decDegrees,
    raText: asText(raRaw),
    decText: asText(decRaw),
    magnitude: asText(findMapValue(map, ['magnitude', 'mag', 'visual magnitude'])),
    size: asText(findMapValue(map, ['size', 'angular size', 'dimensions'])),
    altitude: asText(findMapValue(map, ['altitude', 'alt'])),
    azimuth: asText(findMapValue(map, ['azimuth', 'az'])),
    rotationDegrees: 0,
    source: 'Stellarium',
    importedAt: new Date().toLocaleTimeString()
  };
}

function surveyImageUrl(target: ImportedTarget) {
  if (target.raDegrees === undefined || target.decDegrees === undefined) {
    return '';
  }

  const params = new URLSearchParams({
    hips: 'CDS/P/DSS2/color',
    width: '900',
    height: '620',
    projection: 'TAN',
    coordsys: 'icrs',
    ra: String(target.raDegrees),
    dec: String(target.decDegrees),
    fov: String(redcatFrame.previewFovDegrees),
    rotation_angle: String(target.rotationDegrees),
    format: 'jpg',
    min_cut: '1%',
    max_cut: '99%',
    stretch: 'asinh'
  });

  return `https://alasky.cds.unistra.fr/hips-image-services/hips2fits?${params.toString()}`;
}

function eventLabel(raw: unknown) {
  if (!raw || typeof raw !== 'object') {
    return { event: 'Message', detail: String(raw) };
  }

  const payload = raw as { Response?: unknown; Error?: string; Type?: string };
  const response = payload.Response;

  if (response && typeof response === 'object' && 'Event' in response) {
    const event = String((response as { Event?: string }).Event || 'Event');
    const detail = Object.entries(response)
      .filter(([key]) => key !== 'Event')
      .slice(0, 4)
      .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
      .join(' | ');

    return { event, detail: detail || payload.Error || '' };
  }

  return {
    event: payload.Type || 'Message',
    detail: typeof response === 'string' ? response : JSON.stringify(response ?? raw)
  };
}

function eventPayload(raw: unknown) {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const payload = raw as { Response?: unknown };
  const response = payload.Response;
  return response && typeof response === 'object' ? response as Record<string, unknown> : payload as Record<string, unknown>;
}

function asEventText(value: unknown) {
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

function flattenRecord(value: unknown, prefix = ''): Array<[string, unknown]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return entry && typeof entry === 'object' && !Array.isArray(entry)
      ? [[path, entry] as [string, unknown], ...flattenRecord(entry, path)]
      : [[path, entry] as [string, unknown]];
  });
}

function findNumberByKey(entries: Array<[string, unknown]>, include: string[], exclude: string[] = []) {
  const match = entries.find(([key, value]) => {
    const lower = key.toLowerCase();
    return typeof value === 'number'
      && include.every((part) => lower.includes(part))
      && !exclude.some((part) => lower.includes(part));
  });

  return typeof match?.[1] === 'number' ? match[1] : undefined;
}

function findTextByKey(entries: Array<[string, unknown]>, include: string[]) {
  const match = entries.find(([key, value]) => {
    const lower = key.toLowerCase();
    return typeof value === 'string' && include.some((part) => lower.includes(part));
  });

  return typeof match?.[1] === 'string' ? match[1] : undefined;
}

function tppaStateFromRaw(raw: unknown, id: number, receivedAt: string): Partial<TppaWorkflowState> {
  const payload = eventPayload(raw) ?? (raw && typeof raw === 'object' ? raw as Record<string, unknown> : { Message: String(raw) });
  const label = eventLabel(raw);
  const entries = flattenRecord(payload);
  const event = asEventText(payload.Event) || label.event;
  const status = findTextByKey(entries, ['status', 'state', 'message']) || label.detail || event;
  const instruction = findTextByKey(entries, ['instruction', 'adjustment', 'move', 'direction']) || '';
  const azimuthError = findNumberByKey(entries, ['azimuth', 'error']);
  const altitudeError = findNumberByKey(entries, ['altitude', 'error']);
  const totalError = findNumberByKey(entries, ['total', 'error']) ?? findNumberByKey(entries, ['polar', 'error']);

  return {
    step: event,
    status,
    instruction,
    azimuthError,
    altitudeError,
    totalError,
    lastMessage: label.detail || JSON.stringify(payload),
    lastUpdated: receivedAt,
    rawEvents: [{
      id,
      receivedAt,
      event,
      detail: label.detail || JSON.stringify(payload)
    }]
  };
}

function acquisitionEventFromRaw(raw: unknown, id: number, receivedAt: string): AcquisitionEvent | null {
  const payload = eventPayload(raw);
  const label = eventLabel(raw);
  const event = asEventText(payload?.Event) || label.event;
  const upperEvent = event.toUpperCase();
  const relevant =
    upperEvent.includes('IMAGE') ||
    upperEvent.includes('CAPTURE') ||
    upperEvent.includes('SEQUENCE') ||
    upperEvent.includes('ADV-SEQ') ||
    upperEvent.includes('TS-TARGET');

  if (!relevant) {
    return null;
  }

  const target = asEventText(payload?.TargetName ?? payload?.Target ?? payload?.Name);
  const imageType = asEventText(payload?.ImageType ?? payload?.Type);
  const fileName = asEventText(payload?.FileName ?? payload?.Filename ?? payload?.Path);
  const details = [
    target ? `target ${target}` : '',
    imageType ? `type ${imageType}` : '',
    fileName ? fileName : '',
    asEventText(payload?.ExposureTime ?? payload?.Exposure) ? `exposure ${asEventText(payload?.ExposureTime ?? payload?.Exposure)}` : '',
    asEventText(payload?.HFR) ? `HFR ${asEventText(payload?.HFR)}` : '',
    asEventText(payload?.Stars) ? `stars ${asEventText(payload?.Stars)}` : '',
    asEventText(payload?.Median) ? `median ${asEventText(payload?.Median)}` : '',
    label.detail
  ].filter(Boolean);

  return {
    id,
    receivedAt,
    event,
    target,
    imageType,
    fileName,
    detail: details[0] ? details.join(' | ') : 'Event received'
  };
}

function useNinaStatus(demoMode: boolean) {
  const [equipment, setEquipment] = useState<EquipmentInfo | null>(null);
  const [lastAutofocus, setLastAutofocus] = useState<LastAutofocus | null>(null);
  const [lastAutofocusError, setLastAutofocusError] = useState('');
  const [apiVersion, setApiVersion] = useState('-');
  const [ninaVersion, setNinaVersion] = useState('-');
  const [httpStatus, setHttpStatus] = useState<ConnectionStatus>('checking');
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState('');

  const refresh = useCallback(async () => {
    if (demoMode) {
      setEquipment(demoEquipment);
      setLastAutofocus(demoAutofocus);
      setLastAutofocusError('');
      setApiVersion('2.2.15.1');
      setNinaVersion('3.2.0.9001');
      setHttpStatus('demo');
      setError('');
      setLastRefresh(new Date().toLocaleTimeString());
      return;
    }

    setError('');

    try {
      const [apiResult, ninaResult, equipmentResult] = await Promise.all([
        ninaClient.getJson<string>('version'),
        ninaClient.getJson<string>('version/nina'),
        ninaClient.getJson<EquipmentInfo>('equipment/info')
      ]);

      if (!apiResult.response.ok || !ninaResult.response.ok || !equipmentResult.response.ok) {
        throw new Error('NINA API returned an unexpected response.');
      }

      const apiJson = apiResult.body;
      const ninaJson = ninaResult.body;
      const equipmentJson = equipmentResult.body;

      if (!apiJson.Success || !ninaJson.Success || !equipmentJson.Success) {
        throw new Error(equipmentJson.Error || apiJson.Error || ninaJson.Error || 'NINA API request failed.');
      }

      setApiVersion(apiJson.Response);
      setNinaVersion(ninaJson.Response);
      setEquipment(equipmentJson.Response);

      try {
        const { body: afJson } = await ninaClient.getJson<LastAutofocus | string>('equipment/focuser/last-af');

        if (afJson.Success && typeof afJson.Response === 'object') {
          setLastAutofocus(afJson.Response);
          setLastAutofocusError('');
        } else {
          setLastAutofocus(null);
          setLastAutofocusError(afJson.Error || 'No autofocus run available.');
        }
      } catch {
        setLastAutofocus(null);
        setLastAutofocusError('Last autofocus unavailable.');
      }

      setHttpStatus('online');
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (caught) {
      setEquipment(null);
      setHttpStatus('offline');
      setError(caught instanceof Error && caught.name !== 'AbortError' ? caught.message : 'Unable to reach NINA API.');
    }
  }, [demoMode]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return {
    equipment,
    lastAutofocus,
    lastAutofocusError,
    apiVersion,
    ninaVersion,
    httpStatus,
    error,
    lastRefresh,
    refresh
  };
}

function useNinaEvents(enabled: boolean) {
  const nextId = useRef(1);
  const nextAcquisitionId = useRef(1);
  const [socketStatus, setSocketStatus] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
  const [events, setEvents] = useState<NinaEvent[]>([]);
  const [acquisitionEvents, setAcquisitionEvents] = useState<AcquisitionEvent[]>([]);

  useEffect(() => {
    if (!enabled) {
      setSocketStatus('idle');
      return undefined;
    }

    let closedByEffect = false;
    const socket = ninaClient.openEventSocket();

    setSocketStatus('connecting');

    socket.addEventListener('open', () => setSocketStatus('open'));

    socket.addEventListener('message', (message) => {
      let raw: unknown = message.data;

      try {
        raw = JSON.parse(String(message.data));
      } catch {
        raw = message.data;
      }

      const label = eventLabel(raw);
      const receivedAt = new Date().toLocaleTimeString();
      setEvents((current) => [
        {
          id: nextId.current++,
          receivedAt,
          event: label.event,
          detail: label.detail
        },
        ...current
      ].slice(0, 100));

      const acquisitionEvent = acquisitionEventFromRaw(raw, nextAcquisitionId.current, receivedAt);

      if (acquisitionEvent) {
        nextAcquisitionId.current += 1;
        setAcquisitionEvents((current) => [acquisitionEvent, ...current].slice(0, 100));
      }
    });

    socket.addEventListener('error', () => setSocketStatus('error'));
    socket.addEventListener('close', () => {
      if (!closedByEffect) {
        setSocketStatus('closed');
      }
    });

    return () => {
      closedByEffect = true;
      socket.close();
    };
  }, [enabled]);

  return { socketStatus, events, acquisitionEvents };
}

function StatusLight({ label, active }: { label: string; active?: boolean }) {
  return (
    <div className="status-light">
      <span className={active ? 'light light-on' : 'light'} />
      {label}
    </div>
  );
}

function StatusBar({
  equipment,
  httpStatus,
  socketStatus,
  lastRefresh,
  demoMode,
  onRefresh,
  onToggleDemo
}: {
  equipment: EquipmentInfo | null;
  httpStatus: ConnectionStatus;
  socketStatus: 'idle' | 'connecting' | 'open' | 'closed' | 'error';
  lastRefresh: string;
  demoMode: boolean;
  onRefresh: () => void;
  onToggleDemo: () => void;
}) {
  const camera = equipment?.Camera;
  const mount = equipment?.Mount;
  const focuser = equipment?.Focuser;
  const guider = equipment?.Guider;

  return (
    <header className="statusbar">
      <div className="brand-block">
        <h1>Straylight Studio</h1>
        <div className="host-line">Starrunner.local</div>
      </div>
      <div className="rig-strip">
        <div className={httpStatus === 'online' || httpStatus === 'demo' ? 'connection online' : httpStatus === 'checking' ? 'connection wait' : 'connection offline'}>
          {httpStatus === 'online' || httpStatus === 'demo' ? <Wifi size={15} /> : <WifiOff size={15} />}
          {httpStatus}
        </div>
        <StatusLight label="Camera" active={camera?.Connected} />
        <StatusLight label="Mount" active={mount?.Connected} />
        <StatusLight label="Focuser" active={focuser?.Connected} />
        <StatusLight label="Guiding" active={guider?.Connected} />
        <div className={socketStatus === 'open' ? 'connection online' : 'connection offline'}>Events {socketStatus}</div>
        <div className="last-refresh">{lastRefresh || '-'}</div>
        <button className={demoMode ? 'demo-toggle active' : 'demo-toggle'} type="button" onClick={onToggleDemo}>
          Demo Data
        </button>
        <button type="button" onClick={onRefresh}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>
    </header>
  );
}

function DataTable({ rows }: { rows: Array<[string, unknown]> }) {
  return (
    <table className="data-table">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th>{label}</th>
            <td>{formatValue(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Panel({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
        {icon}
      </div>
      {children}
    </section>
  );
}

function SetupTab({
  equipment,
  lastAutofocus,
  lastAutofocusError,
  commandBusy,
  coolingTarget,
  setCoolingTarget,
  coolingMinutes,
  setCoolingMinutes,
  coolingTask,
  runCameraCooling,
  runAutofocus,
  runTppa,
  tppaSettings,
  tppaWorkflow,
  setTppaSettings,
  setTppaNumber
}: {
  equipment: EquipmentInfo | null;
  lastAutofocus: LastAutofocus | null;
  lastAutofocusError: string;
  commandBusy: string;
  coolingTarget: number;
  setCoolingTarget: Dispatch<SetStateAction<number>>;
  coolingMinutes: number;
  setCoolingMinutes: Dispatch<SetStateAction<number>>;
  coolingTask: CoolingTask;
  runCameraCooling: (action: 'cool' | 'warm' | 'cancel-cool' | 'cancel-warm') => Promise<void>;
  runAutofocus: (cancel?: boolean) => Promise<void>;
  runTppa: (action: string) => Promise<void>;
  tppaSettings: TppaSettings;
  tppaWorkflow: TppaWorkflowState;
  setTppaSettings: Dispatch<SetStateAction<TppaSettings>>;
  setTppaNumber: (key: keyof TppaSettings, value: string) => void;
}) {
  const camera = equipment?.Camera;
  const mount = equipment?.Mount;
  const focuser = equipment?.Focuser;
  const guider = equipment?.Guider;

  return (
    <div className="tab-grid">
      <Panel title="Camera and Cooling" icon={<Camera size={17} />}>
        <DataTable
          rows={[
            ['Device', camera?.DisplayName || camera?.Name],
            ['State', camera?.CameraState],
            ['Temperature', formatTemp(camera?.Temperature)],
            ['Target temp', formatTemp(camera?.TemperatureSetPoint ?? camera?.TargetTemp)],
            ['Can set temp', camera?.CanSetTemperature],
            ['Cooler', camera?.CoolerOn],
            ['Cooler power', camera?.CoolerPower === undefined ? undefined : `${camera.CoolerPower.toFixed(1)}%`],
            ['Gain', camera?.Gain],
            ['Offset', camera?.Offset],
            ['Sensor', camera?.XSize && camera?.YSize ? `${camera.XSize} x ${camera.YSize}` : undefined],
            ['Pixel size', camera?.PixelSize ? `${camera.PixelSize} um` : undefined]
          ]}
        />
        <div className="form-grid">
          <label>
            Target temp
            <input
              type="number"
              value={coolingTarget}
              min="-40"
              max="35"
              step="1"
              onChange={(event) => setCoolingTarget(Number(event.target.value))}
            />
          </label>
          <label>
            Duration minutes
            <input
              type="number"
              value={coolingMinutes}
              min="-1"
              max="60"
              step="1"
              onChange={(event) => setCoolingMinutes(Number(event.target.value))}
            />
          </label>
        </div>
        <div className="button-row">
          <button
            className={coolingTask === 'cooling' ? 'cooling-button active' : 'cooling-button'}
            type="button"
            disabled={!camera?.Connected || camera.CanSetTemperature === false || commandBusy !== ''}
            onClick={() => void runCameraCooling(coolingTask === 'cooling' ? 'cancel-cool' : 'cool')}
          >
            <Thermometer size={16} />
            {coolingTask === 'cooling' ? 'Cancel Cooling' : 'Start Cooling'}
          </button>
          <button
            className={coolingTask === 'warming' ? 'warming-button active' : 'warming-button'}
            type="button"
            disabled={!camera?.Connected || camera.CanSetTemperature === false || commandBusy !== ''}
            onClick={() => void runCameraCooling(coolingTask === 'warming' ? 'cancel-warm' : 'warm')}
          >
            {coolingTask === 'warming' ? 'Cancel Warming' : 'Warm to Ambient'}
          </button>
          <div className="inline-note">Use -1 minutes for NINA profile default.</div>
        </div>
      </Panel>

      <Panel title="Focus" icon={<Focus size={17} />}>
        <DataTable
          rows={[
            ['Device', focuser?.DisplayName || focuser?.Name],
            ['Position', focuser?.Position],
            ['Moving', focuser?.IsMoving],
            ['Temperature', focuser?.Temperature],
            ['Last result', lastAutofocus ? 'Available' : lastAutofocusError || '-'],
            ['Calculated point', lastAutofocus?.CalculatedFocusPoint],
            ['Previous point', lastAutofocus?.PreviousFocusPoint],
            ['Method', lastAutofocus?.Method]
          ]}
        />
        <div className="button-row">
          <button type="button" disabled={!focuser?.Connected || commandBusy !== ''} onClick={() => void runAutofocus(false)}>
            <Focus size={16} />
            Start AF
          </button>
          <button type="button" disabled={commandBusy !== ''} onClick={() => void runAutofocus(true)}>
            <CircleStop size={16} />
            Cancel AF
          </button>
        </div>
      </Panel>

      <Panel title="Three Point Polar Alignment" icon={<Crosshair size={17} />}>
        <div className="tppa-summary">
          <div>
            <span>Azimuth Error</span>
            <strong>{formatTppaError(tppaWorkflow.azimuthError)}</strong>
          </div>
          <div>
            <span>Altitude Error</span>
            <strong>{formatTppaError(tppaWorkflow.altitudeError)}</strong>
          </div>
          <div>
            <span>Total Error</span>
            <strong>{formatTppaError(tppaWorkflow.totalError)}</strong>
          </div>
        </div>
        <DataTable
          rows={[
            ['Socket', tppaWorkflow.socket],
            ['Step', tppaWorkflow.step],
            ['Status', tppaWorkflow.status],
            ['Updated', tppaWorkflow.lastUpdated]
          ]}
        />
        <div className="tppa-instruction">
          <Crosshair size={16} />
          <span>{tppaWorkflow.instruction || 'Waiting for NINA TPPA adjustment instructions.'}</span>
        </div>
        <div className="form-grid">
          <label>
            Exposure
            <input value={tppaSettings.exposureTime} type="number" min="0.1" step="0.1" onChange={(event) => setTppaNumber('exposureTime', event.target.value)} />
          </label>
          <label>
            Gain
            <input value={tppaSettings.gain} type="number" min="0" step="1" onChange={(event) => setTppaNumber('gain', event.target.value)} />
          </label>
          <label>
            Offset
            <input value={tppaSettings.offset} type="number" min="0" step="1" onChange={(event) => setTppaNumber('offset', event.target.value)} />
          </label>
          <label>
            Binning
            <input value={tppaSettings.binning} type="number" min="1" step="1" onChange={(event) => setTppaNumber('binning', event.target.value)} />
          </label>
          <label>
            Target distance
            <input value={tppaSettings.targetDistance} type="number" min="1" step="1" onChange={(event) => setTppaNumber('targetDistance', event.target.value)} />
          </label>
          <label>
            Search radius
            <input value={tppaSettings.searchRadius} type="number" min="0.1" step="0.1" onChange={(event) => setTppaNumber('searchRadius', event.target.value)} />
          </label>
        </div>
        <div className="check-row">
          <label>
            <input
              checked={tppaSettings.startFromCurrentPosition}
              type="checkbox"
              onChange={(event) => setTppaSettings((current) => ({ ...current, startFromCurrentPosition: event.target.checked }))}
            />
            Start from current position
          </label>
          <label>
            <input
              checked={tppaSettings.manualMode}
              type="checkbox"
              onChange={(event) => setTppaSettings((current) => ({ ...current, manualMode: event.target.checked }))}
            />
            Manual mode
          </label>
        </div>
        <div className="button-row">
          <button type="button" disabled={!mount?.Connected || !camera?.Connected || commandBusy !== ''} onClick={() => void runTppa('start-alignment')}>
            <Crosshair size={16} />
            Start TPPA
          </button>
          <button type="button" disabled={commandBusy !== ''} onClick={() => void runTppa('pause-alignment')}>Pause</button>
          <button type="button" disabled={commandBusy !== ''} onClick={() => void runTppa('resume-alignment')}>Resume</button>
          <button type="button" disabled={commandBusy !== ''} onClick={() => void runTppa('stop-alignment')}>Stop</button>
        </div>
        {tppaWorkflow.rawEvents.length ? (
          <div className="tppa-event-list">
            {tppaWorkflow.rawEvents.slice(0, 5).map((event) => (
              <div className="tppa-event-row" key={event.id}>
                <time>{event.receivedAt}</time>
                <strong>{event.event}</strong>
                <span>{event.detail}</span>
              </div>
            ))}
          </div>
        ) : null}
      </Panel>

      <Panel title="Mount and Guide" icon={<Telescope size={17} />}>
        <DataTable
          rows={[
            ['Mount', mount?.DisplayName || mount?.Name],
            ['RA', mount?.RightAscensionString],
            ['Dec', mount?.DeclinationString],
            ['Altitude', mount?.AltitudeString],
            ['Azimuth', mount?.AzimuthString],
            ['Tracking', mount?.TrackingEnabled],
            ['Tracking mode', mount?.TrackingMode],
            ['Pier side', mount?.SideOfPier],
            ['Flip window', mount?.TimeToMeridianFlipString],
            ['Guider pixel scale', guider?.PixelScale]
          ]}
        />
      </Panel>
    </div>
  );
}

function TargetingTab({
  target,
  targetError,
  targetBusy,
  sessionRoot,
  storageBusy,
  sequencePlan,
  queue,
  activeQueueId,
  onImport,
  onUseDemo,
  onRotationChange,
  onSequencePlanChange,
  onChooseSessionRoot,
  onClearSessionRoot,
  onAddToQueue,
  onRemoveQueueItem,
  onSetActiveQueueItem,
  onClearQueue
}: {
  target: ImportedTarget | null;
  targetError: string;
  targetBusy: boolean;
  sessionRoot: string | null;
  storageBusy: boolean;
  sequencePlan: SequencePlan;
  queue: QueueItem[];
  activeQueueId: string;
  onImport: () => Promise<void>;
  onUseDemo: () => void;
  onRotationChange: (rotation: number) => void;
  onSequencePlanChange: (updates: Partial<SequencePlan>) => void;
  onChooseSessionRoot: () => Promise<void>;
  onClearSessionRoot: () => Promise<void>;
  onAddToQueue: () => void;
  onRemoveQueueItem: (id: string) => void;
  onSetActiveQueueItem: (id: string) => void;
  onClearQueue: () => void;
}) {
  const imageUrl = target ? surveyImageUrl(target) : '';
  const overlayWidth = `${(redcatFrame.widthDegrees / redcatFrame.previewFovDegrees) * 100}%`;
  const overlayHeight = `${(redcatFrame.heightDegrees / redcatFrame.previewFovDegrees) * 100}%`;
  const totalIntegration = integrationSeconds(sequencePlan);
  const estimatedDuration = totalIntegration + (sequencePlan.autofocusBeforeRun ? 180 : 0) + (sequencePlan.guidingRequired ? 90 : 0);

  return (
    <div className="tab-grid">
      <Panel title="Stellarium Import" icon={<Search size={17} />}>
        <DataTable
          rows={[
            ['Remote Control', 'localhost:8090'],
            ['Selection', target?.name],
            ['Source', target?.source],
            ['Imported', target?.importedAt],
            ['Status', targetError || (target ? 'Ready' : 'No target imported')]
          ]}
        />
        <div className="button-row">
          <button type="button" disabled={targetBusy} onClick={() => void onImport()}>
            <Send size={16} />
            Import From Stellarium
          </button>
          <button type="button" onClick={onUseDemo}>
            <Search size={16} />
            Demo M31
          </button>
        </div>
      </Panel>

      <Panel title="Target" icon={<Crosshair size={17} />}>
        <DataTable
          rows={[
            ['Name', target?.name],
            ['Type', target?.objectType],
            ['RA', target?.raText || (target?.raDegrees === undefined ? undefined : `${target.raDegrees.toFixed(4)}°`)],
            ['Dec', target?.decText || (target?.decDegrees === undefined ? undefined : `${target.decDegrees.toFixed(4)}°`)],
            ['Magnitude', target?.magnitude],
            ['Size', target?.size],
            ['Altitude now', target?.altitude],
            ['Azimuth', target?.azimuth],
            ['Frame', `${redcatFrame.widthDegrees.toFixed(2)}° x ${redcatFrame.heightDegrees.toFixed(2)}°`]
          ]}
        />
        <div className="form-grid single">
          <label>
            Rotation
            <input
              type="number"
              value={target?.rotationDegrees ?? 0}
              min="-180"
              max="180"
              step="1"
              disabled={!target}
              onChange={(event) => onRotationChange(Number(event.target.value))}
            />
          </label>
        </div>
      </Panel>

      <Panel title="Frame Preview" icon={<Aperture size={17} />}>
        <div className="target-preview">
          {imageUrl ? <img alt={`${target?.name} survey preview`} src={imageUrl} /> : <div>No survey preview</div>}
          {target ? (
            <div
              className="frame-overlay"
              style={{
                width: overlayWidth,
                height: overlayHeight,
                transform: `translate(-50%, -50%) rotate(${target.rotationDegrees}deg)`
              }}
            />
          ) : null}
        </div>
      </Panel>

      <Panel title="Sequence Prep" icon={<ListTree size={17} />}>
        <div className="form-grid">
          <label>
            Image type
            <select
              value={sequencePlan.imageType}
              onChange={(event) => onSequencePlanChange({ imageType: event.target.value })}
            >
              <option value="Light">Light</option>
              <option value="Dark">Dark</option>
              <option value="Flat">Flat</option>
              <option value="Bias">Bias</option>
              <option value="DarkFlat">DarkFlat</option>
            </select>
          </label>
          <label>
            Exposure seconds
            <input
              type="number"
              min="1"
              step="1"
              value={sequencePlan.exposureSeconds}
              onChange={(event) => onSequencePlanChange({ exposureSeconds: Number(event.target.value) })}
            />
          </label>
          <label>
            Frame count
            <input
              type="number"
              min="1"
              step="1"
              value={sequencePlan.frameCount}
              onChange={(event) => onSequencePlanChange({ frameCount: Number(event.target.value) })}
            />
          </label>
          <label>
            Gain
            <input
              type="number"
              min="0"
              step="1"
              value={sequencePlan.gain}
              onChange={(event) => onSequencePlanChange({ gain: Number(event.target.value) })}
            />
          </label>
          <label>
            Offset
            <input
              type="number"
              min="0"
              step="1"
              value={sequencePlan.offset}
              onChange={(event) => onSequencePlanChange({ offset: Number(event.target.value) })}
            />
          </label>
          <label>
            Camera temp
            <input
              type="number"
              step="1"
              value={sequencePlan.temperatureC}
              onChange={(event) => onSequencePlanChange({ temperatureC: Number(event.target.value) })}
            />
          </label>
          <label>
            Centering tolerance
            <input
              type="number"
              min="1"
              step="1"
              value={sequencePlan.centeringToleranceArcsec}
              onChange={(event) => onSequencePlanChange({ centeringToleranceArcsec: Number(event.target.value) })}
            />
          </label>
        </div>
        <div className="check-row">
          <label>
            <input
              checked={sequencePlan.autofocusBeforeRun}
              type="checkbox"
              onChange={(event) => onSequencePlanChange({ autofocusBeforeRun: event.target.checked })}
            />
            Autofocus before run
          </label>
          <label>
            <input
              checked={sequencePlan.guidingRequired}
              type="checkbox"
              onChange={(event) => onSequencePlanChange({ guidingRequired: event.target.checked })}
            />
            Guiding required
          </label>
          <label>
            <input
              checked={sequencePlan.dither}
              type="checkbox"
              onChange={(event) => onSequencePlanChange({ dither: event.target.checked })}
            />
            Dither
          </label>
        </div>
        <div className="notes-row">
          <label>
            Notes
            <textarea
              value={sequencePlan.notes}
              rows={3}
              onChange={(event) => onSequencePlanChange({ notes: event.target.value })}
            />
          </label>
        </div>
        <DataTable
          rows={[
            ['Integration', formatDuration(totalIntegration)],
            ['Estimated duration', formatDuration(estimatedDuration)],
            ['Subframes', `${sequencePlan.frameCount} x ${sequencePlan.exposureSeconds}s`],
            ['Cooling', `${sequencePlan.temperatureC} C`],
            ['Centering', `${sequencePlan.centeringToleranceArcsec} arcsec`],
            ['Storage root', sessionRoot || 'Relative preview'],
            ['Folder', storageClient.sessionFolderPath(sessionRoot, target, sequencePlan)],
            ['First file', storageClient.firstFrameDestinationPath(sessionRoot, target, sequencePlan)]
          ]}
        />
        <div className="button-row">
          <button type="button" disabled={storageBusy || !tauriClient.isDesktopRuntime()} onClick={() => void onChooseSessionRoot()}>
            <Save size={16} />
            Choose Folder
          </button>
          <button type="button" disabled={storageBusy || !sessionRoot} onClick={() => void onClearSessionRoot()}>
            Clear Folder
          </button>
          <button type="button" disabled={!target} onClick={onAddToQueue}>
            <Save size={16} />
            Add To Tonight
          </button>
          <button type="button" disabled>
            <Play size={16} />
            Run Now
          </button>
        </div>
      </Panel>

      <Panel title="Tonight" icon={<Save size={17} />}>
        {queue.length ? (
          <>
            <div className="queue-list">
              {queue.map((item, index) => (
                <div className={activeQueueId === item.id ? 'queue-row active' : 'queue-row'} key={item.id}>
                  <div className="queue-index">{index + 1}</div>
                  <div className="queue-main">
                    <div className="queue-title">{item.target.name}</div>
                    <div className="queue-detail">
                      {item.plan.imageType} | {item.plan.frameCount} x {item.plan.exposureSeconds}s | {formatDuration(integrationSeconds(item.plan))} | {storageClient.firstFrameDestinationPath(sessionRoot, item.target, item.plan)} | {item.createdAt}
                    </div>
                  </div>
                  <div className="queue-actions">
                    <button type="button" onClick={() => onSetActiveQueueItem(item.id)}>Set Active</button>
                    <button type="button" onClick={() => onRemoveQueueItem(item.id)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="button-row">
              <button type="button" onClick={onClearQueue}>Clear Tonight</button>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <Save size={18} />
            No targets queued.
          </div>
        )}
      </Panel>
    </div>
  );
}

function GuidingPanel({ status, message }: { status: Phd2Status | null; message: string }) {
  const samples = status?.samples.slice(-90) ?? [];
  const latest = samples.at(-1);
  const errorFor = (sample: PhdGuideSample) => Math.sqrt(sample.dx ** 2 + sample.dy ** 2);
  const scale = Math.max(1, ...samples.flatMap((sample) => [Math.abs(sample.dx), Math.abs(sample.dy), errorFor(sample)]));
  const width = 720;
  const height = 190;
  const midY = height / 2;
  const xStep = samples.length > 1 ? width / (samples.length - 1) : width;
  const yFor = (value: number) => midY - (value / scale) * (height * 0.42);
  const pointsFor = (key: 'dx' | 'dy') =>
    samples.map((sample, index) => `${(index * xStep).toFixed(1)},${yFor(sample[key]).toFixed(1)}`).join(' ');
  const totalPoints = samples
    .map((sample, index) => `${(index * xStep).toFixed(1)},${yFor(errorFor(sample)).toFixed(1)}`)
    .join(' ');
  const rmsFor = (values: number[]) => (values.length ? Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0) / values.length) : 0);
  const raRms = rmsFor(samples.map((sample) => sample.dx));
  const decRms = rmsFor(samples.map((sample) => sample.dy));
  const totalRms = samples.length ? Math.sqrt(raRms ** 2 + decRms ** 2) : 0;
  const latestAgeSeconds = status?.lastEventAt ? Math.max(0, (Date.now() - new Date(status.lastEventAt).getTime()) / 1000) : null;
  const statusText = status?.connected ? status.appState || 'Connected' : message || status?.error || 'Disconnected';
  const statusClass = status?.connected ? `guide-state ${status.appState.toLowerCase()}` : 'guide-state disconnected';

  return (
    <div className="guiding-panel">
      <div className="guide-status-row">
        <div className={statusClass}>{statusText}</div>
        <div>{status?.version || 'PHD2'}</div>
        <div>{status?.lastEvent || 'No events'}</div>
        <div>{latestAgeSeconds === null ? '-' : `${latestAgeSeconds.toFixed(0)}s ago`}</div>
      </div>
      <div className="guide-metrics">
        <div>
          <span>Total RMS</span>
          <strong>{samples.length ? `${totalRms.toFixed(2)} px` : '-'}</strong>
        </div>
        <div>
          <span>RA RMS</span>
          <strong>{samples.length ? `${raRms.toFixed(2)} px` : '-'}</strong>
        </div>
        <div>
          <span>Dec RMS</span>
          <strong>{samples.length ? `${decRms.toFixed(2)} px` : '-'}</strong>
        </div>
        <div>
          <span>SNR / HFD</span>
          <strong>{latest ? `${formatOptional(latest.snr)} / ${formatOptional(latest.hfd)}` : '-'}</strong>
        </div>
      </div>
      <div className="guide-graph" aria-label="PHD2 guiding graph">
        <svg viewBox={`0 0 ${width} ${height}`} role="img">
          <line className="guide-grid-line guide-midline" x1="0" x2={width} y1={midY} y2={midY} />
          <line className="guide-grid-line" x1="0" x2={width} y1={yFor(scale)} y2={yFor(scale)} />
          <line className="guide-grid-line" x1="0" x2={width} y1={yFor(-scale)} y2={yFor(-scale)} />
          {samples.length > 1 ? (
            <>
              <polyline className="guide-line guide-ra" points={pointsFor('dx')} />
              <polyline className="guide-line guide-dec" points={pointsFor('dy')} />
              <polyline className="guide-line guide-total" points={totalPoints} />
            </>
          ) : null}
        </svg>
        <div className="guide-legend">
          <span><i className="guide-key guide-key-ra" />RA</span>
          <span><i className="guide-key guide-key-dec" />Dec</span>
          <span><i className="guide-key guide-key-total" />Total</span>
          <span>{`+/-${scale.toFixed(1)} px`}</span>
        </div>
      </div>
      <div className="guide-detail-row">
        <span>{latest ? `Latest ${latest.dx.toFixed(2)} / ${latest.dy.toFixed(2)} px` : 'Waiting for guide samples'}</span>
        <span>{latest?.raDuration ? `RA ${latest.raDuration.toFixed(0)}ms ${latest.raDirection ?? ''}` : 'RA pulse -'}</span>
        <span>{latest?.decDuration ? `Dec ${latest.decDuration.toFixed(0)}ms ${latest.decDirection ?? ''}` : 'Dec pulse -'}</span>
        <span>{samples.length ? `${samples.length} samples` : 'No samples'}</span>
      </div>
    </div>
  );
}

function formatOptional(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : value.toFixed(2);
}

function PipelinePanel({ pipelineState }: { pipelineState: AcquisitionPipelineState }) {
  const [detailTab, setDetailTab] = useState<PipelineDetailTab>('recent');
  const [copyMessage, setCopyMessage] = useState('');
  const latest = pipelineState.history[0];
  const agentStatus = pipelineState.health?.status || pipelineState.message;
  const agentClass = pipelineState.failed.length
    ? 'pipeline-state error'
    : pipelineState.health?.status
      ? 'pipeline-state ok'
      : 'pipeline-state warn';
  const latestDestination = latest?.destinationPath || '';

  const copyLatestDestination = async () => {
    if (!latestDestination) {
      return;
    }

    try {
      await navigator.clipboard.writeText(latestDestination);
      setCopyMessage('Copied');
      window.setTimeout(() => setCopyMessage(''), 1800);
    } catch {
      setCopyMessage('Copy failed');
      window.setTimeout(() => setCopyMessage(''), 1800);
    }
  };

  return (
    <div className="pipeline-panel">
      <div className="pipeline-strip">
        <div className={agentClass}>
          <span>Agent</span>
          <strong>{agentStatus}</strong>
        </div>
        <div>
          <span>Auto</span>
          <strong>{pipelineState.autoTransfer ? 'On' : 'Off'}</strong>
        </div>
        <div>
          <span>Pending</span>
          <strong>{pipelineState.pending.length}</strong>
        </div>
        <div className={pipelineState.failed.length ? 'pipeline-state error' : undefined}>
          <span>Failed</span>
          <strong>{pipelineState.failed.length}</strong>
        </div>
        <div>
          <span>Delivered</span>
          <strong>{pipelineState.health?.deliveredFrames ?? '-'}</strong>
        </div>
        <div>
          <span>Checked</span>
          <strong>{pipelineState.checkedAt}</strong>
        </div>
      </div>

      <div className="pipeline-destination">
        <span>Latest destination</span>
        <strong title={latestDestination || undefined}>{latestDestination || '-'}</strong>
        <button type="button" disabled={!latestDestination} onClick={() => void copyLatestDestination()}>
          {copyMessage || 'Copy'}
        </button>
      </div>

      <div className="monitor-tabs pipeline-tabs">
        {([
          ['recent', `Recent ${pipelineState.history.length}`],
          ['pending', `Pending ${pipelineState.pending.length}`],
          ['failed', `Failed ${pipelineState.failed.length}`]
        ] as const).map(([key, label]) => (
          <button
            className={detailTab === key ? 'monitor-tab active' : 'monitor-tab'}
            key={key}
            type="button"
            onClick={() => setDetailTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {detailTab === 'recent' ? (
        pipelineState.history.length ? (
          <div className="frame-list compact-frame-list">
            {pipelineState.history.map((item) => (
              <div className="frame-row pipeline-history-row" key={`${item.id}-${item.transferredAt}`}>
                <span>{item.transferredAt}</span>
                <strong title={item.destinationPath}>{item.fileName}</strong>
                <em>{formatBytes(item.sizeBytes)}</em>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Save size={18} />
            No transfer history yet.
          </div>
        )
      ) : null}

      {detailTab === 'pending' ? (
        pipelineState.pending.length ? (
          <div className="frame-list compact-frame-list">
            {pipelineState.pending.slice(0, 8).map((frame) => (
              <div className="frame-row pipeline-pending-row" key={frame.id}>
                <span>{frame.imageType}</span>
                <strong title={frame.sourcePath}>{frame.fileName}</strong>
                <em>{formatBytes(frame.sizeBytes)}</em>
              </div>
            ))}
            {pipelineState.pending.length > 8 ? <div className="frame-more">+{pipelineState.pending.length - 8} more pending</div> : null}
          </div>
        ) : (
          <div className="empty-state">
            <Save size={18} />
            No pending frames.
          </div>
        )
      ) : null}

      {detailTab === 'failed' ? (
        pipelineState.failed.length ? (
          <div className="frame-list failed-frame-list compact-frame-list">
            {pipelineState.failed.slice(0, 8).map((frame) => (
              <div className="frame-row pipeline-failed-row" key={frame.id}>
                <span>{frame.imageType}</span>
                <strong title={frame.error || frame.sourcePath}>{frame.fileName}</strong>
                <em>{frame.error || 'failed'}</em>
              </div>
            ))}
            {pipelineState.failed.length > 8 ? <div className="frame-more">+{pipelineState.failed.length - 8} more failed</div> : null}
          </div>
        ) : (
          <div className="empty-state">
            <Save size={18} />
            No failed transfers.
          </div>
        )
      ) : null}
    </div>
  );
}

function AcquisitionTab({
  equipment,
  activeItem,
  queue,
  sessionRoot,
  acquisitionEvents,
  onSetActiveQueueItem
}: {
  equipment: EquipmentInfo | null;
  activeItem: QueueItem | null;
  queue: QueueItem[];
  sessionRoot: string | null;
  acquisitionEvents: AcquisitionEvent[];
  onSetActiveQueueItem: (id: string) => void;
}) {
  const camera = equipment?.Camera;
  const plan = activeItem?.plan;
  const totalIntegration = plan ? integrationSeconds(plan) : 0;
  const estimatedDuration = plan ? totalIntegration + (plan.autofocusBeforeRun ? 180 : 0) + (plan.guidingRequired ? 90 : 0) : 0;
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);
  const [stretch, setStretch] = useState<StretchSettings>(defaultStretch);
  const [renderStretch, setRenderStretch] = useState<StretchSettings>(defaultStretch);
  const [fitsAutoStretch, setFitsAutoStretch] = useState(true);
  const [testExposureSeconds, setTestExposureSeconds] = useState(1);
  const [testExposureGain, setTestExposureGain] = useState(camera?.Gain ?? 200);
  const [testExposureType, setTestExposureType] = useState('SNAPSHOT');
  const [captureRunning, setCaptureRunning] = useState(false);
  const [captureMessage, setCaptureMessage] = useState('');
  const [captureStats, setCaptureStats] = useState<CaptureStats | null>(null);
  const [monitorTab, setMonitorTab] = useState<AcquisitionMonitorTab>('preview');
  const [phdStatus, setPhdStatus] = useState<Phd2Status | null>(null);
  const [phdMessage, setPhdMessage] = useState('');
  const [sequenceRun, setSequenceRun] = useState<SequenceRunState>(defaultSequenceRun);
  const [pipelineState, setPipelineState] = useState<AcquisitionPipelineState>({
    health: null,
    pending: [],
    failed: [],
    history: [],
    autoTransfer: loadAutoTransferEnabled(),
    message: 'Not checked',
    checkedAt: '-'
  });
  const sequenceAbortRef = useRef(false);
  const plannedFrames = useMemo(() => {
    if (!activeItem || !plan) {
      return [];
    }

    return storageClient.plannedFramePaths(activeItem.target, plan, 18, sessionRoot);
  }, [activeItem, plan, sessionRoot]);
  const hiddenPlannedFrameCount = plan ? Math.max(0, plan.frameCount - plannedFrames.length) : 0;

  useEffect(() => {
    let cancelled = false;

    const pollPhd = async () => {
      try {
        const status = await phd2Client.getStatus();

        if (!cancelled) {
          setPhdStatus(status);
          setPhdMessage('');
        }
      } catch (caught) {
        if (!cancelled) {
          setPhdMessage(caught instanceof Error ? caught.message : 'Unable to reach PHD2 monitor.');
        }
      }
    };

    void pollPhd();
    const intervalId = window.setInterval(() => void pollPhd(), 2000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refreshPipelineState = async () => {
      const storedAgent = settingsClient.loadJson(frameAgentStorageKey, { base: frameTransferClient.defaultAgentBase });
      const agentBase = typeof storedAgent.base === 'string' ? storedAgent.base : frameTransferClient.defaultAgentBase;
      const storedHistory = settingsClient.loadJson(transferHistoryStorageKey, { items: [] as TransferHistoryItem[] });
      const history = Array.isArray(storedHistory.items) ? storedHistory.items.slice(0, 5) : [];
      const autoTransfer = loadAutoTransferEnabled();

      try {
        frameTransferClient.setAgentBase(agentBase);
        const [health, pending, failed] = await Promise.all([
          frameTransferClient.getHealth(),
          frameTransferClient.getPendingFrames(),
          frameTransferClient.getFailedFrames()
        ]);

        if (cancelled) {
          return;
        }

        setPipelineState({
          health,
          pending,
          failed,
          history,
          autoTransfer,
          message: 'Agent reachable',
          checkedAt: new Date().toLocaleTimeString()
        });
      } catch (caught) {
        if (cancelled) {
          return;
        }

        setPipelineState((current) => ({
          ...current,
          history,
          autoTransfer,
          message: caught instanceof Error ? caught.message : 'Unable to reach Starrunner Agent.',
          checkedAt: new Date().toLocaleTimeString()
        }));
      }
    };

    void refreshPipelineState();
    const intervalId = window.setInterval(() => void refreshPipelineState(), 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (fitsAutoStretch) {
      setRenderStretch(stretch);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setRenderStretch(stretch);
    }, 120);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [fitsAutoStretch, stretch]);

  useEffect(() => {
    const latestFrame = pipelineState.history[0];

    if (!latestFrame?.destinationPath || !latestFrame.fileName.toLowerCase().match(/\.fits?$/)) {
      return undefined;
    }

    let cancelled = false;

    const renderLatestFits = async () => {
      try {
        const preview = await storageClient.renderFitsPreview(latestFrame.destinationPath, renderStretch, fitsAutoStretch);

        if (!preview || cancelled) {
          return;
        }

        if (fitsAutoStretch) {
          setStretch({
            blackPoint: Math.max(0, Math.round(preview.black_point)),
            midtone: Number(preview.midtone.toFixed(2)),
            whitePoint: Math.max(1, Math.round(preview.white_point))
          });
        }

        setPreviewImage({
          name: latestFrame.fileName,
          sizeBytes: latestFrame.sizeBytes,
          type: 'image/bmp',
          dataUrl: preview.data_url,
          width: preview.width,
          height: preview.height,
          sourcePath: preview.source_path,
          sourceKind: 'fits'
        });
      } catch (caught) {
        if (!cancelled) {
          setCaptureMessage(caught instanceof Error ? caught.message : 'Unable to render FITS preview.');
        }
      }
    };

    void renderLatestFits();

    return () => {
      cancelled = true;
    };
  }, [
    pipelineState.history[0]?.destinationPath,
    pipelineState.history[0]?.fileName,
    pipelineState.history[0]?.sizeBytes,
    renderStretch.blackPoint,
    renderStretch.midtone,
    renderStretch.whitePoint,
    fitsAutoStretch
  ]);

  const handlePreviewFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        return;
      }

      setPreviewImage({
        name: file.name,
        sizeBytes: file.size,
        type: file.type || 'image',
        dataUrl: reader.result,
        sourceKind: 'bitmap'
      });
      setFitsAutoStretch(false);
    };
    reader.readAsDataURL(file);
  };

  const updateStretch = (key: keyof StretchSettings, value: number) => {
    setFitsAutoStretch(false);
    setStretch((current) => ({ ...current, [key]: value }));
  };

  const setAutoStretch = () => {
    if (previewImage?.sourceKind === 'fits') {
      setFitsAutoStretch(true);
    } else {
      setStretch({
        blackPoint: 600,
        midtone: 1.45,
        whitePoint: 42000
      });
      setRenderStretch({
        blackPoint: 600,
        midtone: 1.45,
        whitePoint: 42000
      });
    }
  };

  const runTestExposure = async () => {
    if (captureRunning) {
      if (!window.confirm('Abort the active test exposure?')) {
        return;
      }

      try {
        const { response, body } = await ninaClient.abortExposure();

        if (!response.ok || !body.Success) {
          throw new Error(body.Error || `Abort failed with HTTP ${response.status}.`);
        }

        setCaptureMessage(body.Response || 'Exposure aborted.');
      } catch (caught) {
        setCaptureMessage(caught instanceof Error ? caught.message : 'Exposure abort failed.');
      } finally {
        setCaptureRunning(false);
      }
      return;
    }

    if (!Number.isFinite(testExposureSeconds) || testExposureSeconds <= 0 || testExposureSeconds > 30) {
      setCaptureMessage('Test exposure must be between 0.1s and 30s.');
      return;
    }

    if (!Number.isFinite(testExposureGain) || testExposureGain < 0) {
      setCaptureMessage('Gain must be zero or greater.');
      return;
    }

    if (!window.confirm(`Take a ${testExposureSeconds}s preview exposure? This will not save a file.`)) {
      return;
    }

    setCaptureRunning(true);
    setCaptureMessage('Capturing preview exposure...');
    setCaptureStats(null);

    try {
      const timeoutMs = Math.max(30000, Math.round(testExposureSeconds * 1000) + 60000);
      const response = await ninaClient.capturePreview({
        duration: testExposureSeconds,
        gain: testExposureGain,
        imageType: testExposureType,
        targetName: activeItem?.target.name || 'Test Exposure',
        resize: true,
        scale: 0.35,
        quality: -1
      }, timeoutMs);

      if (!response.ok) {
        let detail = `Capture failed with HTTP ${response.status}.`;
        try {
          const body = (await response.json()) as ApiEnvelope<string>;
          detail = body.Error || body.Response || detail;
        } catch {
          // keep HTTP detail
        }
        throw new Error(detail);
      }

      const blob = await response.blob();
      const dataUrl = await blobToDataUrl(blob);
      const capturedAt = new Date().toLocaleTimeString().replace(/:/g, '-');

      setPreviewImage({
        name: `test-exposure-${capturedAt}.png`,
        sizeBytes: blob.size,
        type: blob.type || 'image/png',
        dataUrl,
        sourceKind: 'bitmap'
      });
      setFitsAutoStretch(false);
      setCaptureMessage('Preview exposure complete.');

      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          if (attempt > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, 1200));
          }

          const { response: statsResponse, body: statsJson } = await ninaClient.getCaptureStatistics<CaptureStats>();

          if (statsResponse.ok && statsJson.Success && statsJson.Response && typeof statsJson.Response === 'object') {
            setCaptureStats(statsJson.Response);
            break;
          }
        } catch {
          if (attempt === 4) {
            setCaptureStats(null);
          }
        }
      }
    } catch (caught) {
      setCaptureMessage(caught instanceof Error ? caught.message : 'Preview exposure failed.');
    } finally {
      setCaptureRunning(false);
    }
  };

  const runActivePlanCapture = async () => {
    if (sequenceRun.running) {
      if (!window.confirm('Abort the active capture run?')) {
        return;
      }

      sequenceAbortRef.current = true;
      setSequenceRun((current) => ({ ...current, message: 'Aborting after current exposure...' }));

      try {
        await ninaClient.abortExposure();
      } catch {
        // NINA may already be idle. The loop still observes the abort flag.
      }
      return;
    }

    if (!activeItem || !plan) {
      setSequenceRun({ ...defaultSequenceRun, message: 'Select an active target first.' });
      return;
    }

    if (!camera?.Connected) {
      setSequenceRun({ ...defaultSequenceRun, message: 'Camera is not connected.' });
      return;
    }

    if (!Number.isFinite(plan.frameCount) || plan.frameCount < 1 || plan.frameCount > 500) {
      setSequenceRun({ ...defaultSequenceRun, message: 'Frame count must be between 1 and 500.' });
      return;
    }

    if (!Number.isFinite(plan.exposureSeconds) || plan.exposureSeconds <= 0 || plan.exposureSeconds > 2000) {
      setSequenceRun({ ...defaultSequenceRun, message: 'Exposure must be between 0.1s and 2000s.' });
      return;
    }

    const confirmation = [
      `Start saved capture run for ${activeItem.target.name}?`,
      `${plan.frameCount} x ${plan.exposureSeconds}s ${plan.imageType}`,
      'This will save FITS files on Starrunner.'
    ].join('\n');

    if (!window.confirm(confirmation)) {
      return;
    }

    sequenceAbortRef.current = false;
    setSequenceRun({
      running: true,
      currentFrame: 0,
      totalFrames: plan.frameCount,
      message: 'Starting capture run...',
      startedAt: new Date().toLocaleTimeString(),
      completedAt: '-'
    });

    try {
      for (let frameNumber = 1; frameNumber <= plan.frameCount; frameNumber += 1) {
        if (sequenceAbortRef.current) {
          break;
        }

        setSequenceRun((current) => ({
          ...current,
          currentFrame: frameNumber,
          message: `Capturing frame ${frameNumber} of ${plan.frameCount}...`
        }));

        const timeoutMs = Math.max(30000, Math.round(plan.exposureSeconds * 1000) + 120000);
        const { response, body } = await ninaClient.captureSavedFrame({
          duration: plan.exposureSeconds,
          gain: plan.gain,
          offset: plan.offset,
          imageType: plan.imageType.toUpperCase(),
          targetName: activeItem.target.name
        }, timeoutMs);

        if (!response.ok || !body.Success) {
          throw new Error(body.Error || body.Response || `Capture failed with HTTP ${response.status}.`);
        }
      }

      setSequenceRun((current) => ({
        ...current,
        running: false,
        message: sequenceAbortRef.current ? 'Capture run aborted.' : 'Capture run complete.',
        completedAt: new Date().toLocaleTimeString()
      }));
    } catch (caught) {
      setSequenceRun((current) => ({
        ...current,
        running: false,
        message: caught instanceof Error ? caught.message : 'Capture run failed.',
        completedAt: new Date().toLocaleTimeString()
      }));
    } finally {
      sequenceAbortRef.current = false;
    }
  };

  const runProgress = sequenceRun.totalFrames ? `${sequenceRun.currentFrame} / ${sequenceRun.totalFrames}` : '-';
  const activeSummary = activeItem && plan
    ? `${activeItem.target.name} | ${plan.imageType} | ${plan.frameCount} x ${plan.exposureSeconds}s`
    : 'No active target';

  return (
    <>
      <section className="run-bar">
        <div className="run-main">
          <strong>{activeSummary}</strong>
          <span>{sequenceRun.message}</span>
        </div>
        <div className="run-metrics">
          <span>Frame {runProgress}</span>
          <span>{camera?.CameraState || 'Camera unknown'}</span>
          <span>{formatTemp(camera?.Temperature)}</span>
          <span>Pending {pipelineState.pending.length}</span>
          <span>Failed {pipelineState.failed.length}</span>
          <span>{pipelineState.autoTransfer ? 'Auto-transfer on' : 'Auto-transfer off'}</span>
        </div>
        <button
          className={sequenceRun.running ? 'capture-button active' : 'capture-button'}
          type="button"
          disabled={!activeItem || !camera?.Connected}
          onClick={() => void runActivePlanCapture()}
        >
          {sequenceRun.running ? <CircleStop size={16} /> : <Play size={16} />}
          {sequenceRun.running ? 'Abort Run' : 'Start Run'}
        </button>
      </section>

      <div className="tab-grid acquisition-grid">
      <Panel title="Acquisition Monitor" icon={<Aperture size={17} />}>
        <div className="monitor-tabs">
          {[
            ['preview', 'Preview'],
            ['guiding', 'Guiding'],
            ['stretch', 'Stretch'],
            ['stats', 'Stats'],
            ['recent', 'Recent'],
            ['planned', 'Planned']
          ].map(([key, label]) => (
            <button
              className={monitorTab === key ? 'monitor-tab active' : 'monitor-tab'}
              key={key}
              type="button"
              onClick={() => setMonitorTab(key as AcquisitionMonitorTab)}
            >
              {label}
            </button>
          ))}
        </div>

        {monitorTab === 'preview' ? (
          <>
            <div className={previewImage ? 'preview-box has-image' : 'preview-box'}>
              {previewImage ? (
                <img
                  alt={previewImage.name}
                  src={previewImage.dataUrl}
                  style={{ filter: previewImage.sourceKind === 'fits' ? 'none' : stretchFilter(stretch) }}
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    setPreviewImage((current) =>
                      current && current.dataUrl === previewImage.dataUrl
                        ? { ...current, width: image.naturalWidth, height: image.naturalHeight }
                        : current
                    );
                  }}
                />
              ) : (
                <div>No frame loaded</div>
              )}
            </div>
            <div className="button-row">
              <label className="file-button">
                Load Preview Image
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePreviewFile} />
              </label>
              <button type="button" onClick={() => setPreviewImage(null)} disabled={!previewImage}>
                Clear
              </button>
              <div className="preview-file-name">{previewImage?.name || pipelineState.history[0]?.fileName || 'Waiting for frame'}</div>
            </div>
            <div className="stretch-inline">
              <label>
                Black
                <input
                  type="range"
                  min="0"
                  max="5000"
                  step="10"
                  value={stretch.blackPoint}
                  onChange={(event) => updateStretch('blackPoint', Number(event.target.value))}
                />
                <span>{stretch.blackPoint}</span>
              </label>
              <label>
                Mid
                <input
                  type="range"
                  min="0.5"
                  max="3"
                  step="0.05"
                  value={stretch.midtone}
                  onChange={(event) => updateStretch('midtone', Number(event.target.value))}
                />
                <span>{stretch.midtone.toFixed(2)}</span>
              </label>
              <label>
                White
                <input
                  type="range"
                  min="100"
                  max="65535"
                  step="10"
                  value={stretch.whitePoint}
                  onChange={(event) => updateStretch('whitePoint', Number(event.target.value))}
                />
                <span>{stretch.whitePoint}</span>
              </label>
              <button type="button" onClick={setAutoStretch}>Auto</button>
              <button type="button" onClick={() => setStretch(defaultStretch)}>Reset</button>
            </div>
          </>
        ) : null}

        {monitorTab === 'guiding' ? (
          <GuidingPanel status={phdStatus} message={phdMessage} />
        ) : null}

        {monitorTab === 'stretch' ? (
          <>
            <div className="stretch-stack">
              <label>
                Black point
                <input
                  type="range"
                  min="0"
                  max="5000"
                  step="10"
                  value={stretch.blackPoint}
                  onChange={(event) => updateStretch('blackPoint', Number(event.target.value))}
                />
                <span>{stretch.blackPoint}</span>
              </label>
              <label>
                Midtone
                <input
                  type="range"
                  min="0.5"
                  max="3"
                  step="0.05"
                  value={stretch.midtone}
                  onChange={(event) => updateStretch('midtone', Number(event.target.value))}
                />
                <span>{stretch.midtone.toFixed(2)}</span>
              </label>
              <label>
                White point
                <input
                  type="range"
                  min="100"
                  max="65535"
                  step="10"
                  value={stretch.whitePoint}
                  onChange={(event) => updateStretch('whitePoint', Number(event.target.value))}
                />
                <span>{stretch.whitePoint}</span>
              </label>
            </div>
            <div className="button-row">
              <button type="button" onClick={setAutoStretch}>Auto Stretch</button>
              <button type="button" onClick={() => setStretch(defaultStretch)}>Reset</button>
            </div>
          </>
        ) : null}

        {monitorTab === 'stats' ? (
          <DataTable
            rows={[
              ['Loaded file', previewImage?.name],
              ['File type', previewImage?.type],
              ['File size', previewImage ? formatBytes(previewImage.sizeBytes) : undefined],
              ['Image size', previewImage?.width && previewImage.height ? `${previewImage.width} x ${previewImage.height}` : undefined],
              ['Median ADU', captureStats?.Median ?? 'Not computed'],
              ['Mean ADU', captureStats?.Mean ?? 'Not computed'],
              ['Min / Max', captureStats ? `${formatValue(captureStats.Min)} / ${formatValue(captureStats.Max)}` : 'Not computed'],
              ['Star count', captureStats?.Stars ?? 'Not computed'],
              ['HFR', captureStats?.HFR ?? 'Not computed'],
              ['StDev', captureStats?.StDev ?? 'Not computed']
            ]}
          />
        ) : null}

        {monitorTab === 'recent' ? (
          acquisitionEvents.length ? (
            <div className="acquisition-event-list">
              {acquisitionEvents.map((event) => (
                <div className="acquisition-event-row" key={event.id}>
                  <time>{event.receivedAt}</time>
                  <div>
                    <strong>{event.event}</strong>
                    <span>{event.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <ListTree size={18} />
              Waiting for capture and image events.
            </div>
          )
        ) : null}

        {monitorTab === 'planned' ? (
          plannedFrames.length ? (
            <div className="frame-list">
              {plannedFrames.map((frame) => (
                <div className="frame-row" key={frame.path}>
                  <span>{frame.number}</span>
                  <strong>{frame.path}</strong>
                  <em>{frame.status}</em>
                </div>
              ))}
              {hiddenPlannedFrameCount ? <div className="frame-more">+{hiddenPlannedFrameCount} more planned</div> : null}
            </div>
          ) : (
            <div className="empty-state">
              <Save size={18} />
              Select a queued target to preview expected files.
            </div>
          )
        ) : null}
      </Panel>

      <Panel title="Guiding" icon={<Crosshair size={17} />}>
        <GuidingPanel status={phdStatus} message={phdMessage} />
      </Panel>

      <Panel title="Test Exposure" icon={<Camera size={17} />}>
        <div className="form-grid">
          <label>
            Exposure seconds
            <input
              type="number"
              value={testExposureSeconds}
              min="0.1"
              max="30"
              step="0.1"
              onChange={(event) => setTestExposureSeconds(Number(event.target.value))}
            />
          </label>
          <label>
            Gain
            <input
              type="number"
              value={testExposureGain}
              min="0"
              step="1"
              onChange={(event) => setTestExposureGain(Number(event.target.value))}
            />
          </label>
          <label>
            Image type
            <select value={testExposureType} onChange={(event) => setTestExposureType(event.target.value)}>
              <option value="SNAPSHOT">Snapshot</option>
              <option value="LIGHT">Light</option>
              <option value="DARK">Dark</option>
              <option value="BIAS">Bias</option>
              <option value="FLAT">Flat</option>
            </select>
          </label>
        </div>
        <DataTable
          rows={[
            ['Mode', 'Preview only'],
            ['Saved by NINA', 'No'],
            ['Status', captureMessage || (captureRunning ? 'Capturing' : 'Idle')]
          ]}
        />
        <div className="button-row">
          <button
            className={captureRunning ? 'capture-button active' : 'capture-button'}
            type="button"
            disabled={!camera?.Connected}
            onClick={() => void runTestExposure()}
          >
            <Aperture size={16} />
            {captureRunning ? 'Abort Exposure' : 'Test Exposure'}
          </button>
          <div className="inline-note">Streams a PNG preview. No FITS file is saved.</div>
        </div>
      </Panel>

      <Panel title="Active Plan" icon={<Play size={17} />}>
        <DataTable
          rows={[
            ['Target', activeItem?.target.name],
            ['Image type', plan?.imageType],
            ['Rotation', activeItem ? `${activeItem.target.rotationDegrees}°` : undefined],
            ['Exposure', plan ? `${plan.exposureSeconds}s` : undefined],
            ['Frames', plan?.frameCount],
            ['Integration', plan ? formatDuration(totalIntegration) : undefined],
            ['Estimated duration', plan ? formatDuration(estimatedDuration) : undefined],
            ['Gain', plan?.gain],
            ['Offset', plan?.offset],
            ['Camera temp', plan ? `${plan.temperatureC} C` : undefined],
            ['Autofocus', plan?.autofocusBeforeRun],
            ['Guiding', plan?.guidingRequired],
            ['Dither', plan?.dither],
            ['Storage root', sessionRoot || 'Relative preview'],
            ['Folder', activeItem && plan ? storageClient.sessionFolderPath(sessionRoot, activeItem.target, plan) : undefined],
            ['First file', activeItem && plan ? storageClient.firstFrameDestinationPath(sessionRoot, activeItem.target, plan) : undefined]
          ]}
        />
        <div className="button-row">
          <button
            className={sequenceRun.running ? 'capture-button active' : 'capture-button'}
            type="button"
            disabled={!activeItem || !camera?.Connected}
            onClick={() => void runActivePlanCapture()}
          >
            {sequenceRun.running ? <CircleStop size={16} /> : <Play size={16} />}
            {sequenceRun.running ? 'Abort Capture Run' : 'Start Capture Run'}
          </button>
          <div className="inline-note">Saved FITS capture only. Slew, center, autofocus, and guiding are not started yet.</div>
        </div>
      </Panel>

      <Panel title="Capture State" icon={<Thermometer size={17} />}>
        <DataTable
          rows={[
            ['Camera state', camera?.CameraState],
            ['Exposing', camera?.IsExposing],
            ['Temperature', formatTemp(camera?.Temperature)],
            ['Cooler power', camera?.CoolerPower === undefined ? undefined : `${camera.CoolerPower.toFixed(1)}%`],
            ['Run progress', sequenceRun.totalFrames ? `${sequenceRun.currentFrame} / ${sequenceRun.totalFrames}` : '-'],
            ['Run status', sequenceRun.message],
            ['Run started', sequenceRun.startedAt],
            ['Run completed', sequenceRun.completedAt],
            ['Last frame', previewImage?.name ?? '-'],
            ['Preview capture', captureRunning ? 'Running' : captureMessage || '-'],
            ['Captured frames', sequenceRun.totalFrames ? sequenceRun.currentFrame : '0'],
            ['Agent pending', pipelineState.pending.length],
            ['Delivered frames', pipelineState.health?.deliveredFrames],
            ['Failed transfers', pipelineState.failed.length]
          ]}
        />
      </Panel>

      <Panel title="Capture Pipeline" icon={<Save size={17} />}>
        <PipelinePanel pipelineState={pipelineState} />
      </Panel>

      <Panel title="Tonight Queue" icon={<ListTree size={17} />}>
        {queue.length ? (
          <div className="queue-list">
            {queue.map((item, index) => (
              <button
                className={activeItem?.id === item.id ? 'queue-select active' : 'queue-select'}
                key={item.id}
                type="button"
                onClick={() => onSetActiveQueueItem(item.id)}
              >
                <span>{index + 1}</span>
                <strong>{item.target.name}</strong>
                <em>{item.plan.imageType} | {item.plan.frameCount} x {item.plan.exposureSeconds}s</em>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <ListTree size={18} />
            Add a target from Targeting to populate acquisition.
          </div>
        )}
      </Panel>
      </div>
    </>
  );
}

function LogsTab({
  events,
  error,
  apiVersion,
  ninaVersion,
  sessionRoot,
  storageBusy,
  onChooseSessionRoot,
  onClearSessionRoot
}: {
  events: NinaEvent[];
  error: string;
  apiVersion: string;
  ninaVersion: string;
  sessionRoot: string | null;
  storageBusy: boolean;
  onChooseSessionRoot: () => Promise<void>;
  onClearSessionRoot: () => Promise<void>;
}) {
  const [diagnostics, setDiagnostics] = useState<DiagnosticResult[]>([]);
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);
  const [diagnosticsRunAt, setDiagnosticsRunAt] = useState('');
  const [capabilities, setCapabilities] = useState<CapabilityResult[]>([]);
  const [capabilitiesRunning, setCapabilitiesRunning] = useState(false);
  const [capabilitiesRunAt, setCapabilitiesRunAt] = useState('');
  const [agentHealth, setAgentHealth] = useState<AgentHealth | null>(null);
  const [pendingFrames, setPendingFrames] = useState<AgentFrame[]>([]);
  const [failedFrames, setFailedFrames] = useState<AgentFrame[]>([]);
  const [agentBaseInput, setAgentBaseInput] = useState(() => {
    const stored = settingsClient.loadJson(frameAgentStorageKey, { base: frameTransferClient.defaultAgentBase });
    return typeof stored.base === 'string' ? stored.base : frameTransferClient.defaultAgentBase;
  });
  const [autoTransferEnabled, setAutoTransferEnabled] = useState(() => loadAutoTransferEnabled());
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferMessage, setTransferMessage] = useState('');
  const [transferRunAt, setTransferRunAt] = useState('');
  const [transferHistory, setTransferHistory] = useState<TransferHistoryItem[]>(() => {
    const stored = settingsClient.loadJson(transferHistoryStorageKey, { items: [] as TransferHistoryItem[] });
    return Array.isArray(stored.items) ? stored.items.slice(0, 25) : [];
  });
  const transferInFlightRef = useRef(false);
  const [runtimeStatus, setRuntimeStatus] = useState({
    shell: tauriClient.isDesktopRuntime() ? 'Tauri desktop' : 'Browser',
    settings: tauriClient.isDesktopRuntime() ? 'Checking' : 'Browser fallback',
    storage: tauriClient.isDesktopRuntime() ? 'Checking' : 'Path preview',
    sessionRoot: '-'
  });
  const diagnosticEndpoints = useMemo(
    () => [
      ['Advanced API', 'version'],
      ['NINA', 'version/nina'],
      ['Equipment Summary', 'equipment/info'],
      ['Camera', 'equipment/camera/info'],
      ['Mount', 'equipment/mount/info'],
      ['Focuser', 'equipment/focuser/info'],
      ['Guider', 'equipment/guider/info']
    ] as Array<[string, string]>,
    []
  );

  useEffect(() => {
    frameTransferClient.setAgentBase(agentBaseInput);
  }, [agentBaseInput]);

  const saveAgentBase = () => {
    const nextBase = agentBaseInput.trim() || frameTransferClient.defaultAgentBase;
    setAgentBaseInput(nextBase);
    frameTransferClient.setAgentBase(nextBase);
    settingsClient.saveJson(frameAgentStorageKey, { base: nextBase });
    setAgentHealth(null);
    setPendingFrames([]);
    setTransferMessage(`Frame agent set to ${nextBase}.`);
  };

  const setAutoTransfer = (enabled: boolean) => {
    setAutoTransferEnabled(enabled);
    settingsClient.saveBoolean(autoTransferStorageKey, enabled);
    setTransferMessage(enabled ? 'Auto transfer enabled.' : 'Auto transfer disabled.');
  };

  useEffect(() => {
    let active = true;

    const refreshRuntimeStatus = async () => {
      if (!tauriClient.isDesktopRuntime()) {
        return;
      }

      const [desktopSettings, storageStatus, defaultRoot] = await Promise.all([
        settingsClient.loadDesktopSettings(),
        storageClient.getStorageStatus(),
        storageClient.getDefaultSessionRoot()
      ]);

      if (!active) {
        return;
      }

      setRuntimeStatus({
        shell: 'Tauri desktop',
        settings: desktopSettings ? 'Tauri command' : 'Tauri command',
        storage: storageStatus ? `${storageStatus.mode}${storageStatus.writable ? ', writable' : ', preview only'}` : 'Unavailable',
        sessionRoot: defaultRoot || storageStatus?.session_root || '-'
      });
    };

    void refreshRuntimeStatus();

    return () => {
      active = false;
    };
  }, []);

  const runDiagnostics = async () => {
    setDiagnosticsRunning(true);
    setDiagnosticsRunAt(new Date().toLocaleTimeString());
    setDiagnostics([
      ...diagnosticEndpoints.map(([name]) => ({ name, status: 'pending' as const, detail: 'waiting' })),
      { name: 'Event WebSocket', status: 'pending', detail: 'waiting' }
    ]);

    const results: DiagnosticResult[] = [];

    for (const [name, path] of diagnosticEndpoints) {
      const result = await runHttpDiagnostic(name, path);
      results.push(result);
      setDiagnostics([
        ...results,
        ...diagnosticEndpoints
          .slice(results.length)
          .map(([pendingName]) => ({ name: pendingName, status: 'pending' as const, detail: 'waiting' })),
        { name: 'Event WebSocket', status: 'pending', detail: 'waiting' }
      ]);
    }

    const socketResult = await runWebSocketDiagnostic();
    setDiagnostics([...results, socketResult]);
    setDiagnosticsRunning(false);
  };

  const runCapabilityDiscovery = async () => {
    setCapabilitiesRunning(true);
    setCapabilitiesRunAt(new Date().toLocaleTimeString());
    setCapabilities(
      capabilityProbes.map((probe) => ({
        name: probe.name,
        status: 'pending',
        detail: 'waiting',
        commandSurface: probe.commandSurface
      }))
    );

    const results: CapabilityResult[] = [];

    for (const probe of capabilityProbes) {
      const result = await runCapabilityProbe(probe);
      results.push(result);
      setCapabilities([
        ...results,
        ...capabilityProbes.slice(results.length).map((pendingProbe) => ({
          name: pendingProbe.name,
          status: 'pending' as const,
          detail: 'waiting',
          commandSurface: pendingProbe.commandSurface
        }))
      ]);
    }

    setCapabilities(results);
    setCapabilitiesRunning(false);
  };

  const refreshFrameAgent = async () => {
    setTransferRunAt(new Date().toLocaleTimeString());
    setTransferMessage('');

    try {
      const [health, frames, failed] = await Promise.all([
        frameTransferClient.getHealth(),
        frameTransferClient.getPendingFrames(),
        frameTransferClient.getFailedFrames()
      ]);

      setAgentHealth(health);
      setPendingFrames(frames);
      setFailedFrames(failed);
    } catch (caught) {
      setTransferMessage(caught instanceof Error ? caught.message : 'Unable to reach Starrunner Agent.');
    }
  };

  const addTransferHistoryItem = (item: TransferHistoryItem) => {
    setTransferHistory((current) => {
      const next = [item, ...current.filter((existing) => existing.id !== item.id)].slice(0, 25);
      settingsClient.saveJson(transferHistoryStorageKey, { items: next });
      return next;
    });
  };

  const writeTransferredFrame = async (frame: AgentFrame) => {
    const blob = await frameTransferClient.downloadFrame(frame.id);
    const localSha = await sha256Hex(blob);

    if (localSha !== frame.sha256.toLowerCase()) {
      throw new Error('Downloaded frame checksum did not match the agent checksum.');
    }

    const sessionFolder = storageClient.sessionFolder(
      { name: frame.targetName },
      { imageType: frame.imageType },
      new Date(frame.createdAt)
    );
    await storageClient.prepareSessionFolder(sessionFolder);
    const result = await storageClient.writeFrame({
      sessionFolder,
      fileName: frame.fileName,
      imageType: frame.imageType,
      targetName: frame.targetName,
      frameNumber: frame.frameNumber,
      capturedAt: frame.createdAt,
      dataBase64: await blobToBase64(blob)
    });

    if (!result) {
      throw new Error('Desktop storage command did not return a write result.');
    }

    if (result.frame.sha256 !== frame.sha256.toLowerCase()) {
      throw new Error('Written frame checksum did not match the agent checksum.');
    }

    await frameTransferClient.acknowledgeFrame(frame.id, frame.sha256);
    addTransferHistoryItem({
      id: frame.id,
      transferredAt: new Date().toLocaleTimeString(),
      targetName: frame.targetName,
      imageType: frame.imageType,
      sourceKind: frame.sourceKind || 'frame',
      fileName: frame.fileName,
      destinationPath: result.frame.path,
      sizeBytes: result.frame.size_bytes,
      sha256: result.frame.sha256
    });
  };

  const transferFrames = async (framesToTransfer: AgentFrame[], mode: 'manual' | 'auto' = 'manual') => {
    if (!framesToTransfer.length) {
      setTransferMessage('No pending frames to transfer.');
      return;
    }

    if (!tauriClient.isDesktopRuntime()) {
      setTransferMessage('Frame transfer writes require the desktop app.');
      return;
    }

    const storageStatus = await storageClient.getStorageStatus();

    if (!storageStatus?.session_root || !storageStatus.writable) {
      setTransferMessage('Choose a writable image destination before transferring frames.');
      return;
    }

    if (transferInFlightRef.current) {
      return;
    }

    transferInFlightRef.current = true;
    setTransferBusy(true);

    try {
      for (const [index, frame] of framesToTransfer.entries()) {
        setTransferMessage(`Transferring ${index + 1} of ${framesToTransfer.length}: ${frame.fileName}`);
        await writeTransferredFrame(frame);
      }

      setTransferMessage(`${mode === 'auto' ? 'Auto transferred' : 'Transferred'} ${framesToTransfer.length} frame${framesToTransfer.length === 1 ? '' : 's'}.`);
      await refreshFrameAgent();
    } catch (caught) {
      setTransferMessage(caught instanceof Error ? caught.message : 'Frame transfer failed.');
    } finally {
      transferInFlightRef.current = false;
      setTransferBusy(false);
    }
  };

  const transferOneFrame = async () => {
    await transferFrames(pendingFrames.slice(0, 1));
  };

  const transferAllFrames = async () => {
    await transferFrames(pendingFrames);
  };

  const retryFailedFrame = async (frame: AgentFrame) => {
    setTransferBusy(true);
    setTransferMessage(`Retrying ${frame.fileName}...`);

    try {
      await frameTransferClient.retryFrame(frame.id);
      await refreshFrameAgent();
      setTransferMessage(`Retried ${frame.fileName}.`);
    } catch (caught) {
      setTransferMessage(caught instanceof Error ? caught.message : 'Unable to retry failed frame.');
    } finally {
      setTransferBusy(false);
    }
  };

  useEffect(() => {
    if (!autoTransferEnabled || !tauriClient.isDesktopRuntime() || !sessionRoot) {
      return undefined;
    }

    let cancelled = false;

    const pollAndTransfer = async () => {
      if (cancelled || transferInFlightRef.current) {
        return;
      }

      try {
        const [health, frames, failed] = await Promise.all([
          frameTransferClient.getHealth(),
          frameTransferClient.getPendingFrames(),
          frameTransferClient.getFailedFrames()
        ]);

        if (cancelled) {
          return;
        }

        setAgentHealth(health);
        setPendingFrames(frames);
        setFailedFrames(failed);
        setTransferRunAt(new Date().toLocaleTimeString());

        if (frames.length) {
          await transferFrames(frames, 'auto');
        }
      } catch (caught) {
        setTransferMessage(caught instanceof Error ? caught.message : 'Auto transfer could not reach Starrunner Agent.');
      }
    };

    void pollAndTransfer();
    const intervalId = window.setInterval(() => void pollAndTransfer(), 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [autoTransferEnabled, sessionRoot, agentBaseInput]);

  return (
    <div className="tab-grid logs-grid">
      <Panel title="Application Status" icon={<Wifi size={17} />}>
        <DataTable
          rows={[
            ['NINA', ninaVersion],
            ['Advanced API', apiVersion],
            ['HTTP error', error || '-'],
            ['HTTP base', apiBase],
            ['WebSocket', wsUrl],
            ['TPPA socket', tppaWsUrl],
            ['Runtime', runtimeStatus.shell],
            ['Settings', runtimeStatus.settings],
            ['Storage', runtimeStatus.storage],
            ['Session root', runtimeStatus.sessionRoot]
          ]}
        />
        <div className="button-row">
          <button type="button" onClick={runDiagnostics} disabled={diagnosticsRunning}>
            <RefreshCw size={16} />
            {diagnosticsRunning ? 'Running Diagnostics' : 'Run Diagnostics'}
          </button>
          <button type="button" onClick={runCapabilityDiscovery} disabled={capabilitiesRunning}>
            <Search size={16} />
            {capabilitiesRunning ? 'Discovering' : 'Discover Capabilities'}
          </button>
          {diagnosticsRunAt ? <div className="inline-note">Last run {diagnosticsRunAt}</div> : null}
          {capabilitiesRunAt ? <div className="inline-note">Capabilities {capabilitiesRunAt}</div> : null}
        </div>
      </Panel>

      <Panel title="Connection Diagnostics" icon={<Search size={17} />}>
        {diagnostics.length ? (
          <div className="diagnostic-list">
            {diagnostics.map((item) => (
              <div className={`diagnostic-row ${item.status}`} key={item.name}>
                <div className="diagnostic-status">{item.status}</div>
                <div className="diagnostic-main">
                  <strong>{item.name}</strong>
                  <span>{item.detail}</span>
                </div>
                <time>{item.durationMs === undefined ? '-' : `${item.durationMs}ms`}</time>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Search size={18} />
            Run diagnostics to check NINA API, equipment endpoints, and events.
          </div>
        )}
      </Panel>

      <Panel title="Frame Transfer" icon={<Save size={17} />}>
        <div className="agent-url-row">
          <label>
            <span>Agent URL</span>
            <input
              type="url"
              value={agentBaseInput}
              onChange={(event) => setAgentBaseInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  saveAgentBase();
                }
              }}
            />
          </label>
          <button type="button" onClick={saveAgentBase}>
            <Save size={16} />
            Save URL
          </button>
        </div>
        <DataTable
          rows={[
            ['Agent', frameTransferClient.getAgentBase()],
            ['Status', agentHealth?.status || transferMessage || 'Not checked'],
            ['NINA output', agentHealth?.ninaOutputRoot],
            ['Image destination', sessionRoot || 'Not selected'],
            ['Auto transfer', autoTransferEnabled ? 'Enabled' : 'Disabled'],
            ['Pending', agentHealth?.pendingFrames ?? pendingFrames.length],
            ['Failed', failedFrames.length],
            ['Delivered', agentHealth?.deliveredFrames],
            ['Last check', transferRunAt || '-']
          ]}
        />
        <div className="check-row">
          <label>
            <input
              checked={autoTransferEnabled}
              type="checkbox"
              onChange={(event) => setAutoTransfer(event.target.checked)}
            />
            Auto transfer new frames
          </label>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => void refreshFrameAgent()} disabled={transferBusy}>
            <RefreshCw size={16} />
            Check Agent
          </button>
          <button type="button" disabled={storageBusy || transferBusy || !tauriClient.isDesktopRuntime()} onClick={() => void onChooseSessionRoot()}>
            <Save size={16} />
            Choose Folder
          </button>
          <button type="button" disabled={storageBusy || transferBusy || !sessionRoot} onClick={() => void onClearSessionRoot()}>
            Clear Folder
          </button>
          <button type="button" onClick={() => void transferOneFrame()} disabled={transferBusy || !pendingFrames.length}>
            <Save size={16} />
            {transferBusy ? 'Transferring' : 'Transfer One'}
          </button>
          <button type="button" onClick={() => void transferAllFrames()} disabled={transferBusy || !pendingFrames.length}>
            <Save size={16} />
            Transfer All
          </button>
          {transferMessage ? <div className="inline-note">{transferMessage}</div> : null}
        </div>
        {pendingFrames.length ? (
          <div className="frame-list">
            {pendingFrames.slice(0, 8).map((frame) => (
              <div className="frame-row" key={frame.id}>
                <span>{frame.frameNumber}</span>
                <strong>{frame.fileName}</strong>
                <em>{formatBytes(frame.sizeBytes)} | {frame.sourceKind || 'frame'} | {frame.status}</em>
              </div>
            ))}
            {pendingFrames.length > 8 ? <div className="frame-more">+{pendingFrames.length - 8} more pending</div> : null}
          </div>
        ) : null}
        {failedFrames.length ? (
          <div className="frame-list failed-frame-list">
            {failedFrames.slice(0, 8).map((frame) => (
              <div className="frame-row failed-frame-row" key={frame.id}>
                <span>{frame.frameNumber}</span>
                <strong title={frame.error || 'Transfer failed'}>{frame.fileName}</strong>
                <em>{frame.error || 'failed'}</em>
                <button type="button" disabled={transferBusy} onClick={() => void retryFailedFrame(frame)}>
                  Retry
                </button>
              </div>
            ))}
            {failedFrames.length > 8 ? <div className="frame-more">+{failedFrames.length - 8} more failed</div> : null}
          </div>
        ) : null}
        {transferHistory.length ? (
          <div className="frame-list transfer-history-list">
            {transferHistory.map((item) => (
              <div className="frame-row transfer-history-row" key={`${item.id}-${item.transferredAt}`}>
                <span>{item.transferredAt}</span>
                <strong title={item.destinationPath}>{item.fileName}</strong>
                <em>{item.targetName} | {item.imageType} | {formatBytes(item.sizeBytes)} | checksum ok</em>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Save size={18} />
            No transfer history yet.
          </div>
        )}
      </Panel>

      <Panel title="Capability Map" icon={<Telescope size={17} />}>
        {capabilities.length ? (
          <div className="capability-list">
            {capabilities.map((item) => (
              <div className={`capability-row ${item.status}`} key={item.name}>
                <div className="diagnostic-status">{item.status}</div>
                <div className="capability-main">
                  <strong>{item.name}</strong>
                  <span>{item.detail}</span>
                </div>
                <div className="capability-command">{item.commandSurface}</div>
                <time>{item.durationMs === undefined ? '-' : `${item.durationMs}ms`}</time>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Telescope size={18} />
            Discover read endpoints, command surfaces, and WebSocket channels.
          </div>
        )}
      </Panel>

      <Panel title="Events" icon={<ListTree size={17} />}>
        {events.length ? (
          <div className="event-list">
            {events.map((event) => (
              <div className="event-row" key={event.id}>
                <time>{event.receivedAt}</time>
                <div>
                  <div className="event-title">{event.event}</div>
                  {event.detail ? <div className="event-detail">{event.detail}</div> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Wifi size={18} />
            Waiting for NINA WebSocket events.
          </div>
        )}
      </Panel>
    </div>
  );
}

function App() {
  const [initialPlannerState] = useState(loadPlannerState);
  const [demoMode, setDemoMode] = useState(() => settingsClient.loadBoolean('astro-demo-mode'));
  const {
    equipment,
    lastAutofocus,
    lastAutofocusError,
    apiVersion,
    ninaVersion,
    httpStatus,
    error,
    lastRefresh,
    refresh
  } = useNinaStatus(demoMode);
  const { socketStatus, events, acquisitionEvents } = useNinaEvents(httpStatus === 'online');
  const [activeTab, setActiveTab] = useState<TabKey>(initialPlannerState.activeTab ?? 'setup');
  const [commandMessage, setCommandMessage] = useState('');
  const [commandBusy, setCommandBusy] = useState('');
  const [target, setTarget] = useState<ImportedTarget | null>(initialPlannerState.target ?? null);
  const [targetError, setTargetError] = useState('');
  const [targetBusy, setTargetBusy] = useState(false);
  const [sequencePlan, setSequencePlan] = useState<SequencePlan>({ ...defaultSequencePlan, ...initialPlannerState.sequencePlan });
  const [queue, setQueue] = useState<QueueItem[]>(initialPlannerState.queue ?? []);
  const [activeQueueId, setActiveQueueId] = useState(initialPlannerState.activeQueueId ?? '');
  const [coolingTarget, setCoolingTarget] = useState(-10);
  const [coolingMinutes, setCoolingMinutes] = useState(-1);
  const [coolingTask, setCoolingTask] = useState<CoolingTask>('');
  const [settingsHydrated, setSettingsHydrated] = useState(!tauriClient.isDesktopRuntime());
  const [sessionRoot, setSessionRoot] = useState<string | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [tppaSettings, setTppaSettings] = useState<TppaSettings>({
    manualMode: false,
    startFromCurrentPosition: true,
    targetDistance: 10,
    moveRate: 4,
    exposureTime: 2,
    binning: 1,
    gain: 200,
    offset: 8,
    searchRadius: 10
  });
  const [tppaWorkflow, setTppaWorkflow] = useState<TppaWorkflowState>(defaultTppaWorkflow);
  const tppaEventIdRef = useRef(0);

  const tabs = useMemo<Array<{ key: TabKey; label: string }>>(() => [
    { key: 'setup', label: 'Setup' },
    { key: 'targeting', label: 'Targeting' },
    { key: 'acquisition', label: 'Acquisition' },
    { key: 'logs', label: 'Logs' }
  ], []);

  useEffect(() => {
    if (!tauriClient.isDesktopRuntime()) {
      return;
    }

    let active = true;

    const hydrateDesktopSettings = async () => {
      try {
        const settings = await settingsClient.loadDesktopSettings<Record<string, unknown>>();

        if (!active || !settings) {
          return;
        }

        const storedDemoMode = settings['astro-demo-mode'];
        const storedPlanner = settings[plannerStorageKey];
        const storedSessionRoot = settings['storage-session-root'];

        if (typeof storedDemoMode === 'boolean') {
          setDemoMode(storedDemoMode);
        }

        if (typeof storedSessionRoot === 'string' && storedSessionRoot.trim()) {
          setSessionRoot(storedSessionRoot);
        }

        if (storedPlanner && typeof storedPlanner === 'object' && !Array.isArray(storedPlanner)) {
          const planner = storedPlanner as Partial<PersistedPlannerState>;

          if (planner.activeTab) {
            setActiveTab(planner.activeTab);
          }

          if ('target' in planner) {
            setTarget(planner.target ?? null);
          }

          if (planner.sequencePlan) {
            setSequencePlan({ ...defaultSequencePlan, ...planner.sequencePlan });
          }

          if (planner.queue) {
            setQueue(planner.queue);
          }

          if (planner.activeQueueId) {
            setActiveQueueId(planner.activeQueueId);
          }
        }
      } finally {
        if (active) {
          setSettingsHydrated(true);
        }
      }
    };

    void hydrateDesktopSettings();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadStorageRoot = async () => {
      const root = await storageClient.getDefaultSessionRoot();

      if (active && root) {
        setSessionRoot(root);
      }
    };

    void loadStorageRoot();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (demoMode || httpStatus !== 'online') {
      setTppaWorkflow((current) => ({ ...current, socket: demoMode ? 'idle' : 'closed' }));
      return undefined;
    }

    const socket = ninaClient.openTppaSocket();
    let closed = false;

    setTppaWorkflow((current) => ({ ...current, socket: 'connecting' }));

    socket.addEventListener('open', () => {
      if (!closed) {
        setTppaWorkflow((current) => ({ ...current, socket: 'open', status: 'TPPA socket connected.' }));
      }
    });

    socket.addEventListener('message', (message) => {
      let raw: unknown = message.data;
      try {
        raw = JSON.parse(String(message.data));
      } catch {
        raw = { Message: String(message.data) };
      }

      const receivedAt = new Date().toLocaleTimeString();
      const update = tppaStateFromRaw(raw, ++tppaEventIdRef.current, receivedAt);
      setTppaWorkflow((current) => ({
        ...current,
        ...update,
        socket: 'open',
        instruction: update.instruction || current.instruction,
        rawEvents: [...(update.rawEvents ?? []), ...current.rawEvents].slice(0, 20)
      }));
    });

    socket.addEventListener('error', () => {
      if (!closed) {
        setTppaWorkflow((current) => ({ ...current, socket: 'error', status: 'TPPA socket error.' }));
      }
    });

    socket.addEventListener('close', () => {
      if (!closed) {
        setTppaWorkflow((current) => ({ ...current, socket: 'closed', status: 'TPPA socket closed.' }));
      }
    });

    return () => {
      closed = true;
      socket.close();
    };
  }, [demoMode, httpStatus]);

  useEffect(() => {
    if (!settingsHydrated) {
      return;
    }

    const payload: PersistedPlannerState = {
      activeTab,
      target,
      sequencePlan,
      queue,
      activeQueueId
    };

    settingsClient.saveJson(plannerStorageKey, payload);
  }, [activeQueueId, activeTab, queue, sequencePlan, settingsHydrated, target]);

  const runAutofocus = async (cancel = false) => {
    if (demoMode) {
      setCommandMessage(cancel ? 'Demo autofocus canceled.' : 'Demo autofocus started.');
      return;
    }

    if (!cancel && !window.confirm('Start NINA autofocus now? The focuser and camera will be controlled by NINA.')) {
      return;
    }

    setCommandBusy(cancel ? 'cancel-af' : 'start-af');
    setCommandMessage('');

    try {
      const { response, body } = await ninaClient.runAutofocus(cancel);

      if (!response.ok || !body.Success) {
        throw new Error(body.Error || `Autofocus request failed with HTTP ${response.status}.`);
      }

      setCommandMessage(body.Response);
      void refresh();
    } catch (caught) {
      setCommandMessage(caught instanceof Error ? caught.message : 'Autofocus request failed.');
    } finally {
      setCommandBusy('');
    }
  };

  const runCameraCooling = async (action: 'cool' | 'warm' | 'cancel-cool' | 'cancel-warm') => {
    if (demoMode) {
      setCommandMessage(`Demo camera cooling command: ${action}`);
      setCoolingTask(action === 'cool' ? 'cooling' : action === 'warm' ? 'warming' : '');
      return;
    }

    if (!Number.isFinite(coolingMinutes) || coolingMinutes < -1) {
      setCommandMessage('Cooling duration must be -1 or greater.');
      return;
    }

    if ((action === 'cool' || action === 'cancel-cool') && (!Number.isFinite(coolingTarget) || coolingTarget < -40 || coolingTarget > 35)) {
      setCommandMessage('Cooling target must be between -40 C and 35 C.');
      return;
    }

    const confirmation =
      action === 'cool'
        ? `Start camera cooling to ${coolingTarget} C?`
        : action === 'warm'
          ? 'Start camera warming?'
          : action === 'cancel-cool'
            ? 'Cancel the active camera cooling command?'
            : 'Cancel the active camera warming command?';

    if (!window.confirm(confirmation)) {
      return;
    }

    const cancel = action === 'cancel-cool' || action === 'cancel-warm';

    setCommandBusy(`camera-${action}`);
    setCommandMessage('');

    try {
      const { response, body } =
        action === 'warm' || action === 'cancel-warm'
          ? await ninaClient.warmCamera(coolingMinutes, cancel)
          : await ninaClient.coolCamera(coolingTarget, coolingMinutes, cancel);

      if (!response.ok || !body.Success) {
        throw new Error(body.Error || `Camera cooling request failed with HTTP ${response.status}.`);
      }

      setCommandMessage(body.Response);
      setCoolingTask(action === 'cool' ? 'cooling' : action === 'warm' ? 'warming' : '');
      void refresh();
    } catch (caught) {
      setCommandMessage(caught instanceof Error ? caught.message : 'Camera cooling request failed.');
    } finally {
      setCommandBusy('');
    }
  };

  const runTppa = async (action: string) => {
    if (demoMode) {
      setCommandMessage(`Demo TPPA command: ${action}`);
      setTppaWorkflow((current) => ({
        ...current,
        step: action,
        status: 'Demo TPPA command sent.',
        lastUpdated: new Date().toLocaleTimeString()
      }));
      return;
    }

    if (action === 'start-alignment' && !window.confirm('Start Three Point Polar Alignment now? NINA may move the mount.')) {
      return;
    }

    setCommandBusy(`tppa-${action}`);
    setCommandMessage('');
    setTppaWorkflow((current) => ({
      ...current,
      step: action,
      status: `Sending ${action}...`,
      lastUpdated: new Date().toLocaleTimeString()
    }));

    try {
      const result = await ninaClient.sendTppaCommand(action, tppaSettings);
      setCommandMessage(result);
      let raw: unknown = { Response: result, Type: action };
      try {
        raw = JSON.parse(result);
      } catch {
        // keep text result
      }
      const receivedAt = new Date().toLocaleTimeString();
      const update = tppaStateFromRaw(raw, ++tppaEventIdRef.current, receivedAt);
      setTppaWorkflow((current) => ({
        ...current,
        ...update,
        step: update.step || action,
        status: update.status || result,
        instruction: update.instruction || current.instruction,
        rawEvents: [...(update.rawEvents ?? []), ...current.rawEvents].slice(0, 20)
      }));
    } catch (caught) {
      setCommandMessage(caught instanceof Error ? caught.message : `TPPA ${action} failed.`);
      setTppaWorkflow((current) => ({
        ...current,
        status: caught instanceof Error ? caught.message : `TPPA ${action} failed.`,
        lastUpdated: new Date().toLocaleTimeString()
      }));
    } finally {
      setCommandBusy('');
    }
  };

  const setTppaNumber = (key: keyof TppaSettings, value: string) => {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      setTppaSettings((current) => ({ ...current, [key]: parsed }));
    }
  };

  const importFromStellarium = async () => {
    setTargetBusy(true);
    setTargetError('');

    try {
      const response = await fetchWithTimeout(`${stellariumBase}/objects/info?format=map`, 3500);
      if (!response.ok) {
        throw new Error(`Stellarium returned HTTP ${response.status}.`);
      }

      const body = (await response.json()) as unknown;

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('Stellarium did not return a selected-object map.');
      }

      const imported = targetFromStellariumMap(body as Record<string, unknown>);
      if (imported.raDegrees === undefined || imported.decDegrees === undefined) {
        throw new Error('Imported target is missing coordinates.');
      }

      setTarget(imported);
      setCommandMessage(`Imported ${imported.name} from Stellarium.`);
    } catch (caught) {
      setTargetError(caught instanceof Error ? caught.message : 'Unable to import selected Stellarium target.');
    } finally {
      setTargetBusy(false);
    }
  };

  const updateTargetRotation = (rotationDegrees: number) => {
    if (Number.isNaN(rotationDegrees)) {
      return;
    }

    setTarget((current) => current ? { ...current, rotationDegrees } : current);
  };

  const updateSequencePlan = (updates: Partial<SequencePlan>) => {
    setSequencePlan((current) => ({ ...current, ...updates }));
  };

  const addTargetToQueue = () => {
    if (!target) {
      return;
    }

    const item: QueueItem = {
      id: `${Date.now()}-${target.name}`,
      target: { ...target },
      plan: { ...sequencePlan },
      createdAt: new Date().toLocaleTimeString()
    };

    setQueue((current) => [...current, item]);
    setActiveQueueId((current) => current || item.id);
    setCommandMessage(`Added ${target.name} to Tonight.`);
  };

  const removeQueueItem = (id: string) => {
    setQueue((current) => {
      const next = current.filter((item) => item.id !== id);
      setActiveQueueId((active) => active === id ? next[0]?.id ?? '' : active);
      return next;
    });
  };

  const clearQueue = () => {
    setQueue([]);
    setActiveQueueId('');
    setCommandMessage('Cleared Tonight.');
  };

  const chooseSessionRoot = async () => {
    if (!tauriClient.isDesktopRuntime()) {
      setCommandMessage('Folder selection is available in the desktop app.');
      return;
    }

    setStorageBusy(true);
    setCommandMessage('');

    try {
      const selected = await storageClient.chooseSessionRoot(sessionRoot);

      if (selected) {
        setSessionRoot(selected);
        setCommandMessage(`Image destination set to ${selected}.`);
      }
    } catch (caught) {
      setCommandMessage(caught instanceof Error ? caught.message : 'Unable to choose image destination.');
    } finally {
      setStorageBusy(false);
    }
  };

  const clearSessionRoot = async () => {
    setStorageBusy(true);
    setCommandMessage('');

    try {
      await storageClient.clearSessionRoot();
      setSessionRoot(null);
      setCommandMessage('Image destination cleared.');
    } catch (caught) {
      setCommandMessage(caught instanceof Error ? caught.message : 'Unable to clear image destination.');
    } finally {
      setStorageBusy(false);
    }
  };

  const toggleDemoMode = () => {
    setDemoMode((current) => {
      const next = !current;
      settingsClient.saveBoolean('astro-demo-mode', next);
      return next;
    });
    setCommandMessage('');
  };

  const visibleEvents = demoMode ? demoEvents : events;
  const activeQueueItem = queue.find((item) => item.id === activeQueueId) ?? queue[0] ?? null;

  return (
    <main className="app-shell">
      <StatusBar
        equipment={equipment}
        httpStatus={httpStatus}
        socketStatus={demoMode ? 'idle' : socketStatus}
        lastRefresh={lastRefresh}
        demoMode={demoMode}
        onRefresh={() => void refresh()}
        onToggleDemo={toggleDemoMode}
      />

      {error ? (
        <section className="notice">
          <CircleStop size={16} />
          {error}
        </section>
      ) : null}

      {commandMessage ? (
        <section className="notice neutral">
          <Send size={16} />
          {commandMessage}
        </section>
      ) : null}

      <nav className="tabs" aria-label="Workflow">
        {tabs.map((tab) => (
          <button
            className={activeTab === tab.key ? 'tab active' : 'tab'}
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'setup' ? (
        <SetupTab
          equipment={equipment}
          lastAutofocus={lastAutofocus}
          lastAutofocusError={lastAutofocusError}
          commandBusy={commandBusy}
          coolingTarget={coolingTarget}
          setCoolingTarget={setCoolingTarget}
          coolingMinutes={coolingMinutes}
          setCoolingMinutes={setCoolingMinutes}
          coolingTask={coolingTask}
          runCameraCooling={runCameraCooling}
          runAutofocus={runAutofocus}
          runTppa={runTppa}
          tppaSettings={tppaSettings}
          tppaWorkflow={tppaWorkflow}
          setTppaSettings={setTppaSettings}
          setTppaNumber={setTppaNumber}
        />
      ) : null}

      {activeTab === 'targeting' ? (
        <TargetingTab
          target={target}
          targetError={targetError}
          targetBusy={targetBusy}
          sessionRoot={sessionRoot}
          storageBusy={storageBusy}
          sequencePlan={sequencePlan}
          queue={queue}
          activeQueueId={activeQueueItem?.id ?? ''}
          onImport={importFromStellarium}
          onUseDemo={() => {
            setTarget(demoTarget);
            setTargetError('');
          }}
          onRotationChange={updateTargetRotation}
          onSequencePlanChange={updateSequencePlan}
          onChooseSessionRoot={chooseSessionRoot}
          onClearSessionRoot={clearSessionRoot}
          onAddToQueue={addTargetToQueue}
          onRemoveQueueItem={removeQueueItem}
          onSetActiveQueueItem={setActiveQueueId}
          onClearQueue={clearQueue}
        />
      ) : null}
      {activeTab === 'acquisition' ? (
        <AcquisitionTab
          equipment={equipment}
          activeItem={activeQueueItem}
          queue={queue}
          sessionRoot={sessionRoot}
          acquisitionEvents={acquisitionEvents}
          onSetActiveQueueItem={setActiveQueueId}
        />
      ) : null}
      {activeTab === 'logs' ? (
        <LogsTab
          events={visibleEvents}
          error={error}
          apiVersion={apiVersion}
          ninaVersion={ninaVersion}
          sessionRoot={sessionRoot}
          storageBusy={storageBusy}
          onChooseSessionRoot={chooseSessionRoot}
          onClearSessionRoot={clearSessionRoot}
        />
      ) : null}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
