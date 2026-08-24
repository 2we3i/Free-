import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { waitForClip } from '../core/runContext.js';
import { sendVideoPrompt } from '../telegram/bot.js';

// Video is generated manually: the operator gets one self-contained prompt in Telegram,
// generates the clip themselves in a tool like the Gemini app (which produces video with
// native audio in a single pass), and replies to the bot with the resulting video file.
// No stitching or separate audio step is needed since the reply is already the final clip.
export async function getManualClip(runId: string, videoPrompt: string): Promise<Buffer> {
  await sendVideoPrompt(runId, videoPrompt);

  logger.info({ runId }, 'waiting for manually generated clip from Telegram');
  const buffer = await waitForClip(runId, env.MANUAL_CLIP_TIMEOUT_MS, env.TELEGRAM_ADMIN_CHAT_ID);
  return buffer;
}
