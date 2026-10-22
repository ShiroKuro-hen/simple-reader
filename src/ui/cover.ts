/** Stable 0..359 hue from a title, for placeholder covers. */
export function titleHue(title: string): number {
  let n = 7;
  for (const ch of title) n = (n * 31 + ch.codePointAt(0)!) % 360;
  return n;
}

/** First visible character of the title (a whole code point, so emoji and kanji survive). */
export const coverInitial = (title: string): string => [...title.trim()][0]?.toUpperCase() ?? '?';
