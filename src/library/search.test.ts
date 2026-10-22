import { describe, expect, it } from 'vitest';
import type { BookMeta } from '../types';
import { fold, matches } from './search';

const book = (b: Partial<BookMeta> & { title: string }): BookMeta => ({ id: b.title, format: 'epub', size: 1, addedAt: 1, ...b });

describe('fold', () => {
  it.each([
    ['Señal', 'senal'],
    ['SEÑAL', 'senal'],
    ['Ünï Çödé', 'uni code'],
    ['café', 'cafe'], // already-decomposed input
    ['ＡＢＣ１２３', 'abc123'], // full-width Latin
    ['カタカナ', 'かたかな'], // katakana folds to hiragana
    ['ガッコウ', 'がっこう'],
    ['がっこう', 'がっこう'], // dakuten must survive the accent stripping
    ['ぱぴぷ', 'ぱぴぷ'], // so must handakuten
    ['ｶﾞｯｺｳ', 'がっこう'], // half-width katakana
    ['ラーメン', 'らーめん'], // the long-vowel mark is not a kana letter
    ['吾輩は猫である', '吾輩は猫である'],
    ['  two   spaces ', 'two spaces'],
    ['', ''],
  ])('%j -> %j', (input, out) => expect(fold(input)).toBe(out));
});

describe('matches', () => {
  const senal = book({ title: 'Señal de humo', author: 'José Pérez', tags: ['novela', 'sci fi'] });
  const neko = book({ title: '吾輩は猫である', author: '夏目漱石', tags: ['古典'] });
  const norway = book({ title: 'ノルウェイの森' });
  const odd = book({ title: 'Regex (test) [x] .*' });

  it.each([
    [senal, 'senal', true],
    [senal, 'SEÑAL', true],
    [senal, 'ñal', true], // substring, not word start
    [senal, 'jose perez', true], // author, accent-insensitive
    [senal, 'sci fi', true], // tags
    [senal, 'humo senal', true], // any order
    [senal, 'humo perez', true], // tokens may be satisfied by different fields
    [senal, 'humo xyz', false], // but every token must match
    [senal, 'xyz', false],
    [senal, '', true], // an empty query shows everything
    [senal, '   ', true],
    [neko, '猫', true],
    [neko, '漱石', true],
    [neko, '古典', true],
    [neko, '吾輩 猫', true],
    [neko, 'ねこ', false], // no kanji-reading magic: honest about what is searched
    [neko, 'neko', false],
    [norway, 'のるうぇい', true], // hiragana query finds a katakana title
    [norway, 'ノルウェイ', true],
    [norway, '森', true],
    [norway, 'author', false], // a missing author is not the text "undefined"
    [norway, 'undefined', false],
    [odd, '(test)', true], // the query is text, never a regex
    [odd, '.*', true],
    [odd, '[', true],
    [senal, '(', false],
    [senal, '.*', false],
  ])('%#: %j matches %j -> %s', (b, q, expected) => expect(matches(b, q)).toBe(expected));
});
