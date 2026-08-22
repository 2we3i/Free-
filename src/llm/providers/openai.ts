import OpenAI from 'openai';
import { env } from '../../config/env.js';
import { withRetry } from '../../core/retry.js';
import type { LLMProvider } from './types.js';

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';

  constructor(private readonly model: string) {}

  async generate(prompt: string): Promise<string> {
    return withRetry(async () => {
      const response = await client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = response.choices[0]?.message?.content?.trim();
      if (!text) throw new Error('OpenAI returned an empty completion');
      return text;
    }, `openai:${this.model}`);
  }
}

export const ideaLlm = new OpenAIProvider(env.OPENAI_MODEL);
export const openaiDetailLlm = new OpenAIProvider(env.OPENAI_DETAIL_MODEL);
