import { createHash } from 'node:crypto';
import type { ModelProvider, ResolutionContext } from '../../providers/index.js';

export function createResolutionCacheKey(
  provider: Pick<ModelProvider, 'name' | 'model'>,
  context: Pick<ResolutionContext, 'countryCode' | 'prompt'>,
): string {
  return createHash('sha256')
    .update(provider.name)
    .update('\0')
    .update(provider.model)
    .update('\0')
    .update(context.countryCode ?? 'DEFAULT')
    .update('\0')
    .update(context.prompt)
    .digest('hex');
}
