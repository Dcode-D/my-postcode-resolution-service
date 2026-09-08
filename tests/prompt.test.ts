import { describe, expect, it } from 'vitest';
import { preprocessAddress } from '../src/lib/address.js';
import { DEFAULT_PROMPT, renderPrompt } from '../src/lib/prompt.js';

describe('default Gemini prompt', () => {
  it('asks for search-backed resolution and renders every input placeholder', () => {
    const rendered = renderPrompt(
      DEFAULT_PROMPT,
      preprocessAddress('Jln Test, 42200 Kapar', true),
      '0176710714',
      '60',
    );

    expect(rendered).toContain('minimum number of Google searches');
    expect(rendered).toContain('most plausible result');
    expect(rendered).toContain('identify the country');
    expect(rendered).toContain('Jln Test, 42200 Kapar');
    expect(rendered).toContain('0176710714');
    expect(rendered).not.toContain('{{address}}');
    expect(rendered).not.toContain('{{phone}}');
  });

  it('keeps the original country-inference wording in the default prompt', () => {
    const address = preprocessAddress('10 Downing Street, London', true);
    const rendered = renderPrompt(DEFAULT_PROMPT, address, '+44 20 7925 0918', '44');

    expect(rendered).toContain('country for this address');
    expect(rendered).toContain('10 Downing Street, London');
  });

  it('renders country_code for country-specific templates', () => {
    const rendered = renderPrompt(
      'Resolve {{address}} in {{country_code}}',
      preprocessAddress('Example road', true),
      '123456',
      '44',
    );

    expect(rendered).toBe('Resolve Example road in 44');
  });
});
