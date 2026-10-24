import { describe, expect, it } from 'vitest';
import type { SearchHit } from '../types';
import { capHits, excerptParts, groupByChapter, matchesIn, normalizeQuery } from './search-results';

const hit = (chapter: string, match: string): SearchHit => ({ chapter, cfi: `epubcfi(/6/${match})`, pre: '', match, post: '' });

describe('normalizeQuery', () => {
  it('trims the query', () => {
    expect(normalizeQuery('  Paragraph 17  ')).toBe('Paragraph 17');
  });

  it('searches nothing for an empty query', () => {
    expect(normalizeQuery('')).toBe('');
    expect(normalizeQuery('   ')).toBe('');
  });

  it('searches nothing for a single character that is not CJK', () => {
    expect(normalizeQuery('a')).toBe('');
    expect(normalizeQuery(' a ')).toBe('');
    expect(normalizeQuery('7')).toBe('');
  });

  it('searches a single CJK character, since one kanji or kana is a word', () => {
    expect(normalizeQuery('猫')).toBe('猫');
    expect(normalizeQuery('ね')).toBe('ね');
  });

  it('searches two characters of any script', () => {
    expect(normalizeQuery('ab')).toBe('ab');
    expect(normalizeQuery('吾輩')).toBe('吾輩');
  });
});

describe('capHits', () => {
  it('keeps the first 300 hits in order and says the list was cut', () => {
    const hits = Array.from({ length: 301 }, (_, i) => i);
    const { shown, truncated } = capHits(hits);
    expect(shown).toHaveLength(300);
    expect(shown[0]).toBe(0);
    expect(shown[299]).toBe(299);
    expect(truncated).toBe(true);
  });

  it('does not report a cut when there are exactly the maximum', () => {
    const { shown, truncated } = capHits(Array.from({ length: 300 }, (_, i) => i));
    expect(shown).toHaveLength(300);
    expect(truncated).toBe(false);
  });

  it('takes any maximum', () => {
    expect(capHits([1, 2, 3], 2)).toEqual({ shown: [1, 2], truncated: true });
  });
});

describe('groupByChapter', () => {
  it('groups hits under their chapter, chapters in the order they first appear', () => {
    const one = hit('Chapter One', 'a');
    const two = hit('Chapter Two', 'b');
    const again = hit('Chapter One', 'c');
    expect(groupByChapter([one, two, again])).toEqual([
      { chapter: 'Chapter One', hits: [one, again] },
      { chapter: 'Chapter Two', hits: [two] },
    ]);
  });

  it('keeps untitled chapters as their own group', () => {
    const untitled = hit('', 'x');
    expect(groupByChapter([untitled])).toEqual([{ chapter: '', hits: [untitled] }]);
  });
});

describe('excerptParts', () => {
  it('collapses whitespace and keeps the space next to the match', () => {
    const parts = excerptParts({ pre: 'The  lighthouse\nkeeper ', match: 'climbed', post: ' the\tspiral stairs' });
    expect(parts).toEqual({ pre: 'The lighthouse keeper ', match: 'climbed', post: ' the spiral stairs' });
  });

  it('trims a long English side to about 40 characters, cut at a word edge', () => {
    const pre = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen ';
    const post = ' one two three four five six seven eight nine ten eleven twelve thirteen';
    expect(excerptParts({ pre, match: 'climbed', post })).toEqual({
      pre: '…ten eleven twelve thirteen fourteen ',
      match: 'climbed',
      post: ' one two three four five six seven eight…',
    });
  });

  it('cuts a long Japanese side without spaces at 40 characters', () => {
    const { pre, post } = excerptParts({ pre: '猫'.repeat(50), match: '吾輩', post: '猫'.repeat(50) });
    expect(pre).toBe('…' + '猫'.repeat(40));
    expect(post).toBe('猫'.repeat(40) + '…');
  });

  it('leaves a short side as it is', () => {
    expect(excerptParts({ pre: 'a fox ', match: 'jumps', post: ' over' })).toEqual({ pre: 'a fox ', match: 'jumps', post: ' over' });
  });
});

describe('matchesIn', () => {
  it('finds a match in any case, with its offsets into the text', () => {
    const text = 'Page 3 heading. The Harbour master';
    const [m] = matchesIn(text, 'harbour');
    expect(m).toMatchObject({ match: 'Harbour' });
    expect(text.slice(m!.start, m!.end)).toBe('Harbour');
  });

  it('ignores accents: cafe finds café and café finds cafe', () => {
    expect(matchesIn('a café by the sea', 'cafe').map((m) => m.match)).toEqual(['café']);
    expect(matchesIn('a cafe by the sea', 'café').map((m) => m.match)).toEqual(['cafe']);
  });

  it('finds every match, in order', () => {
    const text = 'harbour, Harbour and harbour again';
    expect(matchesIn(text, 'harbour').map((m) => m.start)).toEqual([0, 9, 21]);
  });

  it('gives the text on each side of the match', () => {
    const [m] = matchesIn('The harbour master counted', 'master');
    expect(m).toMatchObject({ pre: 'The harbour ', match: 'master', post: ' counted' });
  });

  it('finds nothing when the text does not have the query', () => {
    expect(matchesIn('Page 3 heading.', 'zzqx')).toEqual([]);
  });

  it('finds Japanese text without spaces', () => {
    expect(matchesIn('吾輩は猫である。名前はまだ無い。', '名前').map((m) => m.start)).toEqual([8]);
  });
});
