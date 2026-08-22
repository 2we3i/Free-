import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { pollUntil } from '../core/poll.js';
import { withRetry } from '../core/retry.js';
import { createHttpClient } from '../http/client.js';
import type { MediaAsset, Scene } from '../types/pipeline.js';

const queue = createHttpClient('fal', {
  baseURL: 'https://queue.fal.run',
  headers: {
    Authorization: `Key ${env.FAL_KEY}`,
    'Content-Type': 'application/json',
  },
});

interface FalSubmitResponse {
  request_id?: string;
  status_url?: string;
  response_url?: string;
}

interface FalStatusResponse {
  status?: string;
  response_url?: string;
}

interface FalResultResponse {
  audio?: { url?: string };
  audio_url?: string;
  video?: { url?: string };
  video_url?: string;
  url?: string;
  output?: { url?: string };
}

function extractMediaUrl(payload: FalResultResponse): string | undefined {
  return (
    payload.audio?.url ??
    payload.audio_url ??
    payload.video?.url ??
    payload.video_url ??
    payload.url ??
    payload.output?.url
  );
}

async function submitFalJob(model: string, input: Record<string, unknown>): Promise<FalSubmitResponse> {
  const response = await withRetry(
    () => queue.post<FalSubmitResponse>(`/${model}`, input),
    `fal:submit:${model}`,
  );
  return response.data;
}

async function waitForFalResult(model: string, requestId: string): Promise<FalResultResponse> {
  return pollUntil<FalResultResponse>({
    label: `fal ${model} ${requestId}`,
    intervalMs: env.FAL_POLL_INTERVAL_MS,
    timeoutMs: env.FAL_POLL_TIMEOUT_MS,
    check: async () => {
      const status = await withRetry(async () => {
        const response = await queue.get<FalStatusResponse>(`/${model}/requests/${requestId}/status`);
        return response.data;
      }, `fal:status:${model}`);
      const state = (status.status ?? '').toUpperCase();
      if (['FAILED', 'CANCELLED', 'ERROR'].includes(state)) {
        throw new Error(`Fal job ${requestId} ended with status ${state}`);
      }
      if (state === 'COMPLETED' || status.response_url) {
        const result = await withRetry(async () => {
          const response = await queue.get<FalResultResponse>(`/${model}/requests/${requestId}`);
          return response.data;
        }, `fal:result:${model}`);
        return { done: true, value: result };
      }
      return { done: false };
    },
  });
}

async function generateOneSound(scene: Scene): Promise<MediaAsset> {
  const submitted = await submitFalJob(env.FAL_AUDIO_MODEL, {
    prompt: scene.audioPrompt,
    seconds_total: scene.durationSec,
  });
  const requestId = submitted.request_id;
  if (!requestId) {
    throw new Error(`Fal audio submit missing request_id for scene ${scene.index}`);
  }
  const result = await waitForFalResult(env.FAL_AUDIO_MODEL, requestId);
  const url = extractMediaUrl(result);
  if (!url) {
    throw new Error(`Fal audio result missing URL for scene ${scene.index}`);
  }
  return { sceneIndex: scene.index, url };
}

export async function generateSounds(scenes: Scene[]): Promise<MediaAsset[]> {
  const results = await Promise.allSettled(scenes.map((scene) => generateOneSound(scene)));
  const sounds: MediaAsset[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      sounds.push(result.value);
      return;
    }
    logger.error({ err: result.reason, scene: scenes[index]?.index }, 'audio generation failed, continuing with remaining scenes');
  });
  sounds.sort((a, b) => a.sceneIndex - b.sceneIndex);
  return sounds;
}

export async function stitchVideo(clipUrls: string[], audioUrls: string[]): Promise<string> {
  const submitted = await submitFalJob(env.FAL_STITCH_MODEL, {
    clips: clipUrls.map((url) => ({ url })),
    audio: audioUrls.map((url) => ({ url })),
    output_format: 'mp4',
  });
  const requestId = submitted.request_id;
  if (!requestId) {
    throw new Error('Fal stitch submit missing request_id');
  }
  const result = await waitForFalResult(env.FAL_STITCH_MODEL, requestId);
  const url = extractMediaUrl(result);
  if (!url) {
    throw new Error('Fal stitch result missing video URL');
  }
  return url;
}

export { waitForFalResult, submitFalJob, extractMediaUrl };
