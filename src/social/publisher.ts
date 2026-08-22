import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { publishViaPostiz, uploadToPostiz } from '../hosting/postiz.client.js';
import type { Platform, PublishOutcome } from '../types/pipeline.js';
import { PLATFORMS } from '../types/pipeline.js';

const INTEGRATION_MAP: Record<Platform, string> = {
  tiktok: env.POSTIZ_INTEGRATION_TIKTOK,
  linkedin: env.POSTIZ_INTEGRATION_LINKEDIN,
  facebook: env.POSTIZ_INTEGRATION_FACEBOOK,
  instagram: env.POSTIZ_INTEGRATION_INSTAGRAM,
  x: env.POSTIZ_INTEGRATION_X,
  youtube: env.POSTIZ_INTEGRATION_YOUTUBE,
  threads: env.POSTIZ_INTEGRATION_THREADS,
  bluesky: env.POSTIZ_INTEGRATION_BLUESKY,
  pinterest: env.POSTIZ_INTEGRATION_PINTEREST,
};

const idToNetwork = Object.fromEntries(
  Object.entries(INTEGRATION_MAP).map(([name, id]) => [id, name]),
);

export async function publishToAllNetworks(
  mediaId: string,
  caption: string,
): Promise<{ outcomes: PublishOutcome[]; links: string[]; errors: string[] }> {
  const results = await publishViaPostiz(mediaId, caption, Object.values(INTEGRATION_MAP));

  const settled = await Promise.allSettled(
    results.map(async (result) => {
      if (result.status !== 'success' || !result.postUrl) {
        throw new Error(result.error ?? 'Postiz integration publish failed');
      }
      return result;
    }),
  );

  const outcomes: PublishOutcome[] = settled.map((item, index) => {
    const raw = results[index]!;
    const network = idToNetwork[raw.integrationId] ?? raw.integrationId;
    if (item.status === 'fulfilled') {
      return { platform: network, status: 'fulfilled', url: item.value.postUrl };
    }
    const message = item.reason instanceof Error ? item.reason.message : String(item.reason);
    logger.error({ network, err: item.reason }, 'network publish failed');
    return { platform: network, status: 'rejected', error: message };
  });

  const links = outcomes
    .filter((item) => item.status === 'fulfilled' && item.url)
    .map((item) => `${item.platform}: ${item.url}`);
  const errors = outcomes
    .filter((item) => item.status === 'rejected')
    .map((item) => `${item.platform}: ${item.error ?? 'unknown error'}`);

  return { outcomes, links, errors };
}

export async function uploadAndPublish(
  buffer: Buffer,
  caption: string,
  filename: string,
): Promise<{ outcomes: PublishOutcome[]; links: string[]; errors: string[]; mediaId: string }> {
  const mediaId = await uploadToPostiz(buffer, filename);
  const published = await publishToAllNetworks(mediaId, caption);
  return { ...published, mediaId };
}

export { INTEGRATION_MAP, PLATFORMS };
