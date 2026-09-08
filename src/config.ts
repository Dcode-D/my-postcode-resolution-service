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
  CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  MODELS_DEFAULT_PROVIDER: z.enum(['gemini', 'mock']).default('mock'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
  MODEL_PROMPT_TEMPLATE: z.string().optional(),
  MODEL_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(604800).default(86400),
  MODEL_CACHE_MAX_ENTRIES: z.coerce.number().int().min(1).max(100000).default(1000),
  GEMINI_INPUT_PRICE_PER_MILLION_USD: z.coerce.number().min(0).default(1.5),
  GEMINI_CACHED_INPUT_PRICE_PER_MILLION_USD: z.coerce.number().min(0).default(0.15),
  GEMINI_OUTPUT_PRICE_PER_MILLION_USD: z.coerce.number().min(0).default(9),
  GEMINI_SEARCH_PRICE_PER_THOUSAND_USD: z.coerce.number().min(0).default(14),
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
