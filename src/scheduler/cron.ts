import cron from 'node-cron';
import { env } from '../config/env.js';
import { isPipelineRunning, runPipeline } from '../core/pipeline.js';
import { logger } from '../core/logger.js';
import { alertDeveloper } from '../telegram/alerts.js';

function triggerScheduledRun(schedule: string): void {
  if (isPipelineRunning()) {
    logger.warn({ schedule }, 'cron tick skipped because a run is already in progress');
    return;
  }
  logger.info({ schedule }, 'cron triggered pipeline');
  void runPipeline().catch((error: unknown) => {
    logger.error({ err: error, schedule }, 'cron pipeline failed');
    void alertDeveloper(error);
  });
}

export function startScheduler(): void {
  const schedules = env.CRON_SCHEDULE.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (schedules.length === 0) {
    throw new Error('CRON_SCHEDULE must contain at least one cron expression');
  }

  for (const schedule of schedules) {
    if (!cron.validate(schedule)) {
      throw new Error(`Invalid CRON_SCHEDULE entry: "${schedule}"`);
    }
    cron.schedule(schedule, () => triggerScheduledRun(schedule), { timezone: env.TZ });
  }

  logger.info({ schedules, tz: env.TZ }, 'scheduler started');
}
