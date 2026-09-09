import { createHash } from 'node:crypto';
import type { AppConfig } from '../../config.js';
import type { AiProviderSettings } from '../../types.js';
import { DeepSeekProvider } from '../adapters/deepseek-provider.js';
import { GeminiProvider } from '../adapters/gemini-provider.js';
import { MockProvider } from '../adapters/mock-provider.js';
import { OpenAIProvider } from '../adapters/openai-provider.js';
import type { ModelProvider } from '../core/model-provider.js';
import { AI_PROVIDER_NAMES, type AiProviderName } from '../core/provider-names.js';

export type ProviderConfigSource = 'database' | 'environment';

export interface SelectedModelProvider {
  provider: ModelProvider;
  fingerprint: string;
  source: ProviderConfigSource;
}

export type ProviderSelectorConfig = Pick<
  AppConfig,
  | 'NODE_ENV'
  | 'MODELS_DEFAULT_PROVIDER'
  | 'GEMINI_API_KEY'
  | 'GEMINI_MODEL'
  | 'OPENAI_API_KEY'
  | 'OPENAI_MODEL'
  | 'OPENAI_BASE_URL'
  | 'DEEPSEEK_API_KEY'
  | 'DEEPSEEK_MODEL'
  | 'DEEPSEEK_BASE_URL'
  | 'PROVIDER_CONFIG_CACHE_TTL_SECONDS'
>;

export interface ResolvedProviderSettings extends AiProviderSettings {
  source: ProviderConfigSource;
}

export function withEnvironmentApiKey(
  settings: AiProviderSettings,
  config: ProviderSelectorConfig,
): ResolvedProviderSettings {
  return {
    ...settings,
    apiKey: settings.apiKey ?? getEnvironmentApiKey(settings.provider, config),
    source: 'database',
  };
}

export function getEnvironmentFallback(
  config: ProviderSelectorConfig,
): ResolvedProviderSettings {
  const provider = config.MODELS_DEFAULT_PROVIDER;
  const sharedSettings = {
    provider,
    apiKey: getEnvironmentApiKey(provider, config),
    priority: 0,
    source: 'environment' as const,
  };

  switch (provider) {
    case AI_PROVIDER_NAMES.GEMINI:
      return { ...sharedSettings, model: config.GEMINI_MODEL, baseUrl: null };
    case AI_PROVIDER_NAMES.OPENAI:
      return {
        ...sharedSettings,
        model: config.OPENAI_MODEL,
        baseUrl: config.OPENAI_BASE_URL ?? null,
      };
    case AI_PROVIDER_NAMES.DEEPSEEK:
      return {
        ...sharedSettings,
        model: config.DEEPSEEK_MODEL,
        baseUrl: config.DEEPSEEK_BASE_URL,
      };
    case AI_PROVIDER_NAMES.MOCK:
      return { ...sharedSettings, model: new MockProvider().model, baseUrl: null };
  }
}

export function createProviderSelection(
  settings: ResolvedProviderSettings,
): SelectedModelProvider | null {
  const provider = createProvider(settings);
  if (!provider) return null;

  return {
    provider,
    source: settings.source,
    fingerprint: createProviderFingerprint(settings),
  };
}

function getEnvironmentApiKey(
  provider: AiProviderName,
  config: ProviderSelectorConfig,
): string | null {
  switch (provider) {
    case AI_PROVIDER_NAMES.GEMINI:
      return config.GEMINI_API_KEY ?? null;
    case AI_PROVIDER_NAMES.OPENAI:
      return config.OPENAI_API_KEY ?? null;
    case AI_PROVIDER_NAMES.DEEPSEEK:
      return config.DEEPSEEK_API_KEY ?? null;
    case AI_PROVIDER_NAMES.MOCK:
      return null;
  }
}

function createProvider(settings: AiProviderSettings): ModelProvider | null {
  switch (settings.provider) {
    case AI_PROVIDER_NAMES.GEMINI:
      return settings.apiKey ? new GeminiProvider(settings.apiKey, settings.model) : null;
    case AI_PROVIDER_NAMES.OPENAI:
      return settings.apiKey
        ? new OpenAIProvider(settings.apiKey, settings.model, settings.baseUrl ?? undefined)
        : null;
    case AI_PROVIDER_NAMES.DEEPSEEK:
      return settings.apiKey
        ? new DeepSeekProvider(settings.apiKey, settings.model, settings.baseUrl ?? undefined)
        : null;
    case AI_PROVIDER_NAMES.MOCK:
      return new MockProvider();
  }
}

function createProviderFingerprint(settings: AiProviderSettings): string {
  return createHash('sha256')
    .update(settings.provider)
    .update('\0')
    .update(settings.model)
    .update('\0')
    .update(settings.baseUrl ?? '')
    .update('\0')
    .update(settings.apiKey ?? '')
    .digest('hex');
}
