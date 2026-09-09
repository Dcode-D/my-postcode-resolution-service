import { z } from 'zod';
import type { AiProviderName } from './providers/core/provider-names.js';

export type { AiProviderName } from './providers/core/provider-names.js';

export const resolutionRequestSchema = z
  .object({
    resource_id: z.string().trim().min(1).max(128).optional(),
    country_code: z
      .string()
      .trim()
      .regex(/^[1-9]\d{0,2}$/)
      .optional(),
    address: z.string().trim().min(5).max(500),
    phone: z.string().trim().min(6).max(30),
    debug: z.boolean().optional().default(false),
  })
  .transform(({ resource_id: resourceId, country_code: countryCode, ...request }) => ({
    ...request,
    resourceId,
    countryCode,
  }));

export const resolutionStatusSchema = z.enum(['SUCCESS', 'AMBIGUOUS', 'FAILED']);

export const resolvedAddressSchema = z
  .object({
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
  })
  .transform(
    ({
      address_line1: addressLine1,
      central_postcode: centralPostcode,
      country_code: countryCode,
      ...address
    }) => ({
      ...address,
      addressLine1,
      centralPostcode,
      countryCode,
    }),
  );

export const modelDecisionSchema = z
  .object({
    confidence_score: z.number().min(0).max(1),
    data: resolvedAddressSchema,
    reasons: z.array(z.string()).max(20).default([]),
  })
  .transform(({ confidence_score: confidenceScore, ...decision }) => ({
    ...decision,
    confidenceScore,
  }));

export const resolutionResponseSchema = z
  .object({
    status: resolutionStatusSchema,
    confidence_score: z.number().min(0).max(1),
    data: resolvedAddressSchema.nullable(),
    debug_info: z
      .object({
        detected_rules: z.array(z.string()),
        provider: z.string(),
        model: z.string(),
      })
      .optional(),
  })
  .transform(({ confidence_score: confidenceScore, debug_info: debugInfo, ...response }) => ({
    ...response,
    confidenceScore,
    ...(debugInfo
      ? {
          debugInfo: {
            detectedRules: debugInfo.detected_rules,
            provider: debugInfo.provider,
            model: debugInfo.model,
          },
        }
      : {}),
  }));

export type ResolutionRequestInput = z.input<typeof resolutionRequestSchema>;
export type ResolutionRequest = z.output<typeof resolutionRequestSchema>;
export type ResolutionStatus = z.infer<typeof resolutionStatusSchema>;
export type ResolvedAddressInput = z.input<typeof resolvedAddressSchema>;
export type ResolvedAddress = z.output<typeof resolvedAddressSchema>;
export type ModelDecisionInput = z.input<typeof modelDecisionSchema>;
export type ModelDecision = z.output<typeof modelDecisionSchema>;
export type ResolutionResponseInput = z.input<typeof resolutionResponseSchema>;
export type ResolutionResponse = z.output<typeof resolutionResponseSchema>;

export interface ModelUsage {
  promptTokens: number;
  cachedPromptTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  toolTokens: number;
  totalTokens: number;
  searchQueries: number;
}

export interface ResolutionUsage extends ModelUsage {
  provider: string;
  model: string;
  cacheHit: boolean;
  latencyMs: number;
  estimatedListCostUsd: number;
  costIsEstimate: true;
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

export const resolutionStatsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100000).default(1000),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must be before or equal to to',
    path: ['from'],
  });

export type ResolutionStatsQuery = z.infer<typeof resolutionStatsQuerySchema>;

export interface ResolutionStats {
  total: number;
  successCount: number;
  failureCount: number;
  ambiguousCount: number;
  failedCount: number;
  successRate: number;
  failureRate: number;
  firstLogAt: Date | null;
  lastLogAt: Date | null;
}

export interface CountryResolutionSettings {
  countryCode: string;
  promptTemplate: string;
  confidenceThreshold: number;
}

export interface ModelPricingSettings {
  provider: string;
  model: string;
  inputPricePerMillionUsd: number;
  cachedInputPricePerMillionUsd: number;
  outputPricePerMillionUsd: number;
  searchPricePerThousandUsd: number;
}

export interface AiProviderSettings {
  provider: AiProviderName;
  apiKey: string | null;
  model: string;
  baseUrl: string | null;
  priority: number;
}

export interface ResolutionLog {
  id: string;
  resourceId: string | null;
  requestCountryCode: string | null;
  settingsCountryCode: string | null;
  confidenceThreshold: string | number | null;
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
