import { describe, expect, it } from 'vitest';
import { sentenceAround } from './sentence';

const span = (text: string, word: string) => {
  const start = text.indexOf(word);
  return [start, start + word.length] as const;
};

describe('sentenceAround', () => {
  const text = 'It was late. The keeper climbed the stairs every evening. Nobody saw him leave!';

  it('returns the one sentence that holds the selection', () => {
    expect(sentenceAround(text, ...span(text, 'keeper'))).toBe('The keeper climbed the stairs every evening.');
  });
  it('works at the first and last sentences', () => {
    expect(sentenceAround(text, ...span(text, 'late'))).toBe('It was late.');
    expect(sentenceAround(text, ...span(text, 'leave'))).toBe('Nobody saw him leave!');
  });
  it('splits Japanese on 。 and ！', () => {
    const ja = '吾輩は猫である。名前はまだ無い！どこで生れたか。';
    expect(sentenceAround(ja, ...span(ja, '名前'))).toBe('名前はまだ無い！');
  });
  it('covers both sentences when the selection crosses a boundary', () => {
    const a = text.indexOf('late');
    const b = text.indexOf('keeper') + 6;
    expect(sentenceAround(text, a, b)).toBe('It was late. The keeper climbed the stairs every evening.');
  });
  it('collapses whitespace and line breaks', () => {
    const t = 'Line one\n  continues   here. Next.';
    expect(sentenceAround(t, ...span(t, 'continues'))).toBe('Line one continues here.');
  });
  it('keeps a window around the selection when there is no punctuation for ages', () => {
    const t = 'word '.repeat(400) + 'TARGET ' + 'word '.repeat(400);
    const got = sentenceAround(t, ...span(t, 'TARGET'));
    expect(got).toContain('TARGET');
    expect(got.length).toBeLessThanOrEqual(400);
  });
});
