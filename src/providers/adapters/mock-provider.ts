import { DEFAULT_NOT_FOUND_POSTCODE } from '../../constants/postcode.js';
import type { ModelDecision, ModelUsage } from '../../types.js';
import type { ModelProvider, ResolutionContext } from '../core/model-provider.js';
import { AI_PROVIDER_NAMES } from '../core/provider-names.js';

/** Deterministic local provider for development, tests, and no-key Docker start. */
export class MockProvider implements ModelProvider {
  readonly name = AI_PROVIDER_NAMES.MOCK;
  readonly model = 'deterministic-v1';

  async resolve(
    context: ResolutionContext,
  ): Promise<{ decision: ModelDecision; usage: ModelUsage }> {
    const postcode = context.address.detectedPostcode;
    if (!postcode) {
      return {
        decision: {
          confidenceScore: 0.2,
          data: {
            addressLine1: context.address.value,
            district: '',
            city: '',
            state: '',
            postcode: DEFAULT_NOT_FOUND_POSTCODE,
            centralPostcode: DEFAULT_NOT_FOUND_POSTCODE,
            country: 'UNKNOWN',
            countryCode: 'ZZ',
            phone: context.phone,
          },
          reasons: ['No verified postcode was available.'],
        },
        usage: emptyUsage(),
      };
    }
    return {
      decision: {
        confidenceScore: 0.55,
        data: {
          addressLine1: context.address.value,
          district: '',
          city: '',
          state: '',
          postcode,
          centralPostcode: postcode,
          country: 'UNKNOWN',
          countryCode: 'ZZ',
          phone: context.phone,
        },
        reasons: ['Unverified postcode found in address.'],
      },
      usage: emptyUsage(),
    };
  }
}

function emptyUsage(): ModelUsage {
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
