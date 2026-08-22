import { env } from '../config/env.js';
import { createHttpClient } from '../http/client.js';
import { withRetry } from '../core/retry.js';

// Fal's raw REST upload flow (no client library):
// 1) POST /storage/upload/initiate -> { file_url, upload_url }
// 2) PUT the raw bytes to upload_url
// Docs: https://docs.fal.ai/model-apis/model-endpoints (file uploads)
const storageApi = createHttpClient('fal-storage', {
  baseURL: 'https://rest.alpha.fal.ai',
  headers: {
    Authorization: `Key ${env.FAL_KEY}`,
    'Content-Type': 'application/json',
  },
});

interface InitiateUploadResponse {
  file_url: string;
  upload_url: string;
}

export async function uploadBufferToFal(
  buffer: Buffer,
  fileName: string,
  contentType: string,
): Promise<string> {
  const initiate = await withRetry(async () => {
    const response = await storageApi.post<InitiateUploadResponse>(
      '/storage/upload/initiate?storage_type=fal-cdn-v3',
      { content_type: contentType, file_name: fileName },
    );
    return response.data;
  }, `fal-storage:initiate:${fileName}`);

  await withRetry(async () => {
    const uploadClient = createHttpClient('fal-storage-put', {
      headers: { 'Content-Type': contentType },
    });
    await uploadClient.put(initiate.upload_url, buffer, {
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
  }, `fal-storage:put:${fileName}`);

  return initiate.file_url;
}
