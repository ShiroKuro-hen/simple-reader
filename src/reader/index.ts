import type { BookFormat, OpenBookOptions, ReaderHandle } from '../types';

/** EPUB goes through foliate-js, PDF through pdf.js, comics (cbz) through manga.ts; each engine is loaded only when needed. */
export async function openBook(
  blob: Blob,
  format: BookFormat,
  container: HTMLElement,
  opts: OpenBookOptions,
): Promise<ReaderHandle> {
  if (format === 'pdf') return (await import('./pdf')).openPdf(blob, container, opts);
  if (format === 'cbz') return (await import('./manga')).openCbz(blob, container, opts);
  return (await import('./epub')).openEpub(blob, container, opts);
}
