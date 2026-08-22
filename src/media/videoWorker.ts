import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { pollUntil } from '../core/poll.js';
import { withRetry } from '../core/retry.js';
import { createHttpClient } from '../http/client.js';
import type { MediaAsset, Scene } from '../types/pipeline.js';

const http = createHttpClient('wavespeed', {
  baseURL: env.WAVESPEED_BASE_URL,
  headers: {
    Authorization: `Bearer ${env.WAVESPEED_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

interface WavespeedCreateResponse {
  data?: {
    id?: string;
    status?: string;
    outputs?: string[];
    output?: string | string[];
  };
  id?: string;
  status?: string;
  outputs?: string[];
}

interface WavespeedStatusResponse {
  data?: {
    id?: string;
    status?: string;
    outputs?: string[];
    output?: string | string[];
    error?: string;
  };
  status?: string;
  outputs?: string[];
  error?: string;
}

function firstOutput(payload: WavespeedCreateResponse | WavespeedStatusResponse): string | undefined {
  const data = 'data' in payload ? payload.data : undefined;
  const outputs = data?.outputs ?? ('outputs' in payload ? payload.outputs : undefined);
  if (Array.isArray(outputs) && outputs[0]) return outputs[0];
  const output = data?.output;
  if (typeof output === 'string') return output;
  if (Array.isArray(output) && output[0]) return output[0];
  return undefined;
}

function jobId(payload: WavespeedCreateResponse): string | undefined {
  return payload.data?.id ?? payload.id;
}

function normalizeStatus(payload: WavespeedStatusResponse): string {
  return (payload.data?.status ?? payload.status ?? '').toLowerCase();
}

async function generateOneClip(scene: Scene): Promise<MediaAsset> {
  const created = await withRetry(async () => {
    const response = await http.post<WavespeedCreateResponse>(`/api/v3/${env.WAVESPEED_MODEL}`, {
      prompt: scene.visualPrompt,
      duration: scene.durationSec,
    });
    return response.data;
  }, `wavespeed:create:${scene.index}`);

  const id = jobId(created);
  const immediate = firstOutput(created);
  if (immediate) {
    return { sceneIndex: scene.index, url: immediate };
  }
  if (!id) {
    throw new Error(`Wavespeed did not return a prediction id for scene ${scene.index}`);
  }

  const url = await pollUntil<string>({
    label: `wavespeed scene ${scene.index}`,
    intervalMs: env.WAVESPEED_POLL_INTERVAL_MS,
    timeoutMs: env.WAVESPEED_POLL_TIMEOUT_MS,
    check: async () => {
      const status = await withRetry(async () => {
        const response = await http.get<WavespeedStatusResponse>(`/api/v3/predictions/${id}/result`);
        return response.data;
      }, `wavespeed:poll:${scene.index}`);
      const state = normalizeStatus(status);
      const output = firstOutput(status);
      if (output) return { done: true, value: output };
      if (['failed', 'error', 'cancelled'].includes(state)) {
        throw new Error(status.data?.error ?? status.error ?? `Wavespeed scene ${scene.index} failed`);
      }
      return { done: false };
    },
  });

  return { sceneIndex: scene.index, url };
}

export async function generateClips(scenes: Scene[]): Promise<MediaAsset[]> {
  const results = await Promise.allSettled(scenes.map((scene) => generateOneClip(scene)));
  const clips: MediaAsset[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      clips.push(result.value);
      return;
    }
    logger.error({ err: result.reason, scene: scenes[index]?.index }, 'clip generation failed, continuing with remaining scenes');
  });
  clips.sort((a, b) => a.sceneIndex - b.sceneIndex);
  if (clips.length === 0) {
    throw new Error('All scene clip generations failed');
  }
  return clips;
}
