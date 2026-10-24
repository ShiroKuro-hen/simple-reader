import { pageOfLocation } from './pdf-highlights';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const fractionOfPage = (page: number, total: number) => page / total;

export const pageFromFraction = (fraction: number, total: number) => clamp(Math.round(fraction * total), 1, total);

/** A saved location back to a page: a page number, or a highlight's page. Anything else (e.g. an EPUB CFI) means page 1. */
export function parsePage(location: string | undefined, total: number): number {
  const page = pageOfLocation(location);
  return page === undefined ? 1 : clamp(page, 1, total);
}
