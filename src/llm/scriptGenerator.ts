import { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import type { GeneratedScript } from '../types/pipeline.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { GeminiProvider } from './providers/gemini.js';
import { ideaLlm, openaiDetailLlm } from './providers/openai.js';
import type { LLMProvider } from './providers/types.js';

const sceneSchema = z.object({
  index: z.number().int().nonnegative(),
  visualPrompt: z.string().min(1),
  audioPrompt: z.string().min(1),
  durationSec: z.number().positive().default(5),
});

const scriptSchema = z.object({
  idea: z.string().min(1),
  caption: z.string().min(1),
  scenes: z.array(sceneSchema).min(1),
});

const IDEA_PROMPT = `You are a short-form video creative director.
Generate one original, highly visual short-video idea (15-45 seconds) suitable for TikTok, Reels, Shorts, and similar networks.
Return plain text only: 3-6 sentences describing the hook, story, visual style, and intended emotional payoff.`;

function detailPrompt(idea: string): string {
  return `Turn this short-video idea into a structured shooting script.

Idea:
${idea}

Return ONLY valid JSON (no markdown) with this shape:
{
  "idea": "short restatement",
  "caption": "social caption with hashtags",
  "scenes": [
    {
      "index": 0,
      "visualPrompt": "detailed cinematic visual prompt for text-to-video",
      "audioPrompt": "detailed sound-design prompt",
      "durationSec": 5
    }
  ]
}

Use 3-6 scenes. Visual prompts must be self-contained. Audio prompts must match each scene.`;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('Detail LLM did not return JSON');
  }
  return JSON.parse(raw.slice(start, end + 1));
}

function getDetailProvider(): LLMProvider | null {
  if (env.DETAIL_LLM_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider();
  }
  if (env.DETAIL_LLM_PROVIDER === 'gemini' && env.GEMINI_API_KEY) {
    return new GeminiProvider();
  }
  return null;
}

export async function generateScript(): Promise<GeneratedScript> {
  const idea = await ideaLlm.generate(IDEA_PROMPT);
  logger.info({ idea }, 'raw idea generated');

  const detailer = getDetailProvider();
  const prompt = detailPrompt(idea);

  let raw: string;
  if (detailer) {
    try {
      raw = await detailer.generate(prompt);
    } catch (error) {
      logger.warn({ err: error, provider: detailer.name }, 'detail provider failed, falling back to GPT-5');
      raw = await openaiDetailLlm.generate(prompt);
    }
  } else {
    logger.warn(
      { configured: env.DETAIL_LLM_PROVIDER },
      'second LLM provider is not configured, using GPT-5 for scene breakdown',
    );
    raw = await openaiDetailLlm.generate(prompt);
  }

  const parsed = scriptSchema.parse(extractJson(raw));
  const scenes = parsed.scenes.map((scene, index) => ({ ...scene, index }));
  return { ...parsed, idea: parsed.idea || idea, scenes };
}
