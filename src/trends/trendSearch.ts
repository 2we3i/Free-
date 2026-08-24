import * as cheerio from 'cheerio';
import { createHttpClient } from '../http/client.js';
import { logger } from '../core/logger.js';

// Free web search via DuckDuckGo's HTML endpoint (no API key required).
// Used instead of Gemini's paid Google Search grounding tool, which has very
// tight free-tier quotas (a handful of requests per day).
const http = createHttpClient('duckduckgo', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; VideoPipelineBot/1.0)',
  },
});

interface SearchResult {
  title: string;
  snippet: string;
}

async function searchDuckDuckGo(query: string, maxResults = 6): Promise<SearchResult[]> {
  const response = await http.get<string>('https://html.duckduckgo.com/html/', {
    params: { q: query },
    responseType: 'text',
  });

  const $ = cheerio.load(response.data);
  const results: SearchResult[] = [];

  $('.result').each((_, el) => {
    if (results.length >= maxResults) return;
    const title = $(el).find('.result__title').text().trim();
    const snippet = $(el).find('.result__snippet').text().trim();
    if (title) {
      results.push({ title, snippet });
    }
  });

  return results;
}

// Gathers a short digest of what's currently trending in the EU and RU regions,
// using free web search. This is passed as plain-text context into the Gemini
// idea prompt, instead of relying on Gemini's paid search grounding tool.
export async function fetchTrendDigest(): Promise<string> {
  const queries = [
    'trending memes today Europe',
    'тренды мемы сегодня',
    'viral trend TikTok Europe this week',
  ];

  const sections: string[] = [];
  for (const query of queries) {
    try {
      const results = await searchDuckDuckGo(query);
      if (results.length === 0) continue;
      const formatted = results
        .map((r) => `- ${r.title}${r.snippet ? `: ${r.snippet}` : ''}`)
        .join('\n');
      sections.push(`Query "${query}":\n${formatted}`);
    } catch (error) {
      logger.warn({ err: error, query }, 'trend search query failed, continuing with remaining queries');
    }
  }

  if (sections.length === 0) {
    logger.warn('all trend search queries failed, falling back to no trend context');
    return 'No live trend data available today — use your best general knowledge of current EU/RU internet culture.';
  }

  return sections.join('\n\n');
}
