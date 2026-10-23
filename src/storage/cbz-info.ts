// Page count and cover of a comic archive (.cbz is a zip of page images), read straight from its zip.
import { sortPageNames } from '../reader/manga-nav';
import { BlobReader, BlobWriter, ZipReader, configure } from '../vendor/foliate-js/vendor/zip.js';

export interface CbzInfo {
  cover?: Blob;
  pages: number;
}

export const IMAGE_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

/** Throws if `blob` is not a zip, or holds no page images. */
export async function readCbzInfo(blob: Blob): Promise<CbzInfo> {
  configure({ useWebWorkers: false });
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const entries = new Map((await reader.getEntries()).map((e: any) => [e.filename as string, e]));
    const pages = sortPageNames([...entries.keys()]);
    if (pages.length === 0) throw new Error('no pages: the archive holds no images');
    const first = pages[0]!;
    const ext = first.split('.').pop()!.toLowerCase();
    const cover = await entries.get(first)!.getData(new BlobWriter(IMAGE_TYPE[ext]));
    return { cover, pages: pages.length };
  } finally {
    await reader.close();
  }
}
