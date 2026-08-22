import { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import type { GeneratedScript } from '../types/pipeline.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { GeminiProvider } from './providers/gemini.js';
import type { LLMProvider } from './providers/types.js';

async function getIdeaProvider(): Promise<LLMProvider> {
  switch (env.IDEA_LLM_PROVIDER) {
    case 'gemini':
      return new GeminiProvider();
    case 'anthropic':
      return new AnthropicProvider();
    case 'openai': {
      // Lazy import so the openai package/key is only required if explicitly selected.
      const { ideaLlm } = await import('./providers/openai.js');
      return ideaLlm;
    }
  }
}

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

function getDetailProvider(): LLMProvider {
  return env.DETAIL_LLM_PROVIDER === 'gemini' ? new GeminiProvider() : new AnthropicProvider();
}

// The "other" provider is used as a fallback if the primary detail provider fails.
function getDetailFallbackProvider(): LLMProvider {
  return env.DETAIL_LLM_PROVIDER === 'gemini' ? new AnthropicProvider() : new GeminiProvider();
}

export async function generateScript(): Promise<GeneratedScript> {
  const ideaProvider = await getIdeaProvider();
  const idea = await ideaProvider.generate(IDEA_PROMPT);
  logger.info({ idea, provider: ideaProvider.name }, 'raw idea generated');

  const detailer = getDetailProvider();
  const prompt = detailPrompt(idea);

  let raw: string;
  try {
    raw = await detailer.generate(prompt);
  } catch (error) {
    const fallback = getDetailFallbackProvider();
    logger.warn(
      { err: error, provider: detailer.name, fallback: fallback.name },
      'detail provider failed, falling back to secondary LLM',
    );
    raw = await fallback.generate(prompt);
  }

  const parsed = scriptSchema.parse(extractJson(raw));
  const scenes = parsed.scenes.map((scene, index) => ({ ...scene, index }));
  return { ...parsed, idea: parsed.idea || idea, scenes };
}
