import { ExponentialBackoff, handleAll, retry } from 'cockatiel';
import { logger } from './logger.js';

const policy = retry(handleAll, {
  maxAttempts: 3,
  backoff: new ExponentialBackoff({ initialDelay: 500, maxDelay: 8_000 }),
});

export async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let attempt = 0;
  return policy.execute(async () => {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      logger.warn({ err: error, label, attempt }, 'retryable request failed');
      throw error;
    }
  });
}
