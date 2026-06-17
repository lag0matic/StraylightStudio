import { open } from '@tauri-apps/plugin-dialog';
import { tauriClient } from './tauriClient';

export type StorageTarget = {
  name: string;
};

export type StoragePlan = {
  imageType: string;
};

export type StorageStatus = {
  mode: string;
  session_root: string | null;
  writable: boolean;
};

export type WriteFrameRequest = {
  sessionFolder: string;
  fileName: string;
  imageType: string;
  targetName: string;
  frameNumber: number;
  capturedAt?: string;
  dataBase64: string;
};

export type WriteFrameResult = {
  frame: {
    frame_number: number;
    file_name: string;
    path: string;
    size_bytes: number;
    sha256: string;
    image_type: string;
    target_name: string;
    captured_at: string | null;
  };
  manifest_path: string;
};

export type RenderFitsPreviewResult = {
  data_url: string;
  width: number;
  height: number;
  source_path: string;
};

function monthToken(date: Date) {
  return date.toLocaleString('en-US', { month: 'short' }).toLowerCase();
}

function sessionDateToken(date = new Date()) {
  return `${monthToken(date)}${date.getDate()}${date.getFullYear()}`;
}

function slugTargetName(name: string) {
  const compactMessier = name.trim().match(/^m\s*([0-9]+)$/i);

  if (compactMessier) {
    return `m${compactMessier[1]}`;
  }

  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'target';
}

function slugImageType(imageType: string) {
  return imageType.trim().toLowerCase().replace(/[^a-z0-9]+/g, '') || 'light';
}

function sessionFolder(target: StorageTarget | null, plan: StoragePlan, date = new Date()) {
  const targetSlug = target ? slugTargetName(target.name) : 'target';
  return `${sessionDateToken(date)}_${targetSlug}_${slugImageType(plan.imageType)}`;
}

function framePath(target: StorageTarget | null, plan: StoragePlan, frameNumber: number, date = new Date()) {
  const safeFrameNumber = Number.isFinite(frameNumber) && frameNumber > 0 ? Math.floor(frameNumber) : 1;
  return `${sessionFolder(target, plan, date)}/${safeFrameNumber}.fits`;
}

function joinPath(root: string, child: string) {
  const separator = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${separator}${child.replace(/^[\\/]+/, '').replace(/\//g, separator)}`;
}

function sessionFolderPath(root: string | null, target: StorageTarget | null, plan: StoragePlan, date = new Date()) {
  const folder = sessionFolder(target, plan, date);
  return root ? joinPath(root, folder) : folder;
}

function frameDestinationPath(root: string | null, target: StorageTarget | null, plan: StoragePlan, frameNumber: number, date = new Date()) {
  const relativePath = framePath(target, plan, frameNumber, date);
  return root ? joinPath(root, relativePath) : relativePath;
}

function firstFramePath(target: StorageTarget | null, plan: StoragePlan, date = new Date()) {
  return framePath(target, plan, 1, date);
}

function firstFrameDestinationPath(root: string | null, target: StorageTarget | null, plan: StoragePlan, date = new Date()) {
  return frameDestinationPath(root, target, plan, 1, date);
}

function plannedFramePaths(target: StorageTarget, plan: StoragePlan & { frameCount: number }, limit: number, root: string | null = null, date = new Date()) {
  const visibleCount = Math.min(Math.max(0, plan.frameCount), Math.max(0, limit));

  return Array.from({ length: visibleCount }, (_, index) => ({
    number: index + 1,
    path: frameDestinationPath(root, target, plan, index + 1, date),
    status: 'planned' as const
  }));
}

async function getStorageStatus() {
  return tauriClient.invokeIfDesktop<StorageStatus>('get_storage_status');
}

async function getDefaultSessionRoot() {
  return tauriClient.invokeIfDesktop<string | null>('get_default_session_root');
}

async function setSessionRoot(path: string) {
  return tauriClient.invokeIfDesktop<string>('set_session_root', { path });
}

async function clearSessionRoot() {
  return tauriClient.invokeIfDesktop<void>('clear_session_root');
}

async function chooseSessionRoot(currentRoot?: string | null) {
  if (!tauriClient.isDesktopRuntime()) {
    return null;
  }

  const selected = await open({
    title: 'Choose Straylight Studio image destination',
    directory: true,
    multiple: false,
    canCreateDirectories: true,
    defaultPath: currentRoot || undefined
  });

  if (!selected || Array.isArray(selected)) {
    return null;
  }

  return setSessionRoot(selected);
}

async function previewFramePath(sessionFolderPath: string, frameNumber: number) {
  const desktopPath = await tauriClient.invokeIfDesktop<string>('preview_frame_path', {
    preview: {
      session_folder: sessionFolderPath,
      frame_number: frameNumber
    }
  });

  return desktopPath ?? `${sessionFolderPath}/${Math.max(1, Math.floor(frameNumber))}.fits`;
}

async function prepareSessionFolder(sessionFolderName: string) {
  return tauriClient.invokeIfDesktop<string>('prepare_session_folder', { sessionFolder: sessionFolderName });
}

async function writeFrame(request: WriteFrameRequest) {
  return tauriClient.invokeIfDesktop<WriteFrameResult>('write_frame', {
    request: {
      session_folder: request.sessionFolder,
      file_name: request.fileName,
      image_type: request.imageType,
      target_name: request.targetName,
      frame_number: request.frameNumber,
      captured_at: request.capturedAt ?? null,
      data_base64: request.dataBase64
    }
  });
}

async function renderFitsPreview(path: string, stretch: { blackPoint: number; midtone: number; whitePoint: number }) {
  return tauriClient.invokeIfDesktop<RenderFitsPreviewResult>('render_fits_preview', {
    request: {
      path,
      max_size: 1400,
      black_point: stretch.blackPoint,
      midtone: stretch.midtone,
      white_point: stretch.whitePoint
    }
  });
}

export const storageClient = {
  sessionFolder,
  framePath,
  sessionFolderPath,
  frameDestinationPath,
  firstFramePath,
  firstFrameDestinationPath,
  plannedFramePaths,
  getStorageStatus,
  getDefaultSessionRoot,
  setSessionRoot,
  clearSessionRoot,
  chooseSessionRoot,
  previewFramePath,
  prepareSessionFolder,
  writeFrame,
  renderFitsPreview
};
