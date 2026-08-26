import type { ApprovalDecision } from '../types/pipeline.js';
import { logger } from './logger.js';

interface PendingApproval {
  resolve: (decision: ApprovalDecision) => void;
  settled: boolean;
}

const pending = new Map<string, PendingApproval>();

export function waitForApproval(runId: string, timeoutMs: number): Promise<ApprovalDecision> {
  return new Promise((resolve, reject) => {
    if (pending.has(runId)) {
      reject(new Error(`Approval wait already registered for run ${runId}`));
      return;
    }

    const entry: PendingApproval = {
      settled: false,
      resolve: (decision) => {
        if (entry.settled) return;
        entry.settled = true;
        pending.delete(runId);
        resolve(decision);
      },
    };
    pending.set(runId, entry);

    setTimeout(() => {
      if (entry.settled) return;
      logger.warn({ runId }, 'approval timed out');
      entry.resolve('cancel');
    }, timeoutMs);
  });
}

export function settleApproval(runId: string, decision: ApprovalDecision): 'ok' | 'already_settled' | 'unknown' {
  const entry = pending.get(runId);
  if (!entry) return 'unknown';
  if (entry.settled) return 'already_settled';
  entry.resolve(decision);
  return 'ok';
}

export function isApprovalPending(runId: string): boolean {
  return pending.has(runId);
}

// --- Manual clip submission (the operator generates the whole clip themselves,
// e.g. in the Gemini app, and sends the resulting single video file back to the bot) ---

interface PendingClip {
  runId: string;
  resolve: (buffer: Buffer) => void;
  reject: (err: Error) => void;
  settled: boolean;
}

const pendingClips = new Map<string, PendingClip>();
// FIFO queue per chat: when multiple runs are waiting on clips at once (e.g. one prompt
// per channel sent back-to-back), each video the operator sends is matched to the run
// that started waiting first — i.e. the order the prompts were sent in.
const clipQueueByChat = new Map<string, string[]>();

export function waitForClip(runId: string, timeoutMs: number, chatId: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (pendingClips.has(runId)) {
      reject(new Error(`Clip wait already registered for run ${runId}`));
      return;
    }

    const timeoutHandle = setTimeout(() => {
      const entry = pendingClips.get(runId);
      if (!entry || entry.settled) return;
      entry.settled = true;
      pendingClips.delete(runId);
      const queue = clipQueueByChat.get(chatId);
      if (queue) {
        const idx = queue.indexOf(runId);
        if (idx !== -1) queue.splice(idx, 1);
      }
      logger.warn({ runId }, 'manual clip submission timed out');
      reject(new Error(`Timed out waiting for the manually generated clip for run ${runId}`));
    }, timeoutMs);

    pendingClips.set(runId, {
      runId,
      settled: false,
      resolve: (buffer) => {
        clearTimeout(timeoutHandle);
        resolve(buffer);
      },
      reject: (err) => {
        clearTimeout(timeoutHandle);
        reject(err);
      },
    });

    const queue = clipQueueByChat.get(chatId) ?? [];
    queue.push(runId);
    clipQueueByChat.set(chatId, queue);
  });
}

// Called by the Telegram bot when the person replies with a finished video clip.
// Matches it to the oldest still-waiting run for this chat (FIFO).
export function submitClip(chatId: string, buffer: Buffer): { runId: string; remaining: number } | null {
  const queue = clipQueueByChat.get(chatId);
  if (!queue || queue.length === 0) return null;

  const runId = queue.shift()!;
  if (queue.length === 0) clipQueueByChat.delete(chatId);
  else clipQueueByChat.set(chatId, queue);

  const entry = pendingClips.get(runId);
  if (!entry || entry.settled) {
    return submitClip(chatId, buffer); // this run already resolved/timed out; try the next one
  }

  entry.settled = true;
  pendingClips.delete(runId);
  entry.resolve(buffer);
  return { runId, remaining: queue.length };
}

export function isAwaitingClip(chatId: string): boolean {
  const queue = clipQueueByChat.get(chatId);
  return !!queue && queue.length > 0;
}
