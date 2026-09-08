import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { modelDecisionSchema, type ModelDecision, type ModelUsage } from '../types.js';
import type { ModelProvider, ResolutionContext } from './model-provider.js';

const decisionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    confidence_score: { type: 'number', minimum: 0, maximum: 1 },
    data: {
      type: 'object',
      additionalProperties: false,
      properties: {
        address_line1: { type: 'string' },
        district: { type: 'string' },
        city: { type: 'string' },
        state: { type: 'string' },
        postcode: {
          type: 'string',
          description: 'Postal code in the target country format, or 00000 when unverified',
        },
        central_postcode: { type: 'string', description: 'The same value as postcode' },
        country: { type: 'string', description: 'Canonical country name' },
        country_code: {
          type: 'string',
          description: 'Two-letter ISO country code, or ZZ when the country is unknown',
        },
        phone: { type: 'string', description: 'Phone number normalized to E.164 when possible' },
      },
      required: [
        'address_line1',
        'district',
        'city',
        'state',
        'postcode',
        'central_postcode',
        'country',
        'country_code',
        'phone',
      ],
    },
    reasons: { type: 'array', items: { type: 'string' }, maxItems: 20 },
  },
  required: ['confidence_score', 'data', 'reasons'],
};

export class GeminiProvider implements ModelProvider {
  readonly name = 'gemini';
  private readonly client: GoogleGenAI;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {
    this.client = new GoogleGenAI({ apiKey: this.apiKey });
  }

  async resolve(
    context: ResolutionContext,
  ): Promise<{ decision: ModelDecision; usage: ModelUsage }> {
    try {
      const result = await this.client.models.generateContent({
        model: this.model,
        contents: context.prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: 'application/json',
          responseJsonSchema: decisionJsonSchema,
          maxOutputTokens: 512,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        },
      });
      const text = result.text;
      if (!text) throw new Error('Gemini returned an empty response');
      const metadata = result.usageMetadata;
      const searchQueries = new Set(
        (
          result.candidates?.flatMap(
            (candidate) => candidate.groundingMetadata?.webSearchQueries ?? [],
          ) ?? []
        ).filter((query) => query.trim().length > 0),
      ).size;
      return {
        decision: modelDecisionSchema.parse(JSON.parse(text)),
        usage: {
          prompt_tokens: metadata?.promptTokenCount ?? 0,
          cached_prompt_tokens: metadata?.cachedContentTokenCount ?? 0,
          output_tokens: metadata?.candidatesTokenCount ?? 0,
          thinking_tokens: metadata?.thoughtsTokenCount ?? 0,
          tool_tokens: metadata?.toolUsePromptTokenCount ?? 0,
          total_tokens: metadata?.totalTokenCount ?? 0,
          search_queries: searchQueries,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Do not log prompt, address, phone, or API key. The provider error is enough to diagnose quota/model issues.
      console.error(
        JSON.stringify({ level: 'error', component: 'gemini', model: this.model, message }),
      );
      throw new Error(`Gemini generation failed for ${this.model}: ${message}`);
    }
  }
}
