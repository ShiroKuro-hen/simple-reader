// JMdict, slimmed by tools/build-jmdict.mjs: { form: [[reading, [es senses], [en senses], common]] }.
import { getDictBase } from './ja';
import { kataToHira } from './ruby';

type Raw = [string, string[], string[], 0 | 1];
export type Jmdict = Record<string, Raw[]>;
export interface Entry {
  /** Hiragana. */
  reading: string;
  /** One string per sense, glosses joined with ", ". */
  es: string[];
  en: string[];
  common: boolean;
}

export async function parseJmdict(bytes: Uint8Array): Promise<Jmdict> {
  // Some static hosts un-gzip .gz files on the way out, others do not: accept both.
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const stream = gzipped ? new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')) : undefined;
  const text = stream ? await new Response(stream).text() : new TextDecoder().decode(bytes);
  const dict = JSON.parse(text) as Jmdict;
  if (typeof dict !== 'object' || Array.isArray(dict)) throw new Error('not a JMdict file');
  return dict;
}

let loading: Promise<Jmdict> | undefined;
/** Fetched on first Japanese lookup (2 MB). */
export function loadJmdict(): Promise<Jmdict> {
  loading ??= fetch(`${getDictBase()}jmdict.json.gz`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`jmdict ${r.status}`))))
    .then((b) => parseJmdict(new Uint8Array(b)))
    .catch((e) => {
      loading = undefined;
      throw e;
    });
  return loading;
}

/** Same reading first, then common words, then those with Spanish glosses; file order (JMdict id) breaks ties. */
function rank(entries: Raw[], reading?: string): Raw {
  const score = (e: Raw) => (reading && e[0] === reading ? 4 : 0) + e[3] * 2 + (e[1].length ? 1 : 0);
  return entries.reduce((best, e) => (score(e) > score(best) ? e : best));
}

/** First candidate that is in the dictionary wins. */
export function findEntry(dict: Jmdict, candidates: { form: string; reading?: string }[]): Entry | undefined {
  for (const { form, reading } of candidates) {
    const entries = dict[form];
    if (!entries?.length) continue;
    const [r, es, en, common] = rank(entries, reading && kataToHira(reading));
    return { reading: r, es, en, common: common === 1 };
  }
  return undefined;
}
