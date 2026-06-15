import { tauriClient } from './tauriClient';

type JsonObject = Record<string, unknown>;

function loadJson<T extends JsonObject>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...fallback, ...parsed } as T : fallback;
  } catch {
    return fallback;
  }
}

function saveJson<T extends JsonObject>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value));
  void tauriClient.invokeIfDesktop('save_settings', { settings: { [key]: value } }).catch(() => undefined);
}

function loadBoolean(key: string, fallback = false) {
  const raw = window.localStorage.getItem(key);
  return raw === null ? fallback : raw === 'true';
}

function saveBoolean(key: string, value: boolean) {
  window.localStorage.setItem(key, String(value));
  void tauriClient.invokeIfDesktop('save_settings', { settings: { [key]: value } }).catch(() => undefined);
}

async function loadDesktopSettings<T extends JsonObject>() {
  return tauriClient.invokeIfDesktop<T>('load_settings');
}

async function resetDesktopSettings() {
  return tauriClient.invokeIfDesktop<void>('reset_settings');
}

export const settingsClient = {
  loadJson,
  saveJson,
  loadBoolean,
  saveBoolean,
  loadDesktopSettings,
  resetDesktopSettings
};
