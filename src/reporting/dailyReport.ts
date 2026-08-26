import { CHANNELS } from '../channels/channels.js';
import { env } from '../config/env.js';
import { getTodaysDoneRuns } from '../db/sheets.client.js';
import { fetchAnalytics } from '../hosting/postiz.client.js';
import { logger } from '../core/logger.js';
import { bot } from '../telegram/bot.js';

// Postiz's analytics endpoint reports account-level metrics for the lookback window,
// not strictly per-post — but since each channel publishes at most a few times a day,
// a 1-day lookback is a reasonable proxy for "how did today's post(s) do".
const ANALYTICS_LOOKBACK_DAYS = 1;

function formatMetrics(metrics: Array<{ label: string; value: number }>): string {
  if (metrics.length === 0) return '  (no analytics data available yet)';
  return metrics.map((m) => `  ${m.label}: ${m.value}`).join('\n');
}

export async function sendDailyReport(): Promise<void> {
  logger.info('generating daily report');

  const runs = await getTodaysDoneRuns(env.TZ);
  if (runs.length === 0) {
    await bot.api.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, '📊 Daily report: no videos were published today.');
    return;
  }

  const sections: string[] = [`📊 Daily report — ${runs.length} video(s) published today`, ''];

  for (const channel of CHANNELS) {
    if (!channel.postizIntegrationId) continue;
    try {
      const metrics = await fetchAnalytics(channel.postizIntegrationId, ANALYTICS_LOOKBACK_DAYS);
      sections.push(`${channel.label}:`, formatMetrics(metrics), '');
    } catch (error) {
      logger.error({ err: error, channel: channel.id }, 'failed to fetch analytics for daily report');
      sections.push(`${channel.label}: ⚠️ failed to fetch analytics`, '');
    }
  }

  sections.push('Today\'s videos:');
  for (const run of runs) {
    sections.push(`• ${run.idea.slice(0, 80)}${run.idea.length > 80 ? '…' : ''}`);
    if (run.postLinks) sections.push(`  ${run.postLinks}`);
  }

  await bot.api.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, sections.join('\n'));
  logger.info({ runs: runs.length }, 'daily report sent');
}
