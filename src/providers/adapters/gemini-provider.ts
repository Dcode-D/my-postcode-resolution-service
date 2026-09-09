import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { modelDecisionSchema, type ModelDecision, type ModelUsage } from '../../types.js';
import { decisionJsonSchema } from '../core/decision-schema.js';
import type { ModelProvider, ResolutionContext } from '../core/model-provider.js';
import { AI_PROVIDER_NAMES } from '../core/provider-names.js';

export class GeminiProvider implements ModelProvider {
  readonly name = AI_PROVIDER_NAMES.GEMINI;
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
          promptTokens: metadata?.promptTokenCount ?? 0,
          cachedPromptTokens: metadata?.cachedContentTokenCount ?? 0,
          outputTokens: metadata?.candidatesTokenCount ?? 0,
          thinkingTokens: metadata?.thoughtsTokenCount ?? 0,
          toolTokens: metadata?.toolUsePromptTokenCount ?? 0,
          totalTokens: metadata?.totalTokenCount ?? 0,
          searchQueries,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Do not log prompt, address, phone, or API key. The provider error is enough to diagnose quota/model issues.
      console.error(
        JSON.stringify({ level: 'error', component: this.name, model: this.model, message }),
      );
      throw new Error(`Gemini generation failed for ${this.model}: ${message}`);
    }
  }
}
