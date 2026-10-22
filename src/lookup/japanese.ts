// Offline part of a Japanese lookup: reading, romaji and the JMdict entry.
import { readings, tokenize } from './ja';
import { type Entry, type Jmdict, findEntry } from './jmdict';

export interface JapaneseLocal {
  reading: string;
  romaji: string;
  /** Dictionary form of the first word, when the selection is inflected or longer than a word. */
  lemma?: string;
  entry?: Entry;
}

export async function lookupJapaneseLocal(text: string, dict: Jmdict | undefined): Promise<JapaneseLocal> {
  const [{ reading, romaji }, tokens] = await Promise.all([readings(text), tokenize(text)]);
  const first = tokens[0];
  const lemma = first && first.basic_form !== '*' ? first.basic_form : first?.surface_form;
  // The dictionary form only stands for the selection when the rest is grammar (食べ|ま|し|た), not another word.
  const justOneWord = tokens.slice(1).every((t) => t.pos === '助動詞' || t.pos === '助詞' || t.pos_detail_1 === '非自立');
  const candidates = [{ form: text }, ...(justOneWord && lemma ? [{ form: lemma, reading: first?.reading }] : [])];
  const entry = dict && findEntry(dict, candidates);
  return { reading, romaji, lemma, entry };
}
