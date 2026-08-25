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

  // Comma-separated list of cron expressions. Each one triggers a run independently.
  CRON_SCHEDULE: z.string().default('0 12 * * *,0 17 * * *,0 21 * * *'),
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

const INTEGRATION_ENV_KEYS = {
  tiktok: 'POSTIZ_INTEGRATION_TIKTOK',
  linkedin: 'POSTIZ_INTEGRATION_LINKEDIN',
  facebook: 'POSTIZ_INTEGRATION_FACEBOOK',
  instagram: 'POSTIZ_INTEGRATION_INSTAGRAM',
  x: 'POSTIZ_INTEGRATION_X',
  youtube: 'POSTIZ_INTEGRATION_YOUTUBE',
  threads: 'POSTIZ_INTEGRATION_THREADS',
  bluesky: 'POSTIZ_INTEGRATION_BLUESKY',
  pinterest: 'POSTIZ_INTEGRATION_PINTEREST',
} as const;

export const activeNetworks = env.POSTIZ_ACTIVE_NETWORKS.split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const missingIntegrationIds = activeNetworks.filter((network) => {
  const key = INTEGRATION_ENV_KEYS[network as keyof typeof INTEGRATION_ENV_KEYS];
  if (!key) {
    console.error(`Unknown network "${network}" in POSTIZ_ACTIVE_NETWORKS`);
    process.exit(1);
  }
  return !env[key as keyof Env];
});

if (missingIntegrationIds.length > 0) {
  console.error(
    'Missing Postiz integration IDs for active networks:\n' +
      missingIntegrationIds.map((n) => `${n}: set ${INTEGRATION_ENV_KEYS[n as keyof typeof INTEGRATION_ENV_KEYS]}`).join('\n'),
  );
  process.exit(1);
}
