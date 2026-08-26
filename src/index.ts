import { logger } from './core/logger.js';
import { runAllChannels } from './core/pipeline.js';
import { startScheduler } from './scheduler/cron.js';
import { alertDeveloper } from './telegram/alerts.js';
import { bot } from './telegram/bot.js';

function installProcessHandlers(): void {
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandledRejection');
    void alertDeveloper(reason);
  });
  process.on('uncaughtException', (error) => {
    logger.error({ err: error }, 'uncaughtException');
    void alertDeveloper(error);
  });
}

function startBot(): Promise<void> {
  return new Promise((resolve, reject) => {
    void bot.start({
      onStart: (info) => {
        logger.info({ username: info.username }, 'telegram bot started');
        resolve();
      },
    }).catch(reject);
  });
}

async function main(): Promise<void> {
  installProcessHandlers();
  await startBot();
  startScheduler();
  logger.info('ai-video-pipeline is running');
}

async function runOnce(): Promise<void> {
  installProcessHandlers();
  await startBot();
  try {
    const summary = await runAllChannels();
    logger.info({ summary }, 'manual run finished');
  } finally {
    await bot.stop();
  }
}

if (process.argv.includes('--run-now')) {
  void runOnce()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      logger.error({ err: error }, 'manual run failed');
      process.exit(1);
    });
} else {
  void main().catch((error: unknown) => {
    logger.error({ err: error }, 'fatal startup error');
    process.exit(1);
  });
}
