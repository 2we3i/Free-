import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { withRetry } from '../../core/retry.js';
import type { LLMProvider } from './types.js';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }

  async generate(prompt: string): Promise<string> {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    return withRetry(async () => {
      const response = await this.client.messages.create({
        model: env.ANTHROPIC_MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim();
      if (!text) throw new Error('Anthropic returned an empty completion');
      return text;
    }, `anthropic:${env.ANTHROPIC_MODEL}`);
  }
}
