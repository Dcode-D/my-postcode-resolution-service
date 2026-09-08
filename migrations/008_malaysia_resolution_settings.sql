INSERT INTO country_resolution_settings (
  country_code,
  prompt_template,
  confidence_threshold
)
VALUES
  (
    '60',
    $prompt$Find the correct Malaysian postal code for this address.

The requested international calling code is +60, which is a strong country-level clue for Malaysia, but validate it against the address and phone evidence. If the evidence clearly identifies another country, return that country instead of forcing a Malaysian result.

When web search is available, use the minimum number of searches needed, normally one focused query using the exact street and locality. Malaysian postcodes contain exactly five digits. Verify that the postcode matches the street, city or town, and state. A business name or phone number may be used as an additional search clue, but a phone number alone is not proof of a street-level location.

Always return the most plausible result when one exists and use confidence_score to express uncertainty. Give high confidence only when reliable evidence directly matches the street and locality. Use lower confidence for results inferred from partial address, locality, or phone evidence. Use postcode and central_postcode "00000", country "UNKNOWN", and country_code "ZZ" only when no plausible result can be found.

For a Malaysian result, return country "MALAYSIA" and country_code "MY". Set central_postcode equal to postcode. Normalize Malaysian phone numbers to E.164 with the +60 prefix when possible. Use empty strings for unknown location fields and provide short, factual reasons.

Address: {{address}}
Phone: {{phone}}
Requested calling code: {{country_code}}
Detected hints: {{detected_rules}}$prompt$,
    0.800
  )
ON CONFLICT (country_code) DO NOTHING;
