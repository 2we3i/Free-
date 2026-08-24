import { z } from 'zod';
import { logger } from '../core/logger.js';
import type { GeneratedScript } from '../types/pipeline.js';
import { GeminiProvider } from './providers/gemini.js';

const scriptSchema = z.object({
  idea: z.string().min(1),
  caption: z.string().min(1),
  videoPrompt: z.string().min(1),
});

// Step 1: use Google Search grounding to find what's actually trending today in the
// EU and RU regions, so the idea is based on real, current material rather than
// the model's static training data.
const TRENDS_PROMPT = `Search for what is trending, viral, or being widely discussed today
specifically in the EU (Europe) and RU (Russia/Russian-speaking) regions/internet — memes,
viral formats, jokes, or cultural moments that are currently "forced"/being reposted a lot.

Return a short plain-text list (5-8 bullet points) of the most relevant current trends/memes
for these two regions, with a one-line note on why each is currently popular. Be specific
(name the meme/format/reference), not generic.`;

// Step 2: turn the current trends into one short-video concept.
function ideaPrompt(trends: string): string {
  return `You are a short-form video creative director making content for EU and RU audiences.

Here are today's trending memes/topics in those regions:
${trends}

Pick the single best trend/meme from this list (or a clever combination) and turn it into
one original short-video concept (8-15 seconds) suitable for TikTok, Reels, and Shorts.
Return plain text only: 3-5 sentences describing the hook, the joke/reference being used,
the visual style, and the payoff. Make it clear which specific trend/meme it's based on.`;
}

// Step 3: turn the idea into one self-contained prompt for a single-shot video+audio
// generation (meant to be pasted into a tool like the Gemini app's video generator,
// which produces one finished clip with native audio in one go — no separate scenes).
function videoPromptPrompt(idea: string): string {
  return `Turn this short-video idea into ONE single, self-contained prompt for an AI video
generator that produces an 8-15 second clip with native audio (dialogue/sound effects/music)
in a single generation — not a multi-scene shot list.

Idea:
${idea}

Return ONLY valid JSON (no markdown, no commentary) with this shape:
{
  "idea": "one-sentence restatement of the concept",
  "caption": "social caption with hashtags, matching the EU/RU trend referenced",
  "videoPrompt": "one detailed, self-contained prompt describing the full 8-15s clip: setting, action, camera, dialogue/sound, tone, and pacing — written so it can be pasted directly into a video generator"
}`;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('Gemini did not return JSON for the video prompt step');
  }
  return JSON.parse(raw.slice(start, end + 1));
}

export async function generateScript(): Promise<GeneratedScript> {
  const gemini = new GeminiProvider();

  const trends = await gemini.generate(TRENDS_PROMPT, { useSearchGrounding: true });
  logger.info({ trends }, 'fetched current EU/RU trends via search grounding');

  const idea = await gemini.generate(ideaPrompt(trends));
  logger.info({ idea }, 'idea generated from trends');

  const raw = await gemini.generate(videoPromptPrompt(idea));
  const parsed = scriptSchema.parse(extractJson(raw));
  return { ...parsed, idea: parsed.idea || idea };
}
