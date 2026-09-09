import OpenAI from 'openai';
import { modelDecisionSchema, type ModelDecision, type ModelUsage } from '../../types.js';
import { decisionJsonInstruction } from '../core/decision-schema.js';
import type { ModelProvider, ResolutionContext } from '../core/model-provider.js';
import { AI_PROVIDER_NAMES } from '../core/provider-names.js';

interface DeepSeekUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

export class DeepSeekProvider implements ModelProvider {
  readonly name = AI_PROVIDER_NAMES.DEEPSEEK;
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    readonly model: string,
    baseUrl = 'https://api.deepseek.com',
  ) {
    this.client = new OpenAI({ apiKey, baseURL: baseUrl });
  }

  async resolve(
    context: ResolutionContext,
  ): Promise<{ decision: ModelDecision; usage: ModelUsage }> {
    try {
      const result = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: `${context.prompt}\n\n${decisionJsonInstruction}`,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 768,
      });
      const text = result.choices[0]?.message.content;
      if (!text) throw new Error('DeepSeek returned an empty response');
      const usage = result.usage as DeepSeekUsage | undefined;
      const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
      return {
        decision: modelDecisionSchema.parse(JSON.parse(text)),
        usage: {
          promptTokens: usage?.prompt_tokens ?? 0,
          cachedPromptTokens: usage?.prompt_cache_hit_tokens ?? 0,
          outputTokens: Math.max(0, (usage?.completion_tokens ?? 0) - reasoningTokens),
          thinkingTokens: reasoningTokens,
          toolTokens: 0,
          totalTokens: usage?.total_tokens ?? 0,
          searchQueries: 0,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({ level: 'error', component: this.name, model: this.model, message }),
      );
      throw new Error(`DeepSeek generation failed for ${this.model}: ${message}`);
    }
  }
}
