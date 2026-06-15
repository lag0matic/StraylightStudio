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
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function getJson<T>(path: string, timeoutMs = 8000) {
  const response = await fetchWithTimeout(`${activeAgentBase}${path}`, timeoutMs);

  if (!response.ok) {
    throw new Error(`Frame agent returned HTTP ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${activeAgentBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Frame agent returned HTTP ${response.status}.`);
    }

    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function getHealth() {
  return getJson<AgentHealth>('/health');
}

async function getPendingFrames() {
  return getJson<AgentFrame[]>('/frames/pending');
}

async function getFailedFrames() {
  return getJson<AgentFrame[]>('/frames/failed');
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
