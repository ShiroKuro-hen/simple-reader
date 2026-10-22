import { describe, expect, it } from 'vitest';
import { coverInitial, titleHue } from './cover';

describe('titleHue', () => {
  it('is stable, in 0..359, and tells different titles apart', () => {
    expect(titleHue('Kokoro')).toBe(titleHue('Kokoro'));
    for (const t of ['', 'a', '吾輩は猫である', 'x'.repeat(500)]) {
      expect(titleHue(t)).toBeGreaterThanOrEqual(0);
      expect(titleHue(t)).toBeLessThan(360);
    }
    expect(titleHue('Dune')).not.toBe(titleHue('Emma'));
  });
});

describe('coverInitial', () => {
  it('uses the first letter, uppercased', () => {
    expect(coverInitial('  dune')).toBe('D');
    expect(coverInitial('吾輩は猫である')).toBe('吾');
  });
  it('keeps a whole emoji and falls back for blank titles', () => {
    expect(coverInitial('📚 Books')).toBe('📚');
    expect(coverInitial('   ')).toBe('?');
  });
});
