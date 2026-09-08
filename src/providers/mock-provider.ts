import type { ModelDecision, ModelUsage } from '../types.js';
import type { ModelProvider, ResolutionContext } from './model-provider.js';

/** Deterministic local provider for development, tests, and no-key Docker start. */
export class MockProvider implements ModelProvider {
  readonly name = 'mock';
  readonly model = 'deterministic-v1';

  async resolve(
    context: ResolutionContext,
  ): Promise<{ decision: ModelDecision; usage: ModelUsage }> {
    const postcode = context.address.detectedPostcode;
    if (!postcode) {
      return {
        decision: {
          confidence_score: 0.2,
          data: {
            address_line1: context.address.value,
            district: '',
            city: '',
            state: '',
            postcode: '00000',
            central_postcode: '00000',
            country: 'UNKNOWN',
            country_code: 'ZZ',
            phone: context.phone,
          },
          reasons: ['No verified postcode was available.'],
        },
        usage: emptyUsage(),
      };
    }
    return {
      decision: {
        confidence_score: 0.55,
        data: {
          address_line1: context.address.value,
          district: '',
          city: '',
          state: '',
          postcode,
          central_postcode: postcode,
          country: 'UNKNOWN',
          country_code: 'ZZ',
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
    prompt_tokens: 0,
    cached_prompt_tokens: 0,
    output_tokens: 0,
    thinking_tokens: 0,
    tool_tokens: 0,
    total_tokens: 0,
    search_queries: 0,
  };
}
