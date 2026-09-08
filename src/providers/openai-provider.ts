import OpenAI from 'openai';
import { modelDecisionSchema, type ModelDecision, type ModelUsage } from '../types.js';
import { decisionJsonSchema } from './decision-schema.js';
import type { ModelProvider, ResolutionContext } from './model-provider.js';

export class OpenAIProvider implements ModelProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    readonly model: string,
    baseUrl?: string,
  ) {
    this.client = new OpenAI({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });
  }

  async resolve(
    context: ResolutionContext,
  ): Promise<{ decision: ModelDecision; usage: ModelUsage }> {
    try {
      const result = await this.client.responses.create({
        model: this.model,
        input: context.prompt,
        tools: [{ type: 'web_search' }],
        text: {
          format: {
            type: 'json_schema',
            name: 'postcode_resolution',
            schema: decisionJsonSchema,
            strict: true,
          },
        },
        max_output_tokens: 768,
        store: false,
      });
      if (!result.output_text) throw new Error('OpenAI returned an empty response');
      const usage = result.usage;
      const reasoningTokens = usage?.output_tokens_details?.reasoning_tokens ?? 0;
      return {
        decision: modelDecisionSchema.parse(JSON.parse(result.output_text)),
        usage: {
          prompt_tokens: usage?.input_tokens ?? 0,
          cached_prompt_tokens: usage?.input_tokens_details?.cached_tokens ?? 0,
          output_tokens: Math.max(0, (usage?.output_tokens ?? 0) - reasoningTokens),
          thinking_tokens: reasoningTokens,
          tool_tokens: 0,
          total_tokens: usage?.total_tokens ?? 0,
          search_queries: result.output.filter((item) => item.type === 'web_search_call').length,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({ level: 'error', component: 'openai', model: this.model, message }),
      );
      throw new Error(`OpenAI generation failed for ${this.model}: ${message}`);
    }
  }
}
