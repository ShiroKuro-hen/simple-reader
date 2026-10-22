// Uses the real kuromoji dictionary (public/dict) through the real tokenizer: no stubs.
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { setDictBase, tokenize } from './ja';
import { rubyHtml, segment } from './ruby';

beforeAll(() => setDictBase(fileURLToPath(new URL('../../public/dict/', import.meta.url))), 60_000);

const furigana = async (text: string) => rubyHtml(await tokenize(text), 'furigana');
const romaji = async (text: string) => rubyHtml(await tokenize(text), 'romaji');
const r = (base: string, rt: string) => `<ruby>${base}<rt>${rt}</rt></ruby>`;

describe('furigana: only kanji get a reading, okurigana stay outside', () => {
  it.each([
    ['食べました', `${r('食', 'た')}べました`],
    ['吾輩は猫である', `${r('吾輩', 'わがはい')}は${r('猫', 'ねこ')}である`],
    ['振り返る', `${r('振', 'ふ')}り${r('返', 'かえ')}る`],
    ['美しい', `${r('美', 'うつく')}しい`],
    ['新しい本を読んでいます', `${r('新', 'あたら')}しい${r('本', 'ほん')}を${r('読', 'よ')}んでいます`],
    ['人々', r('人々', 'ひとびと')],
    ['日本語', r('日本語', 'にほんご')],
  ])('%s', async (text, expected) => {
    expect(await furigana(text)).toBe(expected);
  });

  it('leaves kana, katakana loanwords, latin and digits untouched', async () => {
    for (const text of ['ひらがなだけ', 'コーヒーとケーキ', 'Hello, world!', '12345', '']) {
      expect(await furigana(text)).toBe(text);
    }
  });

  it('keeps digits and latin around kanji outside the ruby', async () => {
    const html = await furigana('2024年のWi-Fi');
    expect(html.startsWith('2024')).toBe(true);
    expect(html).toContain('Wi-Fi');
    expect(html).toContain(r('年', 'ねん'));
  });

  it('keeps punctuation and brackets outside the ruby', async () => {
    expect(await furigana('「猫」だ。')).toBe(`「${r('猫', 'ねこ')}」だ。`);
  });

  it('escapes html metacharacters of the text itself', async () => {
    const html = await furigana('猫<犬&"鳥"');
    expect(html).toContain('&lt;');
    expect(html).toContain('&amp;');
    expect(html).not.toMatch(/<(?!\/?(ruby|rt)>)/);
  });

  it('keeps a katakana-kanji mix inside one token readable', async () => {
    const html = await furigana('一ヶ月');
    expect(html.replace(/<rt>.*?<\/rt>/g, '').replace(/<\/?ruby>/g, '')).toBe('一ヶ月');
  });
});

describe('romaji mode', () => {
  it('puts hepburn romaji in the rt instead of hiragana', async () => {
    expect(await romaji('食べました')).toBe(`${r('食', 'ta')}べました`);
    expect(await romaji('猫')).toBe(r('猫', 'neko'));
  });
});

describe('structural invariants on a table of real sentences', () => {
  const sentences = [
    '吾輩は猫である。名前はまだ無い。',
    'どこで生れたかとんと見当がつかぬ。',
    '国境の長いトンネルを抜けると雪国であった。',
    '祇園精舎の鐘の声、諸行無常の響きあり。',
    '彼女は「ありがとう」と言って、にっこり笑った。',
    '東京都千代田区〆切は3月31日です',
    '少しずつ、時々、様々な人々が集まる',
    '私はコーヒーを飲みながらJavaScriptの本を読んだ。',
    '　全角スペース\tタブ\n改行を含む。',
    '😀絵文字と猫🐈',
  ];

  it.each(sentences)('%s', async (text) => {
    const tokens = await tokenize(text);
    expect(tokens.map((t) => t.surface_form).join('')).toBe(text);

    for (const mode of ['furigana', 'romaji'] as const) {
      const html = rubyHtml(tokens, mode);
      // dropping the annotations gives back the original text (escaped)
      const plain = html.replace(/<rt>.*?<\/rt>/g, '').replace(/<\/?ruby>/g, '');
      expect(plain).toBe(text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
      // never nested, always balanced
      expect(html).not.toMatch(/<ruby>(?:(?!<\/ruby>).)*<ruby>/s);
      expect((html.match(/<ruby>/g) ?? []).length).toBe((html.match(/<\/ruby>/g) ?? []).length);
      // every ruby base is kanji only and every rt is non-empty
      for (const m of html.matchAll(/<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>/gs)) {
        expect(m[1]).toMatch(/^[々〆㐀-鿿豈-﫿ヶ一]+$/);
        expect(m[2]).not.toBe('');
      }
    }
  });
});

describe('segment', () => {
  it('returns nothing to annotate for kana-only text', async () => {
    expect(segment(await tokenize('ひらがなとカタカナ')).every((s) => s.reading === undefined)).toBe(true);
  });

  it('falls back to wrapping the whole token when okurigana cannot be aligned', () => {
    const odd = [{ surface_form: '何故', basic_form: '何故', pos: '副詞', reading: 'ナゼ' }];
    expect(segment(odd)).toEqual([{ text: '何故', reading: 'なぜ' }]);
    const mismatch = [{ surface_form: '食べる', basic_form: '食べる', pos: '動詞', reading: 'ゴニョゴニョ' }];
    expect(segment(mismatch)).toEqual([{ text: '食べる', reading: 'ごにょごにょ' }]);
  });

  it('never annotates a kana-only token, even when its reading differs from its spelling', () => {
    const particle = [{ surface_form: 'は', basic_form: 'は', pos: '助詞', reading: 'ハ', pronunciation: 'ワ' }];
    expect(segment(particle)).toEqual([{ text: 'は' }]);
    const odd = [{ surface_form: 'わたし', basic_form: '私', pos: '名詞', reading: 'ワタクシ' }];
    expect(segment(odd)).toEqual([{ text: 'わたし' }]);
  });

  it('does not annotate a token with a missing reading', () => {
    expect(segment([{ surface_form: '謎', basic_form: '*', pos: '名詞' }])).toEqual([{ text: '謎' }]);
  });
});

describe('a whole chapter', () => {
  it('is annotated paragraph by paragraph (one text node each) with no call long enough to freeze a page', async () => {
    const paragraph = '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。';
    await tokenize(paragraph); // dictionary load is not part of the measurement
    const times: number[] = [];
    let chars = 0;
    for (let i = 0; i < 500; i++) {
      const start = performance.now();
      rubyHtml(await tokenize(paragraph), 'furigana');
      times.push(performance.now() - start);
      chars += paragraph.length;
    }
    expect(chars).toBeGreaterThan(30_000);
    expect(Math.max(...times)).toBeLessThan(250); // one text node
    expect(times.reduce((a, b) => a + b)).toBeLessThan(30_000); // whole chapter
  }, 120_000);
});
