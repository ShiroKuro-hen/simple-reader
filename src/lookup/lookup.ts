import type { LookupResult } from '../types';
import { cacheGet, cacheSet } from './cache';
import { LookupError } from './errors';
import { lookupJapaneseLocal } from './japanese';
import { type Jmdict, loadJmdict } from './jmdict';
import { type Translation, translate } from './providers';
import { cleanSelection, detectScript, guessLatinLang } from './script';
import { fetchExtract, parseDefinitions } from './wiktionary';

const MISSING_ES = 'Sin traducción: no hay conexión con el servicio de traducción.';

/** Anything that is not already a LookupError becomes one; offline is told apart from a provider failure. */
function asLookupError(e: unknown): LookupError {
  if (e instanceof LookupError) return e;
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return new LookupError(offline ? 'offline' : 'network', offline ? 'Sin conexión.' : 'El servicio no respondió.');
}

async function lookupJapanese(word: string): Promise<LookupResult> {
  const dict: Jmdict | undefined = await loadJmdict().catch(() => undefined);
  const { reading, romaji, entry } = await lookupJapaneseLocal(word, dict);
  const result: LookupResult = { word, lang: 'ja', reading, romaji, definitions: [], source: 'kuromoji' };

  if (entry?.es.length) {
    return { ...result, definitions: entry.es, translation: entry.es[0]!.split(',')[0], source: 'JMdict (es)' };
  }
  try {
    if (entry?.en.length) {
      const t = await translate(entry.en.join('\n'), 'en');
      const definitions = t.text.split('\n').map((l) => l.trim()).filter(Boolean);
      return { ...result, definitions, translation: definitions[0], source: `JMdict (en) + ${t.provider}` };
    }
    const t = await translate(word, 'ja');
    return { ...result, definitions: t.alternatives, translation: t.text, source: t.provider };
  } catch {
    // The reading above is still valid offline; say honestly what is missing.
    return { ...result, definitions: entry?.en.map((e) => `(en) ${e}`) ?? [MISSING_ES], source: entry ? 'JMdict (en)' : 'kuromoji' };
  }
}

async function lookupLatin(word: string, context: string): Promise<LookupResult> {
  const isPhrase = word.split(' ').length > 3;
  let lang: 'en' | 'es' | 'other' | undefined = guessLatinLang(word, context);
  let translation: Translation | undefined;
  if (!lang) {
    translation = await translate(word, 'auto');
    lang = translation.detected === 'es' || translation.detected === 'en' ? translation.detected : 'other';
  }

  if (lang === 'es') {
    const definitions = isPhrase ? [] : parseDefinitions(await fetchExtract(word).catch((e) => Promise.reject(asLookupError(e))), 'Español');
    return { word, lang, definitions, source: 'es.wiktionary.org' };
  }

  const wanted = lang === 'en' && !isPhrase;
  const [t, extract] = await Promise.allSettled([
    translation ?? translate(word, lang === 'en' ? 'en' : 'auto'),
    wanted ? fetchExtract(word) : Promise.resolve(''),
  ]);
  if (t.status === 'rejected' && extract.status === 'rejected') throw asLookupError(t.reason);
  const defs = extract.status === 'fulfilled' ? parseDefinitions(extract.value, 'Inglés') : [];
  const tr = t.status === 'fulfilled' ? t.value : undefined;
  return {
    word,
    lang,
    translation: tr?.text,
    definitions: defs.length ? defs : (tr?.alternatives ?? []),
    source: [tr?.provider, defs.length ? 'es.wiktionary.org' : undefined].filter(Boolean).join(' + ') || 'es.wiktionary.org',
  };
}

async function lookupOther(word: string): Promise<LookupResult> {
  const t = await translate(word, 'auto').catch((e) => Promise.reject(asLookupError(e)));
  return { word, lang: 'other', translation: t.text, definitions: t.alternatives, source: t.provider };
}

/**
 * Looks a selection up. Resolves with whatever could be found (Japanese readings work offline);
 * rejects with LookupError only when nothing at all could be produced.
 */
export async function lookup(text: string, context = ''): Promise<LookupResult> {
  const word = cleanSelection(text);
  if (!word) throw new LookupError('empty', 'Nada seleccionado.');
  const cached = cacheGet(word);
  if (cached) return cached;

  const script = detectScript(word);
  const result =
    script === 'ja' ? await lookupJapanese(word) : script === 'latin' ? await lookupLatin(word, context) : await lookupOther(word);
  // A degraded answer (Japanese reading without translation) is not kept, so the next try can complete it.
  if (result.lang === 'es' ? result.definitions.length : result.translation !== undefined) cacheSet(word, result);
  return result;
}
