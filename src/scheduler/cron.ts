import cron from 'node-cron';
import { env } from '../config/env.js';
import { isPipelineRunning, runPipeline } from '../core/pipeline.js';
import { logger } from '../core/logger.js';
import { alertDeveloper } from '../telegram/alerts.js';

export function startScheduler(): void {
  if (!cron.validate(env.CRON_SCHEDULE)) {
    throw new Error(`Invalid CRON_SCHEDULE: ${env.CRON_SCHEDULE}`);
  }

  cron.schedule(
    env.CRON_SCHEDULE,
    () => {
      if (isPipelineRunning()) {
        logger.warn('cron tick skipped because a run is already in progress');
        return;
      }
      logger.info({ schedule: env.CRON_SCHEDULE }, 'cron triggered pipeline');
      void runPipeline().catch((error: unknown) => {
        logger.error({ err: error }, 'cron pipeline failed');
        void alertDeveloper(error);
      });
    },
    { timezone: env.TZ },
  );

  logger.info({ schedule: env.CRON_SCHEDULE, tz: env.TZ }, 'scheduler started');
}
