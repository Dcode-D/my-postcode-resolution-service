import type { PreprocessedAddress } from '../../lib/address.js';
import type { ModelDecision, ModelUsage } from '../../types.js';

export interface ResolutionContext {
  address: PreprocessedAddress;
  phone: string;
  countryCode?: string;
  prompt: string;
}

export interface ModelProviderResult {
  decision: ModelDecision;
  usage: ModelUsage;
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  resolve(context: ResolutionContext): Promise<ModelProviderResult>;
}
