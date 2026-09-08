import OpenAI from 'openai';
import { modelDecisionSchema, type ModelDecision, type ModelUsage } from '../types.js';
import { decisionJsonInstruction } from './decision-schema.js';
import type { ModelProvider, ResolutionContext } from './model-provider.js';

interface DeepSeekUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

export class DeepSeekProvider implements ModelProvider {
  readonly name = 'deepseek';
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
          prompt_tokens: usage?.prompt_tokens ?? 0,
          cached_prompt_tokens: usage?.prompt_cache_hit_tokens ?? 0,
          output_tokens: Math.max(0, (usage?.completion_tokens ?? 0) - reasoningTokens),
          thinking_tokens: reasoningTokens,
          tool_tokens: 0,
          total_tokens: usage?.total_tokens ?? 0,
          search_queries: 0,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({ level: 'error', component: 'deepseek', model: this.model, message }),
      );
      throw new Error(`DeepSeek generation failed for ${this.model}: ${message}`);
    }
  }
}
