export const decisionJsonSchema = {
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

export const decisionJsonInstruction = `Return only JSON matching this schema:\n${JSON.stringify(
  decisionJsonSchema,
)}`;
