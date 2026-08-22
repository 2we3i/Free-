import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { isApprovalPending, settleApproval } from '../core/runContext.js';
import type { ApprovalDecision } from '../types/pipeline.js';

export const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

const processedDecisions = new Map<string, ApprovalDecision>();
const TELEGRAM_VIDEO_LIMIT = 45 * 1024 * 1024;

function parseCallback(data: string): { decision: ApprovalDecision; runId: string } | null {
  if (data.startsWith('approve:')) return { decision: 'approve', runId: data.slice('approve:'.length) };
  if (data.startsWith('cancel:')) return { decision: 'cancel', runId: data.slice('cancel:'.length) };
  return null;
}

async function clearKeyboard(chatId: number, messageId: number): Promise<void> {
  try {
    await bot.api.editMessageReplyMarkup(chatId, messageId, { reply_markup: undefined });
  } catch (error) {
    logger.warn({ err: error, chatId, messageId }, 'failed to clear approval keyboard');
  }
}

bot.callbackQuery(/^(approve|cancel):.+/, async (ctx) => {
  const parsed = parseCallback(ctx.callbackQuery.data ?? '');
  if (!parsed) {
    await ctx.answerCallbackQuery({ text: 'Unknown callback', show_alert: true });
    return;
  }

  const prior = processedDecisions.get(parsed.runId);
  if (prior) {
    await ctx.answerCallbackQuery({
      text: `Run ${parsed.runId} already ${prior === 'approve' ? 'approved' : 'cancelled'}`,
      show_alert: true,
    });
    return;
  }

  if (!isApprovalPending(parsed.runId)) {
    await ctx.answerCallbackQuery({
      text: `No pending approval for ${parsed.runId}`,
      show_alert: true,
    });
    return;
  }

  const result = settleApproval(parsed.runId, parsed.decision);
  if (result !== 'ok') {
    await ctx.answerCallbackQuery({
      text: result === 'already_settled' ? 'This run was already handled' : 'Run is not waiting for approval',
      show_alert: true,
    });
    return;
  }

  processedDecisions.set(parsed.runId, parsed.decision);
  if (ctx.chat && ctx.callbackQuery.message) {
    await clearKeyboard(ctx.chat.id, ctx.callbackQuery.message.message_id);
  }
  await ctx.answerCallbackQuery({
    text: parsed.decision === 'approve' ? 'Approved. Publishing…' : 'Cancelled.',
  });
  await ctx.reply(
    parsed.decision === 'approve'
      ? `✅ Run ${parsed.runId} approved`
      : `❌ Run ${parsed.runId} cancelled`,
  );
});

bot.catch((err) => {
  logger.error({ err: err.error }, 'telegram bot error');
});

export async function sendApprovalRequest(options: {
  runId: string;
  idea: string;
  caption: string;
  videoUrl: string;
  videoBuffer: Buffer;
}): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text('✅ Опубликовать', `approve:${options.runId}`)
    .text('❌ Отмена', `cancel:${options.runId}`);

  const text = [
    `Run_ID: ${options.runId}`,
    '',
    options.idea,
    '',
    options.caption,
  ].join('\n');

  if (options.videoBuffer.byteLength <= TELEGRAM_VIDEO_LIMIT) {
    await bot.api.sendVideo(
      env.TELEGRAM_ADMIN_CHAT_ID,
      new InputFile(options.videoBuffer, `${options.runId}.mp4`),
      { caption: text.slice(0, 1024), reply_markup: keyboard },
    );
    return;
  }

  await bot.api.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, `${text}\n\nVideo: ${options.videoUrl}`, {
    reply_markup: keyboard,
  });
}

export function markApprovalProcessed(runId: string, decision: ApprovalDecision): void {
  processedDecisions.set(runId, decision);
}
