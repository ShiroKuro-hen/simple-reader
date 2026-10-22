// Pure rules for which text gets a reading: kanji only, okurigana stay outside the <ruby>.
import Kuroshiro from 'kuroshiro';
import type { KuromojiToken } from 'kuromoji-token';
import { HAS_KANJI } from './script';

export type Token = KuromojiToken;
export interface Segment {
  text: string;
  /** Hiragana. Absent = plain text, no annotation. */
  reading?: string;
}

const KANJI = new RegExp(HAS_KANJI.source);
const isKanji = (c: string) => KANJI.test(c);

export const kataToHira = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "食べ"+"たべ" -> [食 た][べ]. Falls back to one annotation over the whole word when the kana don't line up. */
function splitOkurigana(surface: string, reading: string): Segment[] {
  const parts: { text: string; kanji: boolean }[] = [];
  for (const c of surface) {
    const kanji = isKanji(c);
    const last = parts[parts.length - 1];
    if (last && last.kanji === kanji) last.text += c;
    else parts.push({ text: c, kanji });
  }
  const pattern = parts.map((p) => (p.kanji ? '(.+)' : escapeRe(kataToHira(p.text)))).join('');
  const m = new RegExp(`^${pattern}$`).exec(reading);
  if (!m) return [{ text: surface, reading }];
  let i = 1;
  return parts.map((p) => (p.kanji ? { text: p.text, reading: m[i++]! } : { text: p.text }));
}

/** Tokens -> runs of text, annotated only where a token contains kanji and has a reading. */
export function segment(tokens: Token[]): Segment[] {
  const out: Segment[] = [];
  for (const t of tokens) {
    const reading = t.reading && t.reading !== '*' ? kataToHira(t.reading) : undefined;
    for (const s of reading && HAS_KANJI.test(t.surface_form) ? splitOkurigana(t.surface_form, reading) : [{ text: t.surface_form }]) {
      const last = out[out.length - 1];
      if (last && !last.reading && !s.reading) last.text += s.text;
      else out.push(s);
    }
  }
  return out;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const toRomaji = (hiragana: string) => Kuroshiro.Util.kanaToRomaji(hiragana, 'hepburn');

export function rubyHtml(tokens: Token[], mode: 'furigana' | 'romaji'): string {
  return segment(tokens)
    .map((s) =>
      s.reading
        ? `<ruby>${escapeHtml(s.text)}<rt>${mode === 'romaji' ? toRomaji(s.reading) : s.reading}</rt></ruby>`
        : escapeHtml(s.text),
    )
    .join('');
}
