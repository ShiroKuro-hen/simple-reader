// wordAt / toDomRange: pure offset maths, plus the real kuromoji tokenizer (no stubs) on Japanese sentences.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { setDictBase, tokenize } from './ja';
import { toDomRange, type WordToken, wordAt } from './word-at';

// Hand-made tokens for 漢字を読む。 (word_position is 1-based, as kuromoji reports it).
const TOKENS = [
  { surface_form: '漢字', word_position: 1 },
  { surface_form: 'を', word_position: 3 },
  { surface_form: '読む', word_position: 4 },
  { surface_form: '。', word_position: 6 },
];

describe('wordAt, hand-made tokens', () => {
  it('returns the [start, end) range of the token under the offset', () => {
    expect(wordAt(TOKENS, 0)).toEqual({ start: 0, end: 2 });
    expect(wordAt(TOKENS, 1)).toEqual({ start: 0, end: 2 });
    expect(wordAt(TOKENS, 2)).toEqual({ start: 2, end: 3 });
    expect(wordAt(TOKENS, 4)).toEqual({ start: 3, end: 5 });
  });

  it('is null on punctuation, whitespace, and outside the text', () => {
    expect(wordAt(TOKENS, 5)).toBeNull();
    expect(wordAt(TOKENS, 6)).toBeNull();
    expect(wordAt(TOKENS, -1)).toBeNull();
    expect(wordAt([{ surface_form: ' ', word_position: 1 }], 0)).toBeNull();
    expect(wordAt([], 0)).toBeNull();
  });
});

describe('toDomRange', () => {
  const parts = ['漢字', 'を', '読', 'む。'];

  it('maps a word inside one text node', () => {
    expect(toDomRange(parts, 0, 2)).toEqual({ startPart: 0, startOffset: 0, endPart: 0, endOffset: 2 });
  });

  it('maps a word that is a whole text node', () => {
    expect(toDomRange(parts, 2, 3)).toEqual({ startPart: 1, startOffset: 0, endPart: 1, endOffset: 1 });
  });

  it('maps a word that spans nodes (the ruby base 読 and the okurigana む。)', () => {
    expect(toDomRange(parts, 3, 5)).toEqual({ startPart: 2, startOffset: 0, endPart: 3, endOffset: 1 });
  });

  it('prefers the start of the next node for a start on a boundary, and the end of the previous node for an end on one', () => {
    const split = ['食', 'べ', 'ました'];
    expect(toDomRange(split, 0, 2)).toEqual({ startPart: 0, startOffset: 0, endPart: 1, endOffset: 1 }); // ends at the end of 'べ'
    expect(toDomRange(split, 2, 3)).toEqual({ startPart: 2, startOffset: 0, endPart: 2, endOffset: 1 }); // starts at the start of 'ました'
    expect(toDomRange(split, 0, 5)).toEqual({ startPart: 0, startOffset: 0, endPart: 2, endOffset: 3 });
  });

  it('skips empty parts', () => {
    expect(toDomRange(['漢', '', '字'], 1, 2)).toEqual({ startPart: 2, startOffset: 0, endPart: 2, endOffset: 1 });
  });

  it('is null for an empty, negative or out-of-range selection', () => {
    expect(toDomRange(parts, 3, 3)).toBeNull();
    expect(toDomRange(parts, -1, 2)).toBeNull();
    expect(toDomRange(parts, 0, 7)).toBeNull();
    expect(toDomRange(parts, 6, 7)).toBeNull();
  });
});

describe('with the real tokenizer', () => {
  beforeAll(() => setDictBase(fileURLToPath(new URL('../../public/dict/', import.meta.url))), 60_000);

  // Every offset of a sentence, each mapped to the word a click on that character should select.
  async function wordsAt(sentence: string) {
    const tokens = (await tokenize(sentence)) as WordToken[]; // real kuromoji tokens always carry word_position
    return [...sentence].map((_, i) => {
      const r = wordAt(tokens, i);
      return r && sentence.slice(r.start, r.end);
    });
  }

  it('finds the kanji word and the particle in 漢字を読む。', async () => {
    expect(await wordsAt('漢字を読む。')).toEqual(['漢字', '漢字', 'を', '読む', '読む', null]);
  });

  it('finds each word of 吾輩は猫である。, including the auxiliaries', async () => {
    expect(await wordsAt('吾輩は猫である。')).toEqual(['吾輩', '吾輩', 'は', '猫', 'で', 'ある', 'ある', null]);
  });

  it('splits 薬屋のひとりごと into its words', async () => {
    expect(await wordsAt('薬屋のひとりごと')).toEqual(['薬屋', '薬屋', 'の', 'ひとり', 'ひとり', 'ひとり', 'ごと', 'ごと']);
  });

  it('maps a word across furigana text nodes back onto the DOM parts', async () => {
    const parts = ['漢字', 'を', '読', 'む。']; // the base text of <ruby>漢<rt>かん</rt></ruby>字を<ruby>読<rt>よ</rt></ruby>む。
    const text = parts.join('');
    const { start, end } = wordAt((await tokenize(text)) as WordToken[], 4)!;
    expect(text.slice(start, end)).toBe('読む');
    expect(toDomRange(parts, start, end)).toEqual({ startPart: 2, startOffset: 0, endPart: 3, endOffset: 1 });
  });
});
