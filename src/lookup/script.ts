// Pure text helpers: no DOM, no network.
export const HAS_KANJI = /[々〆㐀-䶿一-鿿豈-﫿]/;
const HAS_KANA = /[぀-ヿｦ-ﾟ]/;

export function detectScript(text: string): 'ja' | 'latin' | 'other' {
  if (HAS_KANA.test(text) || HAS_KANJI.test(text)) return 'ja';
  const letters = text.replace(/[^\p{L}]/gu, '');
  return letters && /^\p{Script=Latin}+$/u.test(letters) ? 'latin' : 'other';
}

const STOP = {
  en: 'the of and to is are was were it that this with for as on at by be have has had not you he she they we his her their from but or an in which what'.split(' '),
  es: 'el la los las de y que en es son era un una por con para no se su sus al lo como pero más del esta este ese eso muy ya también'.split(' '),
};

/** Cheap Spanish-vs-English guess from accents and stop words; undefined = can't tell. */
export function guessLatinLang(text: string, context = ''): 'en' | 'es' | undefined {
  if (/[áéíóúñü¿¡]/i.test(text)) return 'es';
  const words = `${text} ${context}`.toLowerCase().match(/\p{L}+/gu) ?? [];
  const score = (l: 'en' | 'es') => words.filter((w) => STOP[l].includes(w)).length + (/[áéíóúñ¿¡]/i.test(context) && l === 'es' ? 2 : 0);
  const en = score('en');
  const es = score('es');
  return en === es ? undefined : en > es ? 'en' : 'es';
}

/** Strips quotes/punctuation around a selection, keeps inner text. */
export function cleanSelection(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/^[\s"'“”‘’«»¿¡(\[「『（]+|[\s"'“”‘’«»?!.,;:)\]」』）、。]+$/gu, '').trim();
}
