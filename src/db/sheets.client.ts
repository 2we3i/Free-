import { JWT } from 'google-auth-library';
import { GoogleSpreadsheet, type GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { withRetry } from '../core/retry.js';
import type { PipelineStatus } from '../types/pipeline.js';

const HEADERS = ['Run_ID', 'Status', 'Idea', 'Video_URL', 'Post_Links', 'Error', 'Timestamp'] as const;

export interface SheetRowPatch {
  Status?: PipelineStatus;
  Idea?: string;
  Video_URL?: string;
  Post_Links?: string;
  Error?: string;
}

let sheet: GoogleSpreadsheetWorksheet | null = null;

async function getSheet(): Promise<GoogleSpreadsheetWorksheet> {
  if (sheet) return sheet;

  const auth = new JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(env.GOOGLE_SHEETS_ID, auth);
  await withRetry(() => doc.loadInfo(), 'sheets:loadInfo');

  const existing = doc.sheetsByTitle[env.GOOGLE_SHEETS_TAB] ?? doc.sheetsByIndex[0];
  if (!existing) {
    throw new Error(`Google Sheet tab "${env.GOOGLE_SHEETS_TAB}" was not found`);
  }
  await withRetry(() => existing.setHeaderRow([...HEADERS]), 'sheets:setHeaderRow');
  sheet = existing;
  return existing;
}

export async function createRunRow(runId: string, idea: string): Promise<void> {
  const worksheet = await getSheet();
  await withRetry(
    () =>
      worksheet.addRow({
        Run_ID: runId,
        Status: 'GENERATING_SCRIPT',
        Idea: idea,
        Video_URL: '',
        Post_Links: '',
        Error: '',
        Timestamp: new Date().toISOString(),
      }),
    'sheets:addRow',
  );
  logger.info({ runId }, 'sheet row created');
}

export interface CompletedRun {
  runId: string;
  idea: string;
  postLinks: string;
  timestamp: string;
}

// Returns all runs marked DONE whose Timestamp falls on today's date (in the given
// timezone), for the end-of-day analytics report.
export async function getTodaysDoneRuns(timezone: string): Promise<CompletedRun[]> {
  const worksheet = await getSheet();
  await withRetry(() => worksheet.loadHeaderRow(), 'sheets:loadHeaderRow');
  const rows = await withRetry(() => worksheet.getRows(), 'sheets:getRows');

  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD

  return rows
    .filter((row) => {
      if (row.get('Status') !== 'DONE') return false;
      const ts = row.get('Timestamp');
      if (!ts) return false;
      const rowKey = new Date(ts).toLocaleDateString('en-CA', { timeZone: timezone });
      return rowKey === todayKey;
    })
    .map((row) => ({
      runId: row.get('Run_ID') ?? '',
      idea: row.get('Idea') ?? '',
      postLinks: row.get('Post_Links') ?? '',
      timestamp: row.get('Timestamp') ?? '',
    }));
}

export async function updateRunRow(runId: string, patch: SheetRowPatch): Promise<void> {
  const worksheet = await getSheet();

  // Google Sheets can briefly lag between a row being added and it showing up in a
  // subsequent read, especially when update calls happen right after create. Retry
  // the row lookup a few times before giving up.
  let row: Awaited<ReturnType<typeof worksheet.getRows>>[number] | undefined;
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await withRetry(() => worksheet.loadHeaderRow(), 'sheets:loadHeaderRow');
    const rows = await withRetry(() => worksheet.getRows(), 'sheets:getRows');
    row = rows.find((item) => item.get('Run_ID') === runId);
    if (row) break;
    if (attempt < maxAttempts) {
      logger.warn({ runId, attempt }, 'sheet row not found yet, retrying lookup');
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }

  if (!row) {
    throw new Error(`Sheet row for run ${runId} was not found`);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) row.set(key, value);
  }
  row.set('Timestamp', new Date().toISOString());
  await withRetry(() => row!.save(), 'sheets:saveRow');
  logger.info({ runId, patch }, 'sheet row updated');
}
