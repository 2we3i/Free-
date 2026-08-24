import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { withRetry } from '../core/retry.js';
import { createHttpClient } from '../http/client.js';

if (!env.POSTIZ_BASE_URL || env.POSTIZ_BASE_URL.includes('your-postiz-instance')) {
  logger.error({ POSTIZ_BASE_URL: env.POSTIZ_BASE_URL }, 'POSTIZ_BASE_URL looks unset or placeholder');
}
if (!env.POSTIZ_API_KEY || env.POSTIZ_API_KEY.includes('placeholder')) {
  logger.error('POSTIZ_API_KEY looks unset or placeholder');
}

const http = createHttpClient('postiz', {
  baseURL: env.POSTIZ_BASE_URL,
  headers: { Authorization: env.POSTIZ_API_KEY },
  timeout: 60_000,
});

export interface PostizPublishResult {
  integrationId: string;
  status: 'success' | 'error';
  postUrl?: string;
  error?: string;
}

interface UploadResponse {
  id?: string;
  url?: string;
  media_id?: string;
}

interface PublishResponse {
  results?: PostizPublishResult[];
}

function assertJsonResponse(data: unknown, context: string): void {
  if (typeof data === 'string' && data.trim().startsWith('<')) {
    throw new Error(
      `Postiz returned an HTML page instead of JSON for ${context}. This usually means ` +
        `POSTIZ_BASE_URL is pointing at the frontend instead of the API, the API key is wrong, ` +
        `or the request was redirected to a login page. Check POSTIZ_BASE_URL="${env.POSTIZ_BASE_URL}" ` +
        `and that the API key in Postiz Settings → Public API matches POSTIZ_API_KEY exactly.`,
    );
  }
}

export async function uploadToPostiz(buffer: Buffer, filename: string): Promise<string> {
  return withRetry(async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: 'video/mp4' }), filename);
    const { data } = await http.post<UploadResponse>('/api/public/v1/upload', form, {
      timeout: 180_000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    assertJsonResponse(data, '/public/v1/upload');
    const mediaId = data.id ?? data.media_id;
    if (!mediaId) {
      logger.error({ response: data }, 'Postiz upload response missing id/media_id field');
      throw new Error(
        `Postiz upload succeeded but no media id was returned. Response: ${JSON.stringify(data)}`,
      );
    }
    return mediaId;
  }, 'postiz.upload');
}

export async function publishViaPostiz(
  mediaId: string,
  caption: string,
  integrationIds: string[],
): Promise<PostizPublishResult[]> {
  return withRetry(async () => {
    const { data } = await http.post<PublishResponse>('/api/public/v1/posts', {
      integrationIds,
      content: caption,
      media: [mediaId],
    });
    assertJsonResponse(data, '/public/v1/posts');
    const results = data.results;
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error('Postiz publish returned no per-integration results');
    }
    return results;
  }, 'postiz.publish');
}
