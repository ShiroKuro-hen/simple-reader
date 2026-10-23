// Page count and cover of a comic archive (.cbz is a zip, .cbr a rar, both of page images), read from its container.
import { openComicArchive } from '../reader/comic-archive';
import { sortPageNames } from '../reader/manga-nav';
import { loadUnrarWasm } from '../reader/rar-wasm';

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

/** Throws if `blob` is not a zip or rar, or holds no page images. */
export async function readCbzInfo(blob: Blob): Promise<CbzInfo> {
  const archive = await openComicArchive(blob, { wasm: loadUnrarWasm });
  try {
    const pages = sortPageNames(archive.names);
    if (pages.length === 0) throw new Error('no pages: the archive holds no images');
    return { cover: await archive.read(pages[0]!), pages: pages.length };
  } finally {
    await archive.close();
  }
}
