import { describe, expect, it } from 'vitest';
import { joinSpoken } from './useSpeechInput';

describe('speech input', () => {
  it('capitalises a fresh message and appends to typed text', () => {
    expect(joinSpoken('', 'häät 12. joulukuuta 120 vierasta')).toBe('Häät 12. joulukuuta 120 vierasta');
    expect(joinSpoken('Wedding on 12 Dec,', ' 120 guests ')).toBe('Wedding on 12 Dec, 120 guests');
    expect(joinSpoken('keep this', '   ')).toBe('keep this');
    expect(joinSpoken('', 'häät 12. joulukuuta   120 vierasta ')).toBe('Häät 12. joulukuuta 120 vierasta');
  });
});
