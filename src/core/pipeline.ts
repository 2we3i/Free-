import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { updateRunRow, createRunRow } from '../db/sheets.client.js';
import { generateScript } from '../llm/scriptGenerator.js';
import { generateSounds } from '../media/audioWorker.js';
import { stitchAndDownload } from '../media/stitcher.js';
import { generateClips } from '../media/videoWorker.js';
import { uploadAndPublish } from '../social/publisher.js';
import { alertDeveloper } from '../telegram/alerts.js';
import { markApprovalProcessed, sendApprovalRequest } from '../telegram/bot.js';
import { waitForApproval } from './runContext.js';
import { logger } from './logger.js';

let running = false;

export async function runPipeline(): Promise<string> {
  if (running) {
    logger.warn('pipeline already running, skipping overlapping start');
    throw new Error('Pipeline is already running');
  }
  running = true;
  const runId = randomUUID();
  logger.info({ runId }, 'pipeline started');

  try {
    const script = await generateScript();
    await createRunRow(runId, script.idea);
    await updateRunRow(runId, { Status: 'GENERATING_MEDIA', Idea: script.idea });

    const [clips, sounds] = await Promise.all([
      generateClips(script.scenes),
      generateSounds(script.scenes),
    ]);

    await updateRunRow(runId, { Status: 'STITCHING' });
    const stitched = await stitchAndDownload(
      clips.map((clip) => clip.url),
      sounds.map((sound) => sound.url),
    );
    await updateRunRow(runId, { Status: 'AWAITING_APPROVAL', Video_URL: stitched.url });

    const approval = waitForApproval(runId, env.APPROVAL_TIMEOUT_MS);
    await sendApprovalRequest({
      runId,
      idea: script.idea,
      caption: script.caption,
      videoUrl: stitched.url,
      videoBuffer: stitched.buffer,
    });
    const decision = await approval;
    markApprovalProcessed(runId, decision);

    if (decision !== 'approve') {
      await updateRunRow(runId, { Status: 'CANCELLED' });
      logger.info({ runId }, 'pipeline cancelled before publish');
      return runId;
    }

    await updateRunRow(runId, { Status: 'PUBLISHING' });
    const published = await uploadAndPublish(stitched.buffer, script.caption, `${runId}.mp4`);

    if (published.links.length === 0) {
      await updateRunRow(runId, {
        Status: 'ERROR',
        Post_Links: '',
        Error: published.errors.join(' | '),
      });
      throw new Error(`All 9 networks failed: ${published.errors.join(' | ')}`);
    }

    await updateRunRow(runId, {
      Status: 'DONE',
      Post_Links: published.links.join(' | '),
      Error: published.errors.join(' | '),
    });
    logger.info({ runId, links: published.links, errors: published.errors }, 'pipeline completed');
    return runId;
  } catch (error) {
    logger.error({ err: error, runId }, 'pipeline failed');
    try {
      await updateRunRow(runId, {
        Status: 'ERROR',
        Error: error instanceof Error ? error.message : String(error),
      });
    } catch (sheetError) {
      logger.error({ err: sheetError, runId }, 'failed to mark ERROR in sheets (row may not exist yet)');
    }
    await alertDeveloper(error, runId);
    throw error;
  } finally {
    running = false;
  }
}

export function isPipelineRunning(): boolean {
  return running;
}
