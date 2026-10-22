// Kuromoji tokeniser behind kuroshiro. The 17 MB dictionary is only fetched on first use.
import Kuroshiro from 'kuroshiro';
import { withGzipTolerantXhr } from './gzip-xhr';
import type { Token } from './ruby';

let dictBase = './dict/';
let engine: Promise<{ kuro: Kuroshiro; analyzer: Analyzer }> | undefined;

interface Analyzer {
  init(): Promise<void>;
  parse(s: string): Promise<Token[]>;
}

/**
 * kuroshiro's analyzer interface over kuromoji. kuroshiro-analyzer-kuromoji itself breaks in the browser
 * under Vite (its zlibjs dependency needs a non-strict `this`), so in the browser we use kuromoji's own
 * prebuilt UMD, which has zlib inside; node keeps the regular entry (reads the dictionary from disk).
 */
async function createAnalyzer(dicPath: string): Promise<Analyzer> {
  const inNode = !!(globalThis as any).process?.versions?.node;
  const kuromoji = (await (inNode ? import('kuromoji') : import('kuromoji/build/kuromoji.js'))).default;
  let tokenizer: { tokenize(s: string): Token[] };
  return {
    init: () => {
      const build = () =>
        new Promise<void>((resolve, reject) =>
          kuromoji.builder({ dicPath }).build((err, t) => {
            if (err) return reject(err);
            tokenizer = t;
            resolve();
          }),
        );
      return inNode ? build() : withGzipTolerantXhr(new URL(dicPath, location.href).href, build);
    },
    parse: async (s) => tokenizer.tokenize(s),
  };
}

/** Where the kuromoji dictionary lives (URL in the browser, folder in node). Call before the first use. */
export function setDictBase(base: string): void {
  dictBase = base.endsWith('/') ? base : `${base}/`;
  engine = undefined;
}
export const getDictBase = () => dictBase;

function load() {
  engine ??= (async () => {
    const analyzer = await createAnalyzer(dictBase);
    const kuro = new Kuroshiro();
    await kuro.init(analyzer);
    return { kuro, analyzer };
  })().catch((e) => {
    engine = undefined; // allow a retry after a network failure
    throw e;
  });
  return engine;
}

export const preloadJapanese = async (): Promise<void> => void (await load());

export async function tokenize(text: string): Promise<Token[]> {
  return text ? (await load()).analyzer.parse(text) : [];
}

export async function readings(text: string): Promise<{ reading: string; romaji: string }> {
  const { kuro } = await load();
  return {
    reading: await kuro.convert(text, { to: 'hiragana' }),
    romaji: await kuro.convert(text, { to: 'romaji', romajiSystem: 'hepburn' }),
  };
}
