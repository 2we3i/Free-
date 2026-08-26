import { env } from '../config/env.js';

// One entry per YouTube channel/account this pipeline publishes to. Each channel has
// its own topic focus, its own trend-search queries, its own Postiz integration id,
// and its own publishing schedule (comma-separated cron expressions).
export interface ChannelConfig {
  id: string;
  label: string;
  // Short description of the content angle, used directly in the idea prompt.
  topicPrompt: string;
  // Search queries used to gather today's trend digest for this channel's topic.
  trendQueries: string[];
  postizIntegrationId: string;
  // Comma-separated cron expressions (evaluated in env.TZ). Each one triggers a run
  // for this channel only, independently of the other channels.
  cronSchedule: string;
}

export const CHANNELS: ChannelConfig[] = [
  {
    id: 'main',
    label: 'Main (EU/RU memes)',
    topicPrompt:
      'General EU/RU internet meme culture — trending jokes, formats, and viral moments from Europe and Russian-speaking internet.',
    trendQueries: [
      'trending memes today Europe',
      'тренды мемы сегодня',
      'viral trend TikTok Europe this week',
    ],
    postizIntegrationId: env.POSTIZ_INTEGRATION_YOUTUBE_MAIN,
    cronSchedule: env.CRON_SCHEDULE_MAIN,
  },
  {
    id: 'news',
    label: 'World News',
    topicPrompt:
      'Major world news stories from today — presented as a short, punchy, visually engaging news-style short-video summary of one real current event.',
    trendQueries: ['world news today breaking', 'top news headlines today international'],
    postizIntegrationId: env.POSTIZ_INTEGRATION_YOUTUBE_NEWS,
    cronSchedule: env.CRON_SCHEDULE_NEWS,
  },
  {
    id: 'ufc',
    label: 'UFC + memes',
    topicPrompt:
      'UFC / MMA content combined with meme humor — reactions to a recent fight, fighter moment, or MMA community joke, told in a funny short-video format.',
    trendQueries: ['UFC news today', 'UFC meme reaction viral', 'MMA news this week'],
    postizIntegrationId: env.POSTIZ_INTEGRATION_YOUTUBE_UFC,
    cronSchedule: env.CRON_SCHEDULE_UFC,
  },
  {
    id: 'gaming',
    label: 'Gaming + memes',
    topicPrompt:
      'Video game culture and gaming memes — a joke or reaction based on a currently trending game, patch, esports moment, or gaming-community meme format.',
    trendQueries: ['gaming news today', 'gaming meme viral trend', 'video game trending topic'],
    postizIntegrationId: env.POSTIZ_INTEGRATION_YOUTUBE_GAMING,
    cronSchedule: env.CRON_SCHEDULE_GAMING,
  },
  {
    id: 'coding',
    label: 'Coding + memes',
    topicPrompt:
      'Programming and software developer culture — a joke, relatable moment, or meme about coding, developer tools, frameworks, or tech industry news.',
    trendQueries: ['programming meme trending', 'developer humor viral', 'tech news today programming'],
    postizIntegrationId: env.POSTIZ_INTEGRATION_YOUTUBE_CODING,
    cronSchedule: env.CRON_SCHEDULE_CODING,
  },
];
