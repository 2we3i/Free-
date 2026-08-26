import { activeNetworks, env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { publishViaPostiz, uploadToPostiz, type UploadedMedia } from '../hosting/postiz.client.js';
import type { Platform, PublishOutcome } from '../types/pipeline.js';
import { PLATFORMS } from '../types/pipeline.js';

const ALL_INTEGRATIONS: Record<Platform, string> = {
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

// Only publish to the networks explicitly enabled via POSTIZ_ACTIVE_NETWORKS.
const INTEGRATION_MAP: Partial<Record<Platform, string>> = Object.fromEntries(
  Object.entries(ALL_INTEGRATIONS).filter(([platform]) => activeNetworks.includes(platform)),
);

const idToNetwork = Object.fromEntries(
  Object.entries(INTEGRATION_MAP).map(([name, id]) => [id, name]),
);

export async function publishToAllNetworks(
  media: UploadedMedia,
  caption: string,
): Promise<{ outcomes: PublishOutcome[]; links: string[]; errors: string[] }> {
  const results = await publishViaPostiz(media, caption, Object.values(INTEGRATION_MAP) as string[]);

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
  const media = await uploadToPostiz(buffer, filename);
  const published = await publishToAllNetworks(media, caption);
  return { ...published, mediaId: media.id };
}

// Publishes to exactly one Postiz integration (used by the multi-channel pipeline,
// where each channel has its own dedicated YouTube integration id).
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

export { INTEGRATION_MAP, PLATFORMS };
