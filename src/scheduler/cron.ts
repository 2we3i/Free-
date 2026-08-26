import cron from 'node-cron';
import { CHANNELS } from '../channels/channels.js';
import { env } from '../config/env.js';
import { isChannelRunning, runChannelPipeline } from '../core/pipeline.js';
import { logger } from '../core/logger.js';
import { alertDeveloper } from '../telegram/alerts.js';
import { sendDailyReport } from '../reporting/dailyReport.js';

function triggerChannelRun(channelId: string, schedule: string): void {
  const channel = CHANNELS.find((c) => c.id === channelId);
  if (!channel) return;

  if (isChannelRunning(channel.id)) {
    logger.warn({ channel: channel.id, schedule }, 'cron tick skipped, channel already running');
    return;
  }
  logger.info({ channel: channel.id, schedule }, 'cron triggered channel run');
  void runChannelPipeline(channel).catch((error: unknown) => {
    logger.error({ err: error, channel: channel.id, schedule }, 'cron channel run failed');
    void alertDeveloper(error, channel.label);
  });
}

export function startScheduler(): void {
  for (const channel of CHANNELS) {
    const schedules = channel.cronSchedule
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (schedules.length === 0) {
      throw new Error(`Channel "${channel.id}" has no cron schedule configured`);
    }

    for (const schedule of schedules) {
      if (!cron.validate(schedule)) {
        throw new Error(`Invalid cron schedule for channel "${channel.id}": "${schedule}"`);
      }
      cron.schedule(schedule, () => triggerChannelRun(channel.id, schedule), { timezone: env.TZ });
    }

    logger.info({ channel: channel.id, schedules }, 'channel schedule registered');
  }

  if (!cron.validate(env.DAILY_REPORT_CRON)) {
    throw new Error(`Invalid DAILY_REPORT_CRON: "${env.DAILY_REPORT_CRON}"`);
  }
  cron.schedule(
    env.DAILY_REPORT_CRON,
    () => {
      logger.info('cron triggered daily report');
      void sendDailyReport().catch((error: unknown) => {
        logger.error({ err: error }, 'daily report failed');
        void alertDeveloper(error);
      });
    },
    { timezone: env.TZ },
  );

  logger.info({ dailyReport: env.DAILY_REPORT_CRON, tz: env.TZ }, 'scheduler started');
}
