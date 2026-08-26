import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { isApprovalPending, isAwaitingClip, settleApproval, submitClip } from '../core/runContext.js';
import type { ApprovalDecision } from '../types/pipeline.js';

export const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

const processedDecisions = new Map<string, ApprovalDecision>();
const TELEGRAM_VIDEO_LIMIT = 45 * 1024 * 1024;

function isAuthorized(chatId: number | string): boolean {
  return String(chatId) === env.TELEGRAM_ADMIN_CHAT_ID;
}

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

// Manually triggers a run on demand via /run (all channels) or /run <channel_id>
// (a single channel). Dynamically imported to avoid a module-load cycle (pipeline.ts
// imports from this file too).
async function triggerManualRun(
  ctx: { reply: (text: string) => Promise<unknown> },
  channelId?: string,
): Promise<void> {
  const { CHANNELS } = await import('../channels/channels.js');
  const { isChannelRunning, runChannelPipeline, runAllChannels } = await import('../core/pipeline.js');

  if (!channelId) {
    const busy = CHANNELS.filter((c) => isChannelRunning(c.id));
    if (busy.length > 0) {
      await ctx.reply(`⏳ Already running: ${busy.map((c) => c.label).join(', ')}. Wait or run a specific channel.`);
      return;
    }
    await ctx.reply(`🚀 Starting all ${CHANNELS.length} channels… prompts incoming shortly.`);
    runAllChannels()
      .then((summary) => logger.info({ summary }, 'manual /run (all channels) finished'))
      .catch((error: unknown) => logger.error({ err: error }, 'manual /run (all channels) failed'));
    return;
  }

  const channel = CHANNELS.find((c) => c.id === channelId);
  if (!channel) {
    await ctx.reply(
      `Unknown channel "${channelId}". Available: ${CHANNELS.map((c) => c.id).join(', ')}`,
    );
    return;
  }
  if (isChannelRunning(channel.id)) {
    await ctx.reply(`⏳ ${channel.label} is already running.`);
    return;
  }

  await ctx.reply(`🚀 Starting ${channel.label}… prompt incoming shortly.`);
  runChannelPipeline(channel)
    .then((result) => logger.info({ result }, 'manual /run (single channel) finished'))
    .catch((error: unknown) => logger.error({ err: error, channel: channel.id }, 'manual /run (single channel) failed'));
}

bot.command('run', async (ctx) => {
  if (!ctx.chat || !isAuthorized(ctx.chat.id)) {
    await ctx.reply('⛔ Not authorized to trigger runs from this chat.');
    return;
  }
  const arg = ctx.match?.toString().trim();
  await triggerManualRun(ctx, arg || undefined);
});

bot.command(['status', 'start'], async (ctx) => {
  if (!ctx.chat || !isAuthorized(ctx.chat.id)) return;
  const { CHANNELS } = await import('../channels/channels.js');
  const { getRunningChannels } = await import('../core/pipeline.js');
  const running = getRunningChannels();
  const lines = [
    running.length > 0 ? `⏳ Currently running: ${running.join(', ')}` : 'Idle.',
    '',
    'Commands: /run (all channels), /run <id> (one channel), /report (today\'s stats).',
    `Channels: ${CHANNELS.map((c) => c.id).join(', ')}`,
  ];
  await ctx.reply(lines.join('\n'));
});

bot.command('report', async (ctx) => {
  if (!ctx.chat || !isAuthorized(ctx.chat.id)) return;
  await ctx.reply('📊 Fetching today\'s analytics…');
  try {
    const { sendDailyReport } = await import('../reporting/dailyReport.js');
    await sendDailyReport();
  } catch (error) {
    logger.error({ err: error }, 'manual /report failed');
    await ctx.reply('⚠️ Failed to generate the report — check the logs.');
  }
});

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

// Receives the manually generated video clip for whichever run this chat is currently
// expected to submit one for. The person just sends the finished video as a reply.
bot.on(['message:video', 'message:document'], async (ctx) => {
  const chatId = String(ctx.chat.id);
  if (!isAwaitingClip(chatId)) {
    return; // Not currently expecting a clip from this chat; ignore.
  }

  const file = ctx.message.video ?? ctx.message.document;
  if (!file) return;

  if (ctx.message.document && !(ctx.message.document.mime_type ?? '').startsWith('video/')) {
    await ctx.reply('That file does not look like a video — please send an .mp4 clip.');
    return;
  }

  try {
    const telegramFile = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${telegramFile.file_path}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download clip from Telegram: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    const result = submitClip(chatId, buffer);
    if (!result) {
      await ctx.reply('No active run is waiting for a clip right now.');
      return;
    }

    await ctx.reply(
      result.remaining > 0
        ? `✅ Clip received for run ${result.runId}. ${result.remaining} more clip(s) still expected.`
        : `✅ Clip received for run ${result.runId}. That was the last one — continuing…`,
    );
  } catch (error) {
    logger.error({ err: error, chatId }, 'failed to process incoming clip');
    await ctx.reply('Something went wrong saving that clip — please try sending it again.');
  }
});

bot.catch((err) => {
  logger.error({ err: err.error }, 'telegram bot error');
});

// Sends the single video-generation prompt to the operator so they can paste it into
// a tool like the Gemini app and reply with the resulting clip (video + native audio).
export async function sendVideoPrompt(
  runId: string,
  channelLabel: string,
  videoPrompt: string,
): Promise<void> {
  const text = [
    `🎬 [${channelLabel}] Run ${runId}`,
    '',
    'Paste this into the video generator (e.g. Gemini app → Video):',
    '',
    videoPrompt,
    '',
    `Reply here with the finished clip, in order (clips are matched to runs in the order prompts were sent).`,
    `You have up to ${Math.round(env.MANUAL_CLIP_TIMEOUT_MS / 60_000)} minutes.`,
  ].join('\n');
  await bot.api.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, text);
}

export async function sendApprovalRequest(options: {
  runId: string;
  channelLabel: string;
  idea: string;
  caption: string;
  videoBuffer: Buffer;
}): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text('✅ Опубликовать', `approve:${options.runId}`)
    .text('❌ Отмена', `cancel:${options.runId}`);

  const text = [
    `[${options.channelLabel}] Run_ID: ${options.runId}`,
    '',
    options.idea,
    '',
    options.caption,
  ].join('\n');

  if (options.videoBuffer.byteLength > TELEGRAM_VIDEO_LIMIT) {
    await bot.api.sendMessage(
      env.TELEGRAM_ADMIN_CHAT_ID,
      `${text}\n\n⚠️ Clip is larger than Telegram's ${TELEGRAM_VIDEO_LIMIT / 1024 / 1024}MB limit and cannot be previewed here.`,
      { reply_markup: keyboard },
    );
    return;
  }

  await bot.api.sendVideo(
    env.TELEGRAM_ADMIN_CHAT_ID,
    new InputFile(options.videoBuffer, `${options.runId}.mp4`),
    { caption: text.slice(0, 1024), reply_markup: keyboard },
  );
}

export function markApprovalProcessed(runId: string, decision: ApprovalDecision): void {
  processedDecisions.set(runId, decision);
}
