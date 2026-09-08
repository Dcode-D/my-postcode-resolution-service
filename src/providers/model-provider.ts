import type { ModelDecision, ModelUsage } from '../types.js';
import type { PreprocessedAddress } from '../lib/address.js';

export interface ResolutionContext {
  address: PreprocessedAddress;
  phone: string;
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
