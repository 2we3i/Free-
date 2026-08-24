export const PIPELINE_STATUSES = [
  'GENERATING_SCRIPT',
  'AWAITING_CLIP',
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

export interface GeneratedScript {
  idea: string;
  caption: string;
  // Single self-contained prompt for the whole clip (video + native audio),
  // meant to be pasted into the Gemini app's video generator.
  videoPrompt: string;
}

export interface PublishOutcome {
  platform: Platform | string;
  status: 'fulfilled' | 'rejected';
  url?: string;
  error?: string;
}

export type ApprovalDecision = 'approve' | 'cancel';
