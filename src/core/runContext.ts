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
  resolve: (buffer: Buffer) => void;
  reject: (err: Error) => void;
  settled: boolean;
}

const pendingClips = new Map<string, PendingClip>();
// Tracks which run a chat is currently expected to submit a clip for.
const activeRunByChat = new Map<string, string>();

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
      activeRunByChat.delete(chatId);
      logger.warn({ runId }, 'manual clip submission timed out');
      reject(new Error(`Timed out waiting for the manually generated clip for run ${runId}`));
    }, timeoutMs);

    pendingClips.set(runId, {
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
    activeRunByChat.set(chatId, runId);
  });
}

// Called by the Telegram bot when the person replies with the finished video clip.
export function submitClip(chatId: string, buffer: Buffer): { runId: string } | null {
  const runId = activeRunByChat.get(chatId);
  if (!runId) return null;

  const entry = pendingClips.get(runId);
  if (!entry || entry.settled) {
    activeRunByChat.delete(chatId);
    return null;
  }

  entry.settled = true;
  pendingClips.delete(runId);
  activeRunByChat.delete(chatId);
  entry.resolve(buffer);
  return { runId };
}

export function isAwaitingClip(chatId: string): boolean {
  return activeRunByChat.has(chatId);
}
