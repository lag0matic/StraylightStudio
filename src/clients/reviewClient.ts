import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { RenderFitsPreviewResult } from './storageClient';

export type ReviewDecision = 'keep' | 'reject' | 'undecided';
export type ReviewFrame = {
  relative_path: string; fingerprint: string; size_bytes: number;
  decision: ReviewDecision; metadata: Record<string, string>; error: string | null;
};
export type ReviewFolder = { root: string; frames: ReviewFrame[]; warnings: string[]; decision_error: string | null };
export const reviewClient = {
  choose: () => open({ title: 'Open session folder', directory: true, multiple: false }),
  scan: (root: string) => invoke<ReviewFolder>('review_open', { root }),
  preview: (root: string, frame: ReviewFrame, thumbnail = false) => invoke<RenderFitsPreviewResult>('review_preview', {
    root, relative: frame.relative_path, expected: frame.fingerprint, thumbnail
  }),
  decide: (root: string, frame: ReviewFrame, decision: ReviewDecision) => invoke<void>('review_decide', {
    root, relative: frame.relative_path, expected: frame.fingerprint, decision
  })
};
