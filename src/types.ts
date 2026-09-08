import { z } from 'zod';

export const resolutionRequestSchema = z.object({
  address: z.string().trim().min(5).max(500),
  phone: z.string().trim().min(6).max(30),
  debug: z.boolean().optional().default(false),
});

export const resolutionStatusSchema = z.enum(['SUCCESS', 'AMBIGUOUS', 'FAILED']);

export const resolvedAddressSchema = z.object({
  address_line1: z.string(),
  district: z.string(),
  city: z.string(),
  state: z.string(),
  postcode: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .regex(/^[A-Z0-9][A-Z0-9 -]*$/i),
  central_postcode: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .regex(/^[A-Z0-9][A-Z0-9 -]*$/i),
  country: z.string().trim().min(2).max(100),
  country_code: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/)
    .transform((value) => value.toUpperCase()),
  phone: z.string(),
});

export const modelDecisionSchema = z.object({
  confidence_score: z.number().min(0).max(1),
  data: resolvedAddressSchema,
  reasons: z.array(z.string()).max(20).default([]),
});

export type ResolutionRequest = z.infer<typeof resolutionRequestSchema>;
export type ResolutionStatus = z.infer<typeof resolutionStatusSchema>;
export type ResolvedAddress = z.infer<typeof resolvedAddressSchema>;
export type ModelDecision = z.infer<typeof modelDecisionSchema>;

export interface ModelUsage {
  prompt_tokens: number;
  cached_prompt_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
  tool_tokens: number;
  total_tokens: number;
  search_queries: number;
}

export interface ResolutionUsage extends ModelUsage {
  provider: string;
  model: string;
  cache_hit: boolean;
  latency_ms: number;
  estimated_list_cost_usd: number;
  cost_is_estimate: true;
}

export const resolutionLogQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must be before or equal to to',
    path: ['from'],
  });

export type ResolutionLogQuery = z.infer<typeof resolutionLogQuerySchema>;

export interface ResolutionResponse {
  status: ResolutionStatus;
  confidence_score: number;
  data: ResolvedAddress | null;
  debug_info?: { detected_rules: string[]; provider: string; model: string };
}

export interface PostcodeReference {
  postcode: string;
  state: string;
  city: string;
  district: string | null;
}

export interface ResolutionLog {
  id: string;
  requestAddress: string;
  requestPhone: string;
  sanitizedAddress: string;
  sanitizeEnabled: boolean;
  provider: string;
  model: string;
  status: ResolutionStatus;
  confidenceScore: string | number;
  result: ResolutionResponse;
  detectedRules: string[];
  cacheHit: boolean;
  latencyMs: number;
  promptTokens: number;
  cachedPromptTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  toolTokens: number;
  totalTokens: number;
  searchQueries: number;
  estimatedListCostUsd: string | number;
  errorCode: string | null;
  createdAt: Date;
}
