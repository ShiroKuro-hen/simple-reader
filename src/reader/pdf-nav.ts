// PDF location rules: the location string is the 1-based page number.
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const fractionOfPage = (page: number, total: number) => page / total;

export const pageFromFraction = (fraction: number, total: number) => clamp(Math.round(fraction * total), 1, total);

/** A saved location back to a page; anything that is not a page number (e.g. an EPUB CFI) means page 1. */
export function parsePage(location: string | undefined, total: number): number {
  return /^\d+$/.test(location ?? '') ? clamp(parseInt(location!, 10), 1, total) : 1;
}
