import { EPUB } from '../vendor/foliate-js/epub.js';
import { configure, ZipReader, BlobReader, TextWriter, BlobWriter } from '../vendor/foliate-js/vendor/zip.js';

/** Unzips an EPUB and builds foliate's book object (metadata, toc, sections, getCover). */
export async function loadEpub(blob: Blob): Promise<any> {
  configure({ useWebWorkers: false });
  const entries = await new ZipReader(new BlobReader(blob)).getEntries();
  const map = new Map<string, any>(entries.map((e: any) => [e.filename, e]));
  const loader = {
    loadText: (name: string) => (map.has(name) ? map.get(name).getData(new TextWriter()) : null),
    loadBlob: (name: string, type?: string) => (map.has(name) ? map.get(name).getData(new BlobWriter(type)) : null),
    getSize: (name: string) => map.get(name)?.uncompressedSize ?? 0,
  };
  // @ts-expect-error foliate's constructor also wants an optional sha1 we do not need
  return new EPUB(loader).init();
}
