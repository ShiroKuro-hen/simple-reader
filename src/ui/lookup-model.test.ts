import { describe, expect, it } from 'vitest';
import type { LookupResult } from '../types';
import { classifySelection, createLatest, describeResult, settle } from './lookup-model';

describe('classifySelection', () => {
  it('ignores empty and whitespace-only selections', () => {
    expect(classifySelection('')).toBe('ignore');
    expect(classifySelection(' \n\t ')).toBe('ignore');
  });
  it('treats short text as a word', () => {
    expect(classifySelection('ephemeral')).toBe('word');
    expect(classifySelection('  猫  ')).toBe('word');
    expect(classifySelection('図書館に行く')).toBe('word'); // 6 chars: still a word-ish unit
    expect(classifySelection('look up')).toBe('word');
  });
  it('treats a sentence as a phrase', () => {
    expect(classifySelection('The quick brown fox jumps over it')).toBe('phrase');
    expect(classifySelection('吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。')).toBe('phrase');
  });
  it('rejects more than 200 characters, after trimming', () => {
    expect(classifySelection('a'.repeat(200))).toBe('phrase');
    expect(classifySelection('a'.repeat(201))).toBe('too-long');
    expect(classifySelection(' ' + 'a'.repeat(200) + ' ')).toBe('phrase');
  });
});

const base: LookupResult = { word: 'x', lang: 'en', definitions: [], source: 'Wiktionary' };

describe('describeResult', () => {
  it('shows reading and romaji for Japanese', () => {
    const c = describeResult(
      { ...base, word: '猫', lang: 'ja', reading: 'ねこ', romaji: 'neko', definitions: ['gato'], translation: 'gato' },
      'word',
    );
    expect(c).toMatchObject({ heading: '猫', reading: 'ねこ', romaji: 'neko', translation: 'gato', definitions: ['gato'], empty: false });
  });
  it('hides a reading that just repeats the word but keeps the romaji', () => {
    const c = describeResult({ ...base, word: 'ねこ', lang: 'ja', reading: 'ねこ', romaji: 'neko', definitions: ['gato'] }, 'word');
    expect(c.reading).toBeUndefined();
    expect(c.romaji).toBe('neko');
  });
  it('ignores reading and romaji for non-Japanese results', () => {
    const c = describeResult({ ...base, reading: 'x', romaji: 'y', translation: 'efimero' }, 'word');
    expect(c.reading).toBeUndefined();
    expect(c.romaji).toBeUndefined();
  });
  it('shows an English word as translation plus at most 3 clean definitions', () => {
    const c = describeResult(
      { ...base, word: 'ephemeral', translation: 'efímero', definitions: [' breve ', '', 'pasajero', 'breve', 'fugaz', 'transitorio'] },
      'word',
    );
    expect(c.translation).toBe('efímero');
    expect(c.definitions).toEqual(['breve', 'pasajero', 'fugaz']);
  });
  it('shows only the translation for a phrase when there is one', () => {
    const c = describeResult({ ...base, translation: 'hola mundo', definitions: ['a', 'b'] }, 'phrase');
    expect(c.definitions).toEqual([]);
    expect(c.translation).toBe('hola mundo');
  });
  it('falls back to definitions for a phrase without a translation', () => {
    expect(describeResult({ ...base, definitions: ['a'] }, 'phrase').definitions).toEqual(['a']);
  });
  it('flags an answer with nothing to show', () => {
    expect(describeResult(base, 'word').empty).toBe(true);
  });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('stale lookups', () => {
  it('drops the result of a lookup that was superseded', async () => {
    const latest = createLatest();
    const slow = settle(latest, async () => {
      await sleep(30);
      return 'first';
    });
    const fast = settle(latest, async () => 'second');
    expect(await fast).toEqual({ status: 'ok', value: 'second' });
    expect(await slow).toEqual({ status: 'stale' });
  });
  it('drops a result that arrives after cancel (popup closed)', async () => {
    const latest = createLatest();
    const p = settle(latest, async () => {
      await sleep(10);
      return 1;
    });
    latest.cancel();
    expect(await p).toEqual({ status: 'stale' });
  });
  it('reports failure of the current lookup but not of a stale one', async () => {
    const latest = createLatest();
    const boom = async (): Promise<number> => {
      await sleep(10);
      throw new Error('offline');
    };
    const a = settle(latest, boom);
    const b = settle(latest, boom);
    expect(await a).toEqual({ status: 'stale' });
    expect(await b).toEqual({ status: 'error' });
  });
});
