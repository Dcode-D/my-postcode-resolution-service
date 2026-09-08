export interface PreprocessedAddress {
  value: string;
  detectedPostcode?: string;
  needPostalCode: boolean;
  rules: string[];
}

/** Normalizes whitespace without assuming a language or country. */
export function preprocessAddress(input: string, enabled: boolean): PreprocessedAddress {
  const value = enabled ? input.normalize('NFKC').replace(/\s+/g, ' ').trim() : input.trim();

  const lookupValue = value.toUpperCase();
  const detectedPostcode = lookupValue.match(/\b\d{5}\b/)?.[0];
  const rules = [
    ...(enabled ? ['TEXT_PREPROCESSING:ENABLED'] : ['TEXT_PREPROCESSING:DISABLED']),
    ...(detectedPostcode ? [`POSTCODE_DETECTED:${detectedPostcode}`] : ['NEED_POSTAL_CODE:true']),
  ];

  return {
    value,
    detectedPostcode,
    needPostalCode: !detectedPostcode,
    rules,
  };
}

export function normalizeMalaysiaPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '').replace(/^00/, '+');
  if (digits.startsWith('+60')) return digits;
  if (digits.startsWith('60')) return `+${digits}`;
  if (digits.startsWith('0')) return `+60${digits.slice(1)}`;
  return digits.startsWith('+') ? digits : `+${digits}`;
}
