import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { bot } from './bot.js';

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ''}`;
  }
  return String(error);
}

export async function alertDeveloper(error: unknown, runId?: string): Promise<void> {
  const body = [
    '🚨 Pipeline failure',
    runId ? `Run_ID: ${runId}` : undefined,
    '',
    formatError(error),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 3900);

  logger.error({ err: error, runId }, 'alerting developer');
  try {
    await bot.api.sendMessage(env.TELEGRAM_DEV_CHAT_ID, body);
  } catch (sendError) {
    logger.error({ err: sendError }, 'failed to send developer alert');
  }
}
