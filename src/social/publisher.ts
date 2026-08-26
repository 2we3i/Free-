import { uploadToPostiz, publishViaPostiz } from '../hosting/postiz.client.js';

// Publishes to exactly one Postiz integration (each channel in the multi-channel
// pipeline has its own dedicated YouTube integration id — see channels.ts).
export async function uploadAndPublishToIntegration(
  buffer: Buffer,
  caption: string,
  filename: string,
  integrationId: string,
): Promise<{ link?: string; error?: string; mediaId: string }> {
  const media = await uploadToPostiz(buffer, filename);
  const results = await publishViaPostiz(media, caption, [integrationId]);
  const result = results[0];

  if (!result || result.status !== 'success' || !result.postUrl) {
    return { error: result?.error ?? 'Postiz integration publish failed', mediaId: media.id };
  }
  return { link: result.postUrl, mediaId: media.id };
}
