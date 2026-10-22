import { describe, expect, it } from 'vitest';
import { cleanSelection, detectScript, guessLatinLang, HAS_KANJI } from './script';

describe('detectScript', () => {
  it.each([
    ['猫', 'ja'],
    ['ねこ', 'ja'],
    ['カタカナ', 'ja'],
    ['吾輩は猫である', 'ja'],
    ['Wi-Fiを使う', 'ja'],
    ['house', 'latin'],
    ['canción', 'latin'],
    ['Straße', 'latin'],
    ["don't", 'latin'],
    ['привет', 'other'],
    ['مرحبا', 'other'],
    ['12345', 'other'],
    ['', 'other'],
    ['...', 'other'],
  ])('%s -> %s', (text, expected) => {
    expect(detectScript(text)).toBe(expected);
  });
});

describe('HAS_KANJI', () => {
  it('counts the iteration mark 々 and 〆 as kanji, but not kana, latin or digits', () => {
    expect(HAS_KANJI.test('人々')).toBe(true);
    expect(HAS_KANJI.test('々')).toBe(true);
    expect(HAS_KANJI.test('〆')).toBe(true);
    expect(HAS_KANJI.test('〆切')).toBe(true);
    expect(HAS_KANJI.test('ひらがなカタカナabc123')).toBe(false);
  });
});

describe('guessLatinLang', () => {
  it.each([
    ['casa', 'La casa de mi abuela es muy grande.', 'es'],
    ['house', 'The house was in the middle of the forest.', 'en'],
    ['canción', '', 'es'],
    ['mañana', '', 'es'],
    ['run', 'They have to run to catch the train.', 'en'],
  ])('%s in %j -> %s', (word, context, expected) => {
    expect(guessLatinLang(word, context)).toBe(expected);
  });

  it('says undefined when nothing tells the languages apart', () => {
    expect(guessLatinLang('chip', '')).toBeUndefined();
    expect(guessLatinLang('chip', 'chip')).toBeUndefined();
  });
});

describe('cleanSelection', () => {
  it.each([
    ['  house.  ', 'house'],
    ['“Hello,”', 'Hello'],
    ['«casa»', 'casa'],
    ['「猫」', '猫'],
    ['猫、', '猫'],
    ['two\n  words', 'two words'],
    ['(an aside)', 'an aside'],
    ['', ''],
  ])('%j -> %j', (input, expected) => {
    expect(cleanSelection(input)).toBe(expected);
  });

  it('keeps inner punctuation', () => {
    expect(cleanSelection("don't stop, believing")).toBe("don't stop, believing");
  });
});
