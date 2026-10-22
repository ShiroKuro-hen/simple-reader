// The two kuroshiro packages ship no types.
declare module 'kuroshiro' {
  export default class Kuroshiro {
    static Util: { kanaToRomaji(s: string, system?: string): string; hasKanji(s: string): boolean };
    init(analyzer: unknown): Promise<void>;
    convert(
      s: string,
      o?: { to?: 'hiragana' | 'katakana' | 'romaji'; mode?: 'normal' | 'spaced' | 'okurigana' | 'furigana'; romajiSystem?: string },
    ): Promise<string>;
  }
}
declare module 'kuromoji' {
  import type { KuromojiToken } from 'kuromoji-token';
  const kuromoji: {
    builder(o: { dicPath: string }): { build(cb: (err: Error | null, tokenizer: { tokenize(s: string): KuromojiToken[] }) => void): void };
  };
  export default kuromoji;
}
declare module 'kuromoji/build/kuromoji.js' {
  import kuromoji from 'kuromoji';
  export default kuromoji;
}
declare module 'kuromoji-token' {
  export interface KuromojiToken {
    surface_form: string;
    basic_form: string;
    pos: string;
    pos_detail_1?: string;
    reading?: string;
    pronunciation?: string;
  }
}
