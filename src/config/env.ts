import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),

  // Gemini handles all text generation (idea + scene breakdown).
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),

  // Video is generated manually: the operator gets one prompt in Telegram, generates
  // the clip themselves (e.g. in the Gemini app, which produces video with native audio
  // in a single pass), and replies with the file. This is how long the pipeline waits.
  MANUAL_CLIP_TIMEOUT_MS: z.coerce.number().int().positive().default(3_600_000),

  POSTIZ_BASE_URL: z.string().url(),
  POSTIZ_API_KEY: z.string().min(1),
  // Comma-separated list of platforms to actually publish to, e.g. "tiktok,instagram,youtube".
  POSTIZ_ACTIVE_NETWORKS: z.string().min(1).default('tiktok,instagram,youtube'),
  POSTIZ_INTEGRATION_TIKTOK: z.string().optional().default(''),
  POSTIZ_INTEGRATION_LINKEDIN: z.string().optional().default(''),
  POSTIZ_INTEGRATION_FACEBOOK: z.string().optional().default(''),
  POSTIZ_INTEGRATION_INSTAGRAM: z.string().optional().default(''),
  POSTIZ_INTEGRATION_X: z.string().optional().default(''),
  POSTIZ_INTEGRATION_YOUTUBE: z.string().optional().default(''),
  // One YouTube integration per themed channel this pipeline publishes to.
  POSTIZ_INTEGRATION_YOUTUBE_MAIN: z.string().optional().default(''),
  POSTIZ_INTEGRATION_YOUTUBE_NEWS: z.string().optional().default(''),
  POSTIZ_INTEGRATION_YOUTUBE_UFC: z.string().optional().default(''),
  POSTIZ_INTEGRATION_YOUTUBE_GAMING: z.string().optional().default(''),
  POSTIZ_INTEGRATION_YOUTUBE_CODING: z.string().optional().default(''),
  POSTIZ_INTEGRATION_THREADS: z.string().optional().default(''),
  POSTIZ_INTEGRATION_BLUESKY: z.string().optional().default(''),
  POSTIZ_INTEGRATION_PINTEREST: z.string().optional().default(''),

  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_ADMIN_CHAT_ID: z.string().min(1),
  TELEGRAM_DEV_CHAT_ID: z.string().min(1),
  APPROVAL_TIMEOUT_MS: z.coerce.number().int().positive().default(45 * 60 * 1000),

  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email(),
  GOOGLE_PRIVATE_KEY: z.string().min(1),
  GOOGLE_SHEETS_ID: z.string().min(1),
  GOOGLE_SHEETS_TAB: z.string().default('Runs'),

  // Each channel has its own comma-separated list of cron expressions (see channels.ts).
  // Times are staggered across channels so all 5 don't send prompts at the exact same
  // moment — easier to handle one clip request at a time.
  CRON_SCHEDULE_MAIN: z.string().default('0 12 * * *,0 17 * * *,0 21 * * *'),
  CRON_SCHEDULE_NEWS: z.string().default('20 12 * * *,20 17 * * *,20 21 * * *'),
  CRON_SCHEDULE_UFC: z.string().default('40 12 * * *,40 17 * * *,40 21 * * *'),
  CRON_SCHEDULE_GAMING: z.string().default('0 13 * * *,0 18 * * *,0 22 * * *'),
  CRON_SCHEDULE_CODING: z.string().default('20 13 * * *,20 18 * * *,20 22 * * *'),
  // When to send the end-of-day analytics report (views/likes/comments) in Telegram.
  DAILY_REPORT_CRON: z.string().default('0 23 * * *'),
  TZ: z.string().default('Europe/Vilnius'),
});

export type Env = z.infer<typeof envSchema>;

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration. Process will not start:\n' + formatZodError(parsed.error));
  process.exit(1);
}

export const env: Env = parsed.data;

// Each channel needs its own YouTube integration id configured. This check runs here
// (rather than in channels.ts) so a missing id fails fast at startup with a clear message.
const CHANNEL_INTEGRATION_VARS = {
  main: 'POSTIZ_INTEGRATION_YOUTUBE_MAIN',
  news: 'POSTIZ_INTEGRATION_YOUTUBE_NEWS',
  ufc: 'POSTIZ_INTEGRATION_YOUTUBE_UFC',
  gaming: 'POSTIZ_INTEGRATION_YOUTUBE_GAMING',
  coding: 'POSTIZ_INTEGRATION_YOUTUBE_CODING',
} as const;

const missingChannelIntegrations = Object.entries(CHANNEL_INTEGRATION_VARS).filter(
  ([, key]) => !env[key as keyof Env],
);

if (missingChannelIntegrations.length > 0) {
  console.error(
    'Missing Postiz integration IDs for these channels:\n' +
      missingChannelIntegrations.map(([channel, key]) => `${channel}: set ${key}`).join('\n'),
  );
  process.exit(1);
}
