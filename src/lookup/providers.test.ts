// Parsing and URL building checked against payloads recorded from the live APIs (fixtures/*.json).
import { describe, expect, it } from 'vitest';
import { fixture } from './fixture';
import { gtxUrl, myMemoryUrl, parseGtx, parseMyMemory } from './providers';

describe('Google Translate (gtx endpoint)', () => {
  it('builds the same request that was recorded', () => {
    expect(gtxUrl('house', 'en')).toBe(fixture('gtx-house-en').url);
    expect(gtxUrl('猫', 'ja')).toBe(fixture('gtx-neko-ja').url);
    expect(gtxUrl('perro', 'auto')).toBe(fixture('gtx-perro-auto').url);
  });

  it('takes the translation and the alternatives of a word', () => {
    const t = parseGtx(fixture('gtx-house-en').body);
    expect(t.text).toBe('casa');
    expect(t.alternatives.slice(0, 3)).toEqual(['cámara', 'familia', 'sala']);
    expect(t.alternatives).not.toContain('casa');
    expect(t.detected).toBe('en');
  });

  it('handles a response without alternatives', () => {
    expect(parseGtx(fixture('gtx-neko-ja').body)).toMatchObject({ text: 'gato', alternatives: [], detected: 'ja' });
  });

  it('translates a whole sentence', () => {
    expect(parseGtx(fixture('gtx-sentence-ja').body).text).toBe('soy un gato');
  });

  it('joins the segments of a multi-sentence text, keeping the spacing the API returns', () => {
    expect(parseGtx(fixture('gtx-two-sentences-en').body).text).toBe('Hola. ¿Cómo estás hoy?');
  });

  it('reports the detected language when the source is auto', () => {
    expect(parseGtx(fixture('gtx-perro-auto').body).detected).toBe('es');
  });

  it.each([[{}], [null], ['<html>blocked</html>'], [[]], [[[]]]])('rejects an unusable payload %j', (body) => {
    expect(() => parseGtx(body)).toThrow();
  });
});

describe('MyMemory', () => {
  it('builds the same request that was recorded', () => {
    expect(myMemoryUrl('house', 'en')).toBe(fixture('mymemory-house-en').url);
    expect(myMemoryUrl('猫', 'ja')).toBe(fixture('mymemory-neko-ja').url);
  });

  it('uses its autodetect source name', () => {
    expect(myMemoryUrl('perro', 'auto')).toContain('langpair=Autodetect|es');
  });

  it('takes the best match and lists the other translations without repeats', () => {
    const t = parseMyMemory(fixture('mymemory-house-en').body);
    expect(t.text).toBe('albergar');
    expect(t.alternatives).toEqual(['casa']);
  });

  it('never returns the "testvalue" placeholder the service answers for some words', () => {
    const t = parseMyMemory(fixture('mymemory-hello-en').body);
    expect(t.text).not.toBe('testvalue');
    expect(t.alternatives).not.toContain('testvalue');
    expect(t.alternatives).not.toContain('hello'); // untranslated echo
  });

  it('keeps the Japanese result and its alternatives', () => {
    const t = parseMyMemory(fixture('mymemory-neko-ja').body);
    expect(t.text).toBe('Felis silvestris catus');
    expect(t.alternatives).toContain('gato');
  });

  it('rejects a quota or error answer', () => {
    expect(() => parseMyMemory({ responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS' }, quotaFinished: true, responseStatus: 429, matches: [] })).toThrow();
    expect(() => parseMyMemory(null)).toThrow();
  });
});
