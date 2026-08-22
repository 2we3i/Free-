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
