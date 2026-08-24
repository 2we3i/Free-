import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env.js';
import { withRetry } from '../../core/retry.js';
import type { LLMProvider } from './types.js';

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';

  async generate(prompt: string): Promise<string> {
    if (!env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    return withRetry(async () => {
      const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: env.GEMINI_MODEL });
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      if (!text) throw new Error('Gemini returned an empty completion');
      return text;
    }, `gemini:${env.GEMINI_MODEL}`);
  }
}
