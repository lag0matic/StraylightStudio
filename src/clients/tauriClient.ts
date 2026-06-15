import { invoke, isTauri } from '@tauri-apps/api/core';

function isDesktopRuntime() {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

async function invokeIfDesktop<T>(command: string, args?: Record<string, unknown>) {
  if (!isDesktopRuntime()) {
    return null;
  }

  return invoke<T>(command, args);
}

export const tauriClient = {
  isDesktopRuntime,
  invokeIfDesktop
};
