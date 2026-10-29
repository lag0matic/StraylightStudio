import { Channel, invoke } from '@tauri-apps/api/core';
import { tauriClient } from './tauriClient';

export async function networkFetch(url: string, timeoutMs = 8000, options: { method?: 'GET' | 'POST'; body?: string } = {}) {
  if (tauriClient.isDesktopRuntime()) {
    try {
      const result = await invoke<{ status: number; content_type: string; body_base64: string }>('network_http', {
        request: { url, method: options.method ?? 'GET', body: options.body ?? null, timeout_ms: timeoutMs }
      });
      const bytes = Uint8Array.from(atob(result.body_base64), (character) => character.charCodeAt(0));
      return new Response([204, 205, 304].includes(result.status) ? null : bytes, {
        status: result.status, headers: { 'Content-Type': result.content_type }
      });
    } catch (error) {
      throw new Error(String(error));
    }
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options, signal: controller.signal, redirect: 'error',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined
    });
    // Keep the deadline active while reading the body, including image downloads.
    const bytes = await response.arrayBuffer();
    return new Response([204, 205, 304].includes(response.status) ? null : bytes, { status: response.status, headers: response.headers });
  } finally { window.clearTimeout(timer); }
}

type SocketEvent = { kind: 'open' | 'message' | 'error' | 'close'; data?: string };

class DesktopSocket extends EventTarget {
  private readonly id = crypto.randomUUID();
  private closed = false;
  private opened = false;

  constructor(url: string) {
    super();
    const channel = new Channel<SocketEvent>((event) => {
      if (this.closed) {
        if (event.kind === 'open') this.sendClose();
        return;
      }
      if (event.kind === 'open') this.opened = true;
      if (event.kind === 'close') this.closed = true;
      this.dispatchEvent(event.kind === 'message'
        ? new MessageEvent('message', { data: event.data })
        : event.kind === 'error' ? new ErrorEvent('error', { message: event.data }) : new Event(event.kind));
    });
    void invoke('network_socket', { id: this.id, url, events: channel }).catch((error) => {
      if (!this.closed) {
        this.dispatchEvent(new ErrorEvent('error', { message: String(error) }));
        this.closed = true;
        this.dispatchEvent(new Event('close'));
      }
    });
  }

  addEventListener<K extends keyof WebSocketEventMap>(type: K, listener: (event: WebSocketEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    super.addEventListener(type, listener, options);
  }

  send(data: string) {
    if (!this.opened || this.closed) throw new Error('Event connection is not open');
    void invoke('network_socket_send', { id: this.id, data }).catch((error) => {
      if (!this.closed) this.dispatchEvent(new ErrorEvent('error', { message: String(error) }));
    });
  }

  private sendClose() { void invoke('network_socket_send', { id: this.id, data: null }).catch(() => undefined); }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.sendClose();
  }
}

export interface NetworkSocket {
  addEventListener<K extends keyof WebSocketEventMap>(type: K, listener: (event: WebSocketEventMap[K]) => void): void;
  send(data: string): void;
  close(): void;
}

export function networkSocket(url: string, reconnect = false): NetworkSocket {
  const create = () => tauriClient.isDesktopRuntime() ? new DesktopSocket(url) : new WebSocket(url);
  if (!reconnect) return create();
  const events = new EventTarget();
  let active: NetworkSocket;
  let stopped = false;
  let timer: number | undefined;
  const connect = () => {
    if (stopped) return;
    active = create();
    active.addEventListener('open', () => { if (!stopped) events.dispatchEvent(new Event('open')); });
    active.addEventListener('message', (event) => { if (!stopped) events.dispatchEvent(new MessageEvent('message', { data: event.data })); });
    active.addEventListener('error', () => { if (!stopped) events.dispatchEvent(new Event('error')); });
    active.addEventListener('close', () => {
      if (stopped) return;
      events.dispatchEvent(new Event('close'));
      timer = window.setTimeout(connect, 3000);
    });
  };
  connect();
  return {
    addEventListener: (type, listener) => events.addEventListener(type, listener as EventListener),
    send: (data) => active.send(data),
    close: () => { stopped = true; window.clearTimeout(timer); active.close(); }
  };
}
