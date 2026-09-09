import type {
  ModelProvider,
  ModelProviderResult,
  SelectedModelProvider,
} from '../../providers/index.js';
import type { ModelPricingSettings } from '../../types.js';

interface ProviderChainOutcome {
  provider: ModelProvider;
  pricingSettings: ModelPricingSettings;
  resolved: { result: ModelProviderResult; cacheHit: boolean };
}

export interface ProviderChainAttempt {
  outcome?: ProviderChainOutcome;
  lastProvider?: ModelProvider;
  lastError?: unknown;
}

export interface ProviderChainDependencies {
  attemptedFingerprints: Set<string>;
  getPricing: (provider: ModelProvider) => Promise<ModelPricingSettings>;
  resolve: (provider: ModelProvider) => Promise<{ result: ModelProviderResult; cacheHit: boolean }>;
  injectRule: (rule: string) => void;
}

export async function tryProvidersSequentially({
  selections,
  dependencies,
}: {
  selections: SelectedModelProvider[];
  dependencies: ProviderChainDependencies;
}): Promise<ProviderChainAttempt> {
  const { attemptedFingerprints, getPricing, resolve, injectRule } = dependencies;
  let lastProvider: ModelProvider | undefined;
  let lastError: unknown;

  for (const selection of selections) {
    if (attemptedFingerprints.has(selection.fingerprint)) continue;
    attemptedFingerprints.add(selection.fingerprint);
    lastProvider = selection.provider;
    injectRule(`PROVIDER_ATTEMPT:${lastProvider.name}/${lastProvider.model}`);
    injectRule(`PROVIDER_CONFIG_SOURCE:${selection.source}`);

    try {
      const pricingSettings = await getPricing(lastProvider);
      injectRule(`PRICING_SETTINGS:${pricingSettings.provider}/${pricingSettings.model}`);
      const resolved = await resolve(lastProvider);
      injectRule(`PROVIDER_RESPONDED:${lastProvider.name}/${lastProvider.model}`);
      return {
        outcome: { provider: lastProvider, pricingSettings, resolved },
        lastProvider,
      };
    } catch (error) {
      lastError = error;
      injectRule(`PROVIDER_ATTEMPT_FAILED:${lastProvider.name}/${lastProvider.model}`);
    }
  }

  return { lastProvider, lastError };
}
