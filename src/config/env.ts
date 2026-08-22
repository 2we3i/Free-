import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),

  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().default('gpt-5'),
  OPENAI_DETAIL_MODEL: z.string().default('gpt-5'),
  DETAIL_LLM_PROVIDER: z.enum(['anthropic', 'gemini']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-20250514'),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),

  WAVESPEED_API_KEY: z.string().min(1),
  WAVESPEED_BASE_URL: z.string().url().default('https://api.wavespeed.ai'),
  WAVESPEED_MODEL: z.string().min(1),
  WAVESPEED_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  WAVESPEED_POLL_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),

  FAL_KEY: z.string().min(1),
  FAL_AUDIO_MODEL: z.string().min(1),
  FAL_STITCH_MODEL: z.string().min(1),
  FAL_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(4_000),
  FAL_POLL_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),

  POSTIZ_BASE_URL: z.string().url(),
  POSTIZ_API_KEY: z.string().min(1),
  POSTIZ_INTEGRATION_TIKTOK: z.string().min(1),
  POSTIZ_INTEGRATION_LINKEDIN: z.string().min(1),
  POSTIZ_INTEGRATION_FACEBOOK: z.string().min(1),
  POSTIZ_INTEGRATION_INSTAGRAM: z.string().min(1),
  POSTIZ_INTEGRATION_X: z.string().min(1),
  POSTIZ_INTEGRATION_YOUTUBE: z.string().min(1),
  POSTIZ_INTEGRATION_THREADS: z.string().min(1),
  POSTIZ_INTEGRATION_BLUESKY: z.string().min(1),
  POSTIZ_INTEGRATION_PINTEREST: z.string().min(1),

  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_ADMIN_CHAT_ID: z.string().min(1),
  TELEGRAM_DEV_CHAT_ID: z.string().min(1),
  APPROVAL_TIMEOUT_MS: z.coerce.number().int().positive().default(45 * 60 * 1000),

  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email(),
  GOOGLE_PRIVATE_KEY: z.string().min(1),
  GOOGLE_SHEETS_ID: z.string().min(1),
  GOOGLE_SHEETS_TAB: z.string().default('Runs'),

  CRON_SCHEDULE: z.string().default('0 9 * * *'),
  TZ: z.string().default('UTC'),
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
