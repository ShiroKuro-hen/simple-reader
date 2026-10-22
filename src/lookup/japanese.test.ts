// Real kuromoji + real JMdict, no stubs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { setDictBase } from './ja';
import { type Jmdict, parseJmdict } from './jmdict';
import { lookupJapaneseLocal } from './japanese';

let dict: Jmdict;
beforeAll(async () => {
  setDictBase(fileURLToPath(new URL('../../public/dict/', import.meta.url)));
  dict = await parseJmdict(new Uint8Array(readFileSync(fileURLToPath(new URL('../../public/dict/jmdict.json.gz', import.meta.url)))));
}, 60_000);

describe('lookupJapaneseLocal', () => {
  it('reads a single kanji word', async () => {
    const r = await lookupJapaneseLocal('猫', dict);
    expect(r).toMatchObject({ reading: 'ねこ', romaji: 'neko', lemma: '猫' });
    expect(r.entry?.es[0]).toBe('gato');
  });

  it('reads a conjugated verb and finds its dictionary form', async () => {
    const r = await lookupJapaneseLocal('食べました', dict);
    expect(r).toMatchObject({ reading: 'たべました', romaji: 'tabemashita', lemma: '食べる' });
    expect(r.entry?.reading).toBe('たべる');
  });

  it('finds the dictionary form of a past-tense adjective', async () => {
    const r = await lookupJapaneseLocal('美しかった', dict);
    expect(r.lemma).toBe('美しい');
    expect(r.entry?.reading).toBe('うつくしい');
  });

  it('romanises the particle は as wa and keeps long vowels', async () => {
    const r = await lookupJapaneseLocal('吾輩は猫である', dict);
    expect(r.reading).toBe('わがはいはねこである');
    expect(r.romaji).toBe('wagahaiwanekodearu');
    expect((await lookupJapaneseLocal('東京', dict)).romaji).toBe('tōkyō');
  });

  it('does not present the first word of a sentence as the meaning of the whole selection', async () => {
    const r = await lookupJapaneseLocal('私は猫です', dict);
    expect(r.entry).toBeUndefined();
    expect(r.reading).toBe('わたしはねこです');
  });

  it('still finds the word when the selection carries its particle or auxiliaries', async () => {
    expect((await lookupJapaneseLocal('私は', dict)).entry?.reading).toBe('わたし');
    expect((await lookupJapaneseLocal('読んでいません', dict)).entry?.reading).toBe('よむ');
  });

  it('works for a word written in kana', async () => {
    const r = await lookupJapaneseLocal('ねこ', dict);
    expect(r.reading).toBe('ねこ');
    expect(r.entry?.es[0]).toBe('gato');
  });

  it('returns a reading but no entry for text the dictionary does not know', async () => {
    const r = await lookupJapaneseLocal('ぬぬぬぬ', dict);
    expect(r.entry).toBeUndefined();
    expect(r.reading).toBe('ぬぬぬぬ');
  });

  it('works without a dictionary (JMdict failed to load): reading only', async () => {
    const r = await lookupJapaneseLocal('猫', undefined);
    expect(r).toMatchObject({ reading: 'ねこ', entry: undefined });
  });
});
