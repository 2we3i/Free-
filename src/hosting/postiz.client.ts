import { env } from '../config/env.js';
import { withRetry } from '../core/retry.js';
import { createHttpClient } from '../http/client.js';

const http = createHttpClient('postiz', {
  baseURL: env.POSTIZ_BASE_URL,
  headers: { Authorization: `Bearer ${env.POSTIZ_API_KEY}` },
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

export async function uploadToPostiz(buffer: Buffer, filename: string): Promise<string> {
  return withRetry(async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: 'video/mp4' }), filename);
    const { data } = await http.post<UploadResponse>('/public/v1/upload', form, {
      timeout: 180_000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    const mediaId = data.id ?? data.media_id;
    if (!mediaId) {
      throw new Error('Postiz upload succeeded but no media id was returned');
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
    const { data } = await http.post<PublishResponse>('/public/v1/posts', {
      integrationIds,
      content: caption,
      media: [mediaId],
    });
    const results = data.results;
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error('Postiz publish returned no per-integration results');
    }
    return results;
  }, 'postiz.publish');
}
