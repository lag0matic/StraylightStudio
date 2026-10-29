import { frameTransferClient } from './frameTransferClient';
import { networkFetch } from './networkClient';

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
  const response = await networkFetch(`${frameTransferClient.getAgentBase()}/phd2/status`);

  if (!response.ok) {
    throw new Error(`PHD2 monitor returned HTTP ${response.status}.`);
  }

  const status = await response.json() as Phd2Status;
  if (!status || !Array.isArray(status.samples)) throw new Error('PHD2 monitor returned an invalid status response.');
  return status;
}

export const phd2Client = {
  getStatus
};
