import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env.js';
import { withRetry } from '../../core/retry.js';
import type { LLMProvider } from './types.js';

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';

  // When useSearchGrounding is true, Gemini is allowed to use Google Search to ground
  // its answer in current, real-world information (e.g. today's trending topics/memes),
  // instead of relying only on its training data.
  async generate(prompt: string, options?: { useSearchGrounding?: boolean }): Promise<string> {
    if (!env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    return withRetry(async () => {
      const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: env.GEMINI_MODEL,
        tools: options?.useSearchGrounding ? [{ googleSearch: {} } as never] : undefined,
      });
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      if (!text) throw new Error('Gemini returned an empty completion');
      return text;
    }, `gemini:${env.GEMINI_MODEL}`);
  }
}
