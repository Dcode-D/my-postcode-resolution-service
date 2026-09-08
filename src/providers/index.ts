import type { AppConfig } from '../config.js';
import type { ModelProvider } from './model-provider.js';
import { GeminiProvider } from './gemini-provider.js';
import { MockProvider } from './mock-provider.js';

export function createModelProvider(config: AppConfig): ModelProvider {
  if (config.MODELS_DEFAULT_PROVIDER === 'gemini') {
    return new GeminiProvider(config.GEMINI_API_KEY!, config.GEMINI_MODEL);
  }
  return new MockProvider();
}
