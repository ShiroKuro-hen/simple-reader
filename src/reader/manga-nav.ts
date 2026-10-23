// Manga page rules: a book is an ordered list of image pages, 1-based.
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;

/** Directories (trailing '/'), dotfiles, __MACOSX junk and non-image files are not pages. */
export function isImageName(name: string): boolean {
  if (name.endsWith('/')) return false;
  if (name.split('/').some((seg) => seg.startsWith('.') || seg === '__MACOSX')) return false;
  return IMAGE_EXT.test(name);
}

const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Keeps only page images, in natural order of their full path. filter() returns a new array, so the input is untouched. */
export function sortPageNames(names: string[]): string[] {
  return names.filter(isImageName).sort((a, b) => naturalOrder.compare(a, b));
}

/** Pages shown together when `page` is on screen. In double mode the cover (page 1) is alone and pairs are (2,3), (4,5)... */
export function spreadOf(page: number, total: number, double: boolean): number[] {
  if (total < 1) return [];
  const p = clamp(page, 1, total);
  if (!double || p === 1) return [p];
  const start = p % 2 === 0 ? p : p - 1;
  return start + 1 <= total ? [start, start + 1] : [start];
}

/** First page of the neighbouring spread; at either end, the first page of the current spread. */
export function stepPage(page: number, total: number, double: boolean, dir: 1 | -1): number {
  const spread = spreadOf(page, total, double);
  if (spread.length === 0) return 1;
  const [first = 1, last = first] = spread;
  if (dir === 1) return last >= total ? first : last + 1;
  if (first <= 1) return first;
  const [prevFirst = 1] = spreadOf(first - 1, total, double);
  return prevFirst;
}

/** Left-to-right on screen: a right-to-left book shows its spread reversed. */
export function displayOrder(spread: number[], rtl: boolean): number[] {
  return rtl ? [...spread].reverse() : [...spread];
}

/** Pages to hold decoded: the current spread, plus `ahead` pages after it and `behind` pages before it (counted in pages). */
export function pagesToKeep(page: number, total: number, double: boolean, ahead: number, behind: number): number[] {
  const spread = spreadOf(page, total, double);
  if (spread.length === 0) return [];
  const first = spread[0]!;
  const last = spread[spread.length - 1]!;
  const from = Math.max(1, first - behind);
  const to = Math.min(total, last + ahead);
  const pages: number[] = [];
  for (let p = from; p <= to; p++) pages.push(p);
  return pages;
}
