export const AI_PROVIDER_NAMES = {
  GEMINI: 'gemini',
  OPENAI: 'openai',
  DEEPSEEK: 'deepseek',
  MOCK: 'mock',
} as const;

export const AI_PROVIDER_NAME_VALUES = [
  AI_PROVIDER_NAMES.GEMINI,
  AI_PROVIDER_NAMES.OPENAI,
  AI_PROVIDER_NAMES.DEEPSEEK,
  AI_PROVIDER_NAMES.MOCK,
] as const;

export type AiProviderName = (typeof AI_PROVIDER_NAMES)[keyof typeof AI_PROVIDER_NAMES];
