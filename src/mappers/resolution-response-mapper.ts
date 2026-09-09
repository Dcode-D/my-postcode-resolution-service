import type {
  ResolutionResponse,
  ResolutionResponseInput,
  ResolvedAddress,
  ResolvedAddressInput,
} from '../types.js';

function toResolvedAddressInput(address: ResolvedAddress): ResolvedAddressInput {
  return {
    address_line1: address.addressLine1,
    district: address.district,
    city: address.city,
    state: address.state,
    postcode: address.postcode,
    central_postcode: address.centralPostcode,
    country: address.country,
    country_code: address.countryCode,
    phone: address.phone,
  };
}

export function toResolutionResponseInput(response: ResolutionResponse): ResolutionResponseInput {
  return {
    status: response.status,
    confidence_score: response.confidenceScore,
    data: response.data ? toResolvedAddressInput(response.data) : null,
    ...(response.debugInfo
      ? {
          debug_info: {
            detected_rules: response.debugInfo.detectedRules,
            provider: response.debugInfo.provider,
            model: response.debugInfo.model,
          },
        }
      : {}),
  };
}
