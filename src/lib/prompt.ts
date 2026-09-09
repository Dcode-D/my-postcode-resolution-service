import { DEFAULT_NOT_FOUND_POSTCODE } from '../constants/postcode.js';
import type { PreprocessedAddress } from './address.js';

export const DEFAULT_PROMPT = `Find the correct postal code and country for this address.

Use the minimum number of Google searches needed—normally one focused query—to identify the country and postal code from matching street and locality evidence. Treat the phone's country or landline area code as a useful clue, but never as proof of a street-level location.

Always return the most plausible result when one exists and use confidence_score to show uncertainty. A strong direct match should score highly; a result inferred from partial address or phone evidence should score lower. Use postcode and central_postcode "${DEFAULT_NOT_FOUND_POSTCODE}", country "UNKNOWN", and country_code "ZZ" only when no plausible result can be found.

Set central_postcode equal to postcode. Normalize the phone to E.164 when possible. Use empty strings for unknown location fields and give short, factual reasons.

Address: {{address}}
Phone: {{phone}}
Detected hints: {{detected_rules}}`;

export function renderPrompt(
  template: string,
  address: PreprocessedAddress,
  phone: string,
  countryCode?: string,
): string {
  const values: Record<string, string> = {
    address: address.value,
    phone,
    country_code: countryCode ?? '',
    detected_rules: address.rules.join(', '),
  };
  return template.replace(
    /{{(address|phone|country_code|detected_rules)}}/g,
    (_, key: string) => values[key] ?? '',
  );
}
