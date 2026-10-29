import { tauriClient } from './tauriClient';

export const defaultConnections = {
  ninaOrigin: 'http://Starrunner.local:1888',
  stellariumOrigin: 'http://127.0.0.1:8090'
};
export type Connections = typeof defaultConnections;

export function normalizeServerAddress(value: string) {
  const text = value.trim();
  const url = new URL(text.includes('://') ? text : `http://${text}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Enter a server address such as http://Starrunner.local:1888, without a path or credentials.');
  }
  return url.origin;
}

let current: Connections = { ...defaultConnections };
const listeners = new Set<() => void>();
function configure(values: Connections) {
  const next = { ninaOrigin: normalizeServerAddress(values.ninaOrigin), stellariumOrigin: normalizeServerAddress(values.stellariumOrigin) };
  if (next.ninaOrigin === current.ninaOrigin && next.stellariumOrigin === current.stellariumOrigin) return;
  current = next;
  listeners.forEach((listener) => listener());
}
function endpoint(service: 'nina' | 'stellarium', path: string) {
  const origin = service === 'nina' ? current.ninaOrigin : current.stellariumOrigin;
  const defaultOrigin = service === 'nina' ? defaultConnections.ninaOrigin : defaultConnections.stellariumOrigin;
  if (!tauriClient.isDesktopRuntime() && origin.toLowerCase() === defaultOrigin.toLowerCase()) {
    if (service === 'stellarium') return `${import.meta.env.VITE_STELLARIUM_HTTP_BASE || '/stellarium-api'}/${path}`;
    return `${import.meta.env.VITE_NINA_HTTP_BASE || '/nina-api'}/${path}`;
  }
  return `${origin}/${service === 'nina' ? 'v2/api' : 'api'}/${path}`;
}
function socketUrl(tppa: boolean) {
  if (!tauriClient.isDesktopRuntime() && current.ninaOrigin.toLowerCase() === defaultConnections.ninaOrigin.toLowerCase()) {
    return (tppa ? import.meta.env.VITE_NINA_TPPA_WS_URL : import.meta.env.VITE_NINA_WS_URL)
      || `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/${tppa ? 'nina-tppa' : 'nina-ws'}`;
  }
  const url = new URL(current.ninaOrigin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = tppa ? '/v2/tppa' : '/v2/socket';
  return url.toString();
}
export const connectionClient = {
  configure, endpoint, socketUrl,
  getSnapshot: () => current,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }
};
