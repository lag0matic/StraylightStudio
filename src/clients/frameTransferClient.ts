import { networkFetch } from './networkClient';

export type AgentHealth = {
  name: string;
  status: string;
  ninaOutputRoot: string;
  pendingFrames: number;
  deliveredFrames: number;
  utc: string;
};

export type AgentFrame = {
  id: string;
  targetName: string;
  imageType: string;
  frameNumber: number;
  sourceKind?: string;
  fileName: string;
  sourcePath: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  status: string;
  error?: string | null;
};

type AgentFrameCollection = AgentFrame[] | {
  value?: AgentFrame[];
  Value?: AgentFrame[];
  count?: number;
  Count?: number;
};

export const defaultFrameAgentBase = import.meta.env.VITE_FRAME_AGENT_BASE || 'http://Starrunner.local:4787';

let activeAgentBase = normalizeAgentBase(defaultFrameAgentBase);

function normalizeAgentBase(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function setAgentBase(value: string) {
  activeAgentBase = normalizeAgentBase(value || defaultFrameAgentBase);
}

function getAgentBase() {
  return activeAgentBase;
}

async function fetchWithTimeout(url: string, timeoutMs = 8000) {
  return networkFetch(url, timeoutMs);
}

async function getJson<T>(path: string, timeoutMs = 8000) {
  const response = await fetchWithTimeout(`${activeAgentBase}${path}`, timeoutMs);

  if (!response.ok) {
    throw new Error(`Frame agent returned HTTP ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown, timeoutMs = 8000) {
    const response = await networkFetch(`${activeAgentBase}${path}`, timeoutMs, { method: 'POST', body: JSON.stringify(body) });

    if (!response.ok) {
      throw new Error(`Frame agent returned HTTP ${response.status}.`);
    }

    return (await response.json()) as T;
}

async function getHealth() {
  return getJson<AgentHealth>('/health');
}

function normalizeFrameCollection(response: AgentFrameCollection) {
  if (Array.isArray(response)) {
    return response;
  }

  return response.value ?? response.Value ?? [];
}

async function getPendingFrames() {
  return normalizeFrameCollection(await getJson<AgentFrameCollection>('/frames/pending'));
}

async function getFailedFrames() {
  return normalizeFrameCollection(await getJson<AgentFrameCollection>('/frames/failed'));
}

async function downloadFrame(frameId: string) {
  const response = await fetchWithTimeout(`${activeAgentBase}/frames/${encodeURIComponent(frameId)}`, 60000);

  if (!response.ok) {
    throw new Error(`Frame download failed with HTTP ${response.status}.`);
  }

  return response.blob();
}

async function acknowledgeFrame(frameId: string, sha256: string) {
  return postJson<AgentFrame>(`/frames/${encodeURIComponent(frameId)}/ack`, { sha256 });
}

async function retryFrame(frameId: string) {
  return postJson<AgentFrame>(`/frames/${encodeURIComponent(frameId)}/retry`, {});
}

export const frameTransferClient = {
  defaultAgentBase: defaultFrameAgentBase,
  getAgentBase,
  setAgentBase,
  getHealth,
  getPendingFrames,
  getFailedFrames,
  downloadFrame,
  acknowledgeFrame,
  retryFrame
};
