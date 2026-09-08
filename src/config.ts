import 'dotenv/config';
import { z } from 'zod';

const boolFromEnv = z.preprocess(
  (value) => (value === undefined ? undefined : String(value).toLowerCase() === 'true'),
  z.boolean().default(true),
);
const optionalSecretFromEnv = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(16).optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  SANITIZE_ENABLED: boolFromEnv,
  MODELS_DEFAULT_PROVIDER: z.enum(['gemini', 'mock']).default('mock'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
  RESOLUTION_SETTINGS_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(3600).default(300),
  MODEL_PRICING_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  MODEL_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(604800).default(86400),
  MODEL_CACHE_MAX_ENTRIES: z.coerce.number().int().min(1).max(100000).default(1000),
  LOGS_API_KEY: optionalSecretFromEnv,
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${result.error.message}`);
  }
  if (result.data.MODELS_DEFAULT_PROVIDER === 'gemini' && !result.data.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is required when MODELS_DEFAULT_PROVIDER=gemini');
  }
  return result.data;
}
