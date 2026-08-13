import { z } from 'zod';

const envSchema = z.object({
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_WEBHOOK_URL: z.string().url().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  AUTHORIZED_TELEGRAM_IDS: z
    .string()
    .min(1, 'AUTHORIZED_TELEGRAM_IDS is required')
    .transform((val) => val.split(',').map((id) => BigInt(id.trim()))),

  // Zoom OAuth
  ZOOM_CLIENT_ID: z.string().min(1, 'ZOOM_CLIENT_ID is required'),
  ZOOM_CLIENT_SECRET: z.string().min(1, 'ZOOM_CLIENT_SECRET is required'),
  ZOOM_REDIRECT_URI: z.string().url('ZOOM_REDIRECT_URI must be a valid URL'),

  // Zoom Meeting SDK
  ZOOM_SDK_KEY: z.string().optional(),
  ZOOM_SDK_SECRET: z.string().optional(),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // Security
  ENCRYPTION_KEY: z
    .string()
    .length(64, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
    .regex(/^[0-9a-fA-F]+$/, 'ENCRYPTION_KEY must be hexadecimal'),

  // Server
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Bot Defaults
  DEFAULT_DISPLAY_NAME: z.string().default('Meeting Assistant'),
  DEFAULT_TIMEZONE: z.string().default('Asia/Kolkata'),
});

export type EnvConfig = z.infer<typeof envSchema>;

let _config: EnvConfig | null = null;

/**
 * Validates and returns the application configuration.
 * Crashes immediately if any required environment variable is missing or invalid.
 * Caches the result after first successful parse.
 */
export function getConfig(): EnvConfig {
  if (_config) return _config;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    console.error(`\n❌ Invalid environment configuration:\n${errors}\n`);
    process.exit(1);
  }

  _config = result.data;
  return _config;
}
