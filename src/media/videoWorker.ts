import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { pollUntil } from '../core/poll.js';
import { withRetry } from '../core/retry.js';
import { createHttpClient } from '../http/client.js';
import { uploadBufferToFal } from './falStorage.js';
import type { MediaAsset, Scene } from '../types/pipeline.js';

// Veo, accessed through the Gemini API. Docs: https://ai.google.dev/gemini-api/docs/veo
// Uses the long-running "predictLongRunning" REST method, authenticated via the
// x-goog-api-key header (not a ?key= query param).
const http = createHttpClient('veo', {
  baseURL: 'https://generativelanguage.googleapis.com/v1beta',
  headers: {
    'Content-Type': 'application/json',
    'x-goog-api-key': env.GEMINI_API_KEY,
  },
});

interface VeoOperation {
  name: string;
  done?: boolean;
  error?: { message?: string };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{ video?: { uri?: string } }>;
    };
  };
}

async function startVeoGeneration(scene: Scene): Promise<VeoOperation> {
  const response = await withRetry(async () => {
    return http.post<VeoOperation>(`/models/${env.VEO_MODEL}:predictLongRunning`, {
      instances: [{ prompt: scene.visualPrompt }],
      parameters: { durationSeconds: Math.round(scene.durationSec) },
    });
  }, `veo:create:${scene.index}`);
  return response.data;
}

async function pollVeoOperation(operationName: string, sceneIndex: number): Promise<string> {
  return pollUntil<string>({
    label: `veo scene ${sceneIndex}`,
    intervalMs: env.VEO_POLL_INTERVAL_MS,
    timeoutMs: env.VEO_POLL_TIMEOUT_MS,
    check: async () => {
      const status = await withRetry(async () => {
        // operationName already includes the "models/..." prefix per the API response.
        const response = await http.get<VeoOperation>(`/${operationName}`);
        return response.data;
      }, `veo:poll:${sceneIndex}`);

      if (status.error) {
        throw new Error(status.error.message ?? `Veo scene ${sceneIndex} failed`);
      }
      if (!status.done) {
        return { done: false };
      }
      const uri = status.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!uri) {
        throw new Error(`Veo scene ${sceneIndex} completed without a video URI`);
      }
      return { done: true, value: uri };
    },
  });
}

async function downloadVeoFile(fileUri: string): Promise<Buffer> {
  // Veo file URIs are absolute and require the same x-goog-api-key header to download.
  const response = await http.get<ArrayBuffer>(fileUri, {
    responseType: 'arraybuffer',
    baseURL: '',
  });
  return Buffer.from(response.data);
}

async function generateOneClip(scene: Scene): Promise<MediaAsset> {
  const operation = await startVeoGeneration(scene);
  const fileUri = operation.done
    ? operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
    : await pollVeoOperation(operation.name, scene.index);

  if (!fileUri) {
    throw new Error(`Veo did not return a video for scene ${scene.index}`);
  }

  // Fal's stitch step needs a public URL, so re-host the Veo clip on Fal's CDN.
  const buffer = await downloadVeoFile(fileUri);
  const url = await uploadBufferToFal(buffer, `scene-${scene.index}.mp4`, 'video/mp4');
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
