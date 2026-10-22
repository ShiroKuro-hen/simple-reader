import { describe, expect, it } from 'vitest';
import { fixture } from './fixture';
import { extractOf, languagesOf, parseDefinitions, wiktionaryUrl } from './wiktionary';

const extract = (name: string) => extractOf(fixture(name).body);

describe('es.wiktionary extract', () => {
  it('builds the same request that was recorded', () => {
    expect(wiktionaryUrl('casa')).toBe(fixture('wiktionary-casa').url);
  });

  it('lists the languages of the page', () => {
    expect(languagesOf(extract('wiktionary-casa'))).toContain('Español');
    expect(languagesOf(extract('wiktionary-dog'))).toEqual(expect.arrayContaining(['Bretón', 'Inglés']));
  });

  it('gives Spanish senses of a Spanish word, skipping synonym and usage lines', () => {
    const defs = parseDefinitions(extract('wiktionary-casa'), 'Español');
    expect(defs[0]).toBe('Edificación destinada a vivienda.');
    expect(defs[1]).toBe('Domicilio.');
    expect(defs.some((d) => /^(Uso|Sinónimo)/.test(d))).toBe(false);
  });

  it('gives Spanish senses of an English word, ignoring other languages on the page', () => {
    const defs = parseDefinitions(extract('wiktionary-dog'), 'Inglés');
    expect(defs[0]).toBe('Perro.');
    expect(defs).not.toContain('Mutación suave del sustantivo masculino tog (\'sombrero\')');
  });

  it('collects senses across parts of speech for the inflected "running"', () => {
    const defs = parseDefinitions(extract('wiktionary-running'), 'Inglés');
    expect(defs).toContain('Corrida.');
    expect(defs).toContain('Corriendo.');
  });

  it('stops at the end of the language section, not at the end of the page', () => {
    expect(parseDefinitions(extract('wiktionary-dog'), 'Bretón')).toEqual(["Mutación suave del sustantivo masculino tog ('sombrero')"]);
  });

  it('caps the number of senses', () => {
    expect(parseDefinitions(extract('wiktionary-casa'), 'Español', 3)).toHaveLength(3);
  });

  it('is empty for a language that is not on the page, and for a missing page', () => {
    expect(parseDefinitions(extract('wiktionary-casa'), 'Inglés')).toEqual([]);
    expect(extract('wiktionary-missing')).toBe('');
    expect(parseDefinitions('', 'Español')).toEqual([]);
  });
});
