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

interface PostizPostValue {
  content: string;
  image?: Array<{ id: string }>;
}

interface CreatePostPayload {
  type: 'now' | 'schedule' | 'draft';
  date: string;
  shortLink: boolean;
  tags: unknown[];
  posts: Array<{
    integration: { id: string };
    value: PostizPostValue[];
    settings: Record<string, unknown>;
  }>;
}

interface CreatePostResponseItem {
  id?: string;
  integration?: { id?: string };
  releaseURL?: string;
  postId?: string;
  [key: string]: unknown;
}

export async function publishViaPostiz(
  mediaId: string,
  caption: string,
  integrationIds: string[],
): Promise<PostizPublishResult[]> {
  return withRetry(async () => {
    // YouTube (and likely other networks) require network-specific settings on each post.
    // title must be 2-100 chars; we derive it from the caption since we don't generate
    // a separate title upstream.
    const title = caption.replace(/\s+/g, ' ').trim().slice(0, 100) || 'Untitled';
    const safeTitle = title.length >= 2 ? title : `${title} video`.slice(0, 100);

    const payload: CreatePostPayload = {
      type: 'now',
      date: new Date().toISOString(),
      shortLink: false,
      tags: [],
      posts: integrationIds.map((integrationId) => ({
        integration: { id: integrationId },
        value: [{ content: caption, image: [{ id: mediaId }] }],
        settings: { title: safeTitle, type: 'public' },
      })),
    };

    const { data } = await http.post<CreatePostResponseItem[] | { results?: PostizPublishResult[] }>(
      '/api/public/v1/posts',
      payload,
    );
    assertJsonResponse(data, '/public/v1/posts');

    // Postiz's create-post response shape varies by version; normalize it into our
    // per-integration result type regardless of which shape comes back.
    if (Array.isArray(data)) {
      return data.map((item, index) => ({
        integrationId: item.integration?.id ?? integrationIds[index] ?? 'unknown',
        status: 'success' as const,
        postUrl: typeof item.releaseURL === 'string' ? item.releaseURL : undefined,
      }));
    }

    const results = data.results;
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error(`Postiz publish returned an unrecognized response shape: ${JSON.stringify(data)}`);
    }
    return results;
  }, 'postiz.publish');
}
