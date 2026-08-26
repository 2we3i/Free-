import { randomUUID } from 'node:crypto';
import type { ChannelConfig } from '../channels/channels.js';
import { CHANNELS } from '../channels/channels.js';
import { env } from '../config/env.js';
import { updateRunRow, createRunRow } from '../db/sheets.client.js';
import { generateScriptForChannel } from '../llm/scriptGenerator.js';
import { getManualClip } from '../media/videoWorker.js';
import { uploadAndPublishToIntegration } from '../social/publisher.js';
import { alertDeveloper } from '../telegram/alerts.js';
import { markApprovalProcessed, sendApprovalRequest } from '../telegram/bot.js';
import { waitForApproval } from './runContext.js';
import { logger } from './logger.js';

// Tracks which channels currently have a run in progress, since each channel now runs
// on its own independent schedule and can overlap with another channel's run.
const runningChannels = new Set<string>();

export function isChannelRunning(channelId: string): boolean {
  return runningChannels.has(channelId);
}

export function isPipelineRunning(): boolean {
  return runningChannels.size > 0;
}

export function getRunningChannels(): string[] {
  return Array.from(runningChannels);
}

// Runs the full pipeline (idea -> prompt -> manual clip -> approval -> publish) for a
// single channel. Each channel's cron schedule calls this independently, and multiple
// channels can be mid-run at the same time.
export async function runChannelPipeline(channel: ChannelConfig): Promise<{ runId: string; status: string }> {
  if (runningChannels.has(channel.id)) {
    logger.warn({ channel: channel.id }, 'channel run already in progress, skipping overlapping start');
    throw new Error(`Channel "${channel.id}" already has a run in progress`);
  }
  runningChannels.add(channel.id);

  const runId = randomUUID();
  logger.info({ runId, channel: channel.id }, 'channel pipeline started');

  try {
    if (!channel.postizIntegrationId) {
      throw new Error(`No Postiz integration id configured for channel "${channel.id}"`);
    }

    const script = await generateScriptForChannel(channel);
    await createRunRow(runId, `[${channel.label}] ${script.idea}`);
    await updateRunRow(runId, { Status: 'AWAITING_CLIP', Idea: script.idea });

    const clipBuffer = await getManualClip(runId, channel.label, script.videoPrompt);
    await updateRunRow(runId, { Status: 'AWAITING_APPROVAL' });

    const approval = waitForApproval(runId, env.APPROVAL_TIMEOUT_MS);
    await sendApprovalRequest({
      runId,
      channelLabel: channel.label,
      idea: script.idea,
      caption: script.caption,
      videoBuffer: clipBuffer,
    });
    const decision = await approval;
    markApprovalProcessed(runId, decision);

    if (decision !== 'approve') {
      await updateRunRow(runId, { Status: 'CANCELLED' });
      logger.info({ runId, channel: channel.id }, 'channel pipeline cancelled before publish');
      return { runId, status: 'CANCELLED' };
    }

    await updateRunRow(runId, { Status: 'PUBLISHING' });
    const published = await uploadAndPublishToIntegration(
      clipBuffer,
      script.caption,
      `${runId}.mp4`,
      channel.postizIntegrationId,
    );

    if (!published.link) {
      await updateRunRow(runId, {
        Status: 'ERROR',
        Post_Links: '',
        Error: published.error ?? 'Unknown publish error',
      });
      throw new Error(`Publish failed for channel ${channel.id}: ${published.error}`);
    }

    await updateRunRow(runId, {
      Status: 'DONE',
      Post_Links: `${channel.label}: ${published.link}`,
    });
    logger.info({ runId, channel: channel.id, link: published.link }, 'channel pipeline completed');
    return { runId, status: 'DONE' };
  } catch (error) {
    logger.error({ err: error, runId, channel: channel.id }, 'channel pipeline failed');
    try {
      await updateRunRow(runId, {
        Status: 'ERROR',
        Error: error instanceof Error ? error.message : String(error),
      });
    } catch (sheetError) {
      logger.error({ err: sheetError, runId }, 'failed to mark ERROR in sheets (row may not exist yet)');
    }
    await alertDeveloper(error, `${runId} (${channel.label})`);
    return { runId, status: 'ERROR' };
  } finally {
    runningChannels.delete(channel.id);
  }
}

// Manually triggers every configured channel at once (used by the /run command for
// on-demand testing). Channels run concurrently and don't block each other.
export async function runAllChannels(): Promise<string> {
  logger.info({ channels: CHANNELS.map((c) => c.id) }, 'manual run: all channels triggered');

  const results = await Promise.allSettled(CHANNELS.map((channel) => runChannelPipeline(channel)));
  const summary = results
    .map((result, index) => {
      const channel = CHANNELS[index]!;
      if (result.status === 'fulfilled') {
        return `${channel.label}: ${result.value.status} (${result.value.runId})`;
      }
      return `${channel.label}: FAILED (${result.reason instanceof Error ? result.reason.message : result.reason})`;
    })
    .join('\n');
  logger.info({ summary }, 'manual run: all channels finished');
  return summary;
}
