import Decimal from 'decimal.js';
import type { ModelProvider } from '../../providers/index.js';
import type { ModelPricingSettings, ModelUsage, ResolutionUsage } from '../../types.js';

const TOKENS_PER_MILLION = 1_000_000;
const QUERIES_PER_THOUSAND = 1_000;

export function emptyModelUsage(): ModelUsage {
  return {
    promptTokens: 0,
    cachedPromptTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    toolTokens: 0,
    totalTokens: 0,
    searchQueries: 0,
  };
}

export function buildResolutionUsage(
  provider: Pick<ModelProvider, 'name' | 'model'>,
  usage: ModelUsage,
  cacheHit: boolean,
  latencyMs: number,
  pricing: ModelPricingSettings,
): ResolutionUsage {
  const uncachedPromptTokens = Math.max(0, usage.promptTokens - usage.cachedPromptTokens);
  const estimatedListCost = new Decimal(uncachedPromptTokens)
    .mul(pricing.inputPricePerMillionUsd)
    .div(TOKENS_PER_MILLION)
    .plus(
      new Decimal(usage.cachedPromptTokens)
        .mul(pricing.cachedInputPricePerMillionUsd)
        .div(TOKENS_PER_MILLION),
    )
    .plus(
      new Decimal(usage.outputTokens + usage.thinkingTokens)
        .mul(pricing.outputPricePerMillionUsd)
        .div(TOKENS_PER_MILLION),
    )
    .plus(
      new Decimal(usage.searchQueries)
        .mul(pricing.searchPricePerThousandUsd)
        .div(QUERIES_PER_THOUSAND),
    );

  return {
    provider: provider.name,
    model: provider.model,
    cacheHit,
    latencyMs,
    ...usage,
    estimatedListCostUsd: estimatedListCost.toDecimalPlaces(8).toNumber(),
    costIsEstimate: true,
  };
}
