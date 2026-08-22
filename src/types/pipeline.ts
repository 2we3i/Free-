export const PIPELINE_STATUSES = [
  'GENERATING_SCRIPT',
  'GENERATING_MEDIA',
  'STITCHING',
  'AWAITING_APPROVAL',
  'PUBLISHING',
  'DONE',
  'CANCELLED',
  'ERROR',
] as const;

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const PLATFORMS = [
  'tiktok',
  'linkedin',
  'facebook',
  'instagram',
  'x',
  'youtube',
  'threads',
  'bluesky',
  'pinterest',
] as const;

export type Platform = (typeof PLATFORMS)[number];

export interface Scene {
  index: number;
  visualPrompt: string;
  audioPrompt: string;
  durationSec: number;
}

export interface GeneratedScript {
  idea: string;
  caption: string;
  scenes: Scene[];
}

export interface MediaAsset {
  sceneIndex: number;
  url: string;
}

export interface PublishOutcome {
  platform: Platform | string;
  status: 'fulfilled' | 'rejected';
  url?: string;
  error?: string;
}

export type ApprovalDecision = 'approve' | 'cancel';
