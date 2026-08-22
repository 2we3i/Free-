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

export async function updateRunRow(runId: string, patch: SheetRowPatch): Promise<void> {
  const worksheet = await getSheet();
  await withRetry(() => worksheet.loadHeaderRow(), 'sheets:loadHeaderRow');
  const rows = await withRetry(() => worksheet.getRows(), 'sheets:getRows');
  const row = rows.find((item) => item.get('Run_ID') === runId);
  if (!row) {
    throw new Error(`Sheet row for run ${runId} was not found`);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) row.set(key, value);
  }
  row.set('Timestamp', new Date().toISOString());
  await withRetry(() => row.save(), 'sheets:saveRow');
  logger.info({ runId, patch }, 'sheet row updated');
}
