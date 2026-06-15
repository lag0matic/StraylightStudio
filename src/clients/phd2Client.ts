import { frameTransferClient } from './frameTransferClient';

export type PhdGuideSample = {
  frame: number;
  time: number;
  dx: number;
  dy: number;
  raDuration?: number | null;
  raDirection?: string | null;
  decDuration?: number | null;
  decDirection?: string | null;
  snr?: number | null;
  hfd?: number | null;
  avgDist?: number | null;
  receivedAt: string;
};

export type Phd2Status = {
  connected: boolean;
  appState: string;
  version: string;
  lastEvent: string;
  error?: string | null;
  lastEventAt?: string | null;
  samples: PhdGuideSample[];
};

async function getStatus() {
  const response = await fetch(`${frameTransferClient.getAgentBase()}/phd2/status`);

  if (!response.ok) {
    throw new Error(`PHD2 monitor returned HTTP ${response.status}.`);
  }

  return (await response.json()) as Phd2Status;
}

export const phd2Client = {
  getStatus
};
