// Translation providers, all open to cross-origin browser requests (checked 2026-10-22).
// Order: Chrome's on-device Translator (when its model is already installed) -> Google gtx -> MyMemory.
import { LookupError } from './errors';

export type Source = 'ja' | 'en' | 'auto';
export interface Translation {
  text: string;
  /** Other renderings, most likely first. */
  alternatives: string[];
  /** ISO code reported by the provider. */
  detected?: string;
  provider: string;
}

const MAX_CHARS = 450; // MyMemory allows 500 bytes; gtx is happy with less than ~2000 chars of GET

/** Unofficial endpoint used by many extensions: no key, CORS *, good quality. May change or be rate limited. */
export const gtxUrl = (text: string, from: Source) =>
  `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=es&dt=t&dt=bd&q=${encodeURIComponent(text)}`;

export function parseGtx(body: unknown): Translation {
  const segments = Array.isArray(body) && Array.isArray(body[0]) ? (body[0] as unknown[]) : [];
  const text = segments.map((s) => (Array.isArray(s) && typeof s[0] === 'string' ? s[0] : '')).join('').trim();
  if (!text) throw new Error('gtx: no translation in response');
  const dictionary = (body as unknown[])[1];
  const posGroup = Array.isArray(dictionary) && Array.isArray(dictionary[0]) ? (dictionary[0] as unknown[])[1] : undefined;
  const alternatives = (Array.isArray(posGroup) ? (posGroup as unknown[]).filter((a): a is string => typeof a === 'string') : [])
    .filter((a) => a.toLowerCase() !== text.toLowerCase())
    .slice(0, 5);
  const detected = (body as unknown[])[2];
  return { text, alternatives, detected: typeof detected === 'string' ? detected : undefined, provider: 'Google Translate' };
}

export const myMemoryUrl = (text: string, from: Source) =>
  `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from === 'auto' ? 'Autodetect' : from}|es`;

/** MyMemory answers this literal for some short words. */
const PLACEHOLDER = 'testvalue';

export function parseMyMemory(body: any): Translation {
  const main: unknown = body?.responseData?.translatedText;
  if (typeof main !== 'string' || body.quotaFinished || Number(body.responseStatus) !== 200) throw new Error('mymemory: unusable response');
  const sources = new Set<string>((body.matches ?? []).map((m: any) => String(m.segment).toLowerCase()));
  const seen = [main, ...(body.matches ?? []).map((m: any) => m.translation)].filter(
    (t): t is string => typeof t === 'string' && t.toLowerCase() !== PLACEHOLDER && !sources.has(t.toLowerCase()),
  );
  const [text, ...rest] = [...new Set(seen)];
  if (!text) throw new Error('mymemory: no translation');
  return { text, alternatives: rest.slice(0, 5), provider: 'MyMemory' };
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

async function chromeTranslate(text: string, from: Source): Promise<Translation | undefined> {
  const T = (globalThis as any).Translator;
  if (!T || from === 'auto') return undefined;
  const opts = { sourceLanguage: from, targetLanguage: 'es' };
  // Only when the model is already on the device: creating one would trigger a download.
  // availability() can hang (seen on headless Linux Chromium): never let it stall a lookup.
  const state = await Promise.race([T.availability(opts).catch(() => 'unavailable'), new Promise((r) => setTimeout(() => r('unavailable'), 1500))]);
  if (state !== 'available') return undefined;
  const translator = await T.create(opts);
  return { text: await translator.translate(text), alternatives: [], provider: 'Chrome Translator' };
}

/** Translates into Spanish. Throws LookupError when every provider failed. */
export async function translate(text: string, from: Source): Promise<Translation> {
  const input = text.slice(0, MAX_CHARS);
  const local = await chromeTranslate(input, from).catch(() => undefined);
  if (local) return local;
  try {
    return parseGtx(await getJson(gtxUrl(input, from)));
  } catch {
    /* fall through */
  }
  try {
    return parseMyMemory(await getJson(myMemoryUrl(input, from)));
  } catch {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    throw new LookupError(offline ? 'offline' : 'network', offline ? 'Sin conexión: no se pudo traducir.' : 'Los servicios de traducción no respondieron.');
  }
}
