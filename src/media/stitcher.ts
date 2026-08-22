import { downloadBuffer } from '../http/client.js';
import { logger } from '../core/logger.js';
import { stitchVideo } from './audioWorker.js';

export interface StitchedVideo {
  url: string;
  buffer: Buffer;
}

export async function stitchAndDownload(clipUrls: string[], audioUrls: string[]): Promise<StitchedVideo> {
  if (clipUrls.length === 0) {
    throw new Error('Cannot stitch video without successful clips');
  }
  const url = await stitchVideo(clipUrls, audioUrls);
  logger.info({ url, clips: clipUrls.length, audio: audioUrls.length }, 'stitch completed');
  const buffer = await downloadBuffer(url);
  return { url, buffer };
}
