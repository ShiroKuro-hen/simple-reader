import { readAnnotationFile } from '../annotations/model';
import type { AnnotationFile, BookFormat, BookMeta, Progress, ReaderSettings, Storage } from '../types';
import { formatOf, mergeSettings, newestFirst, sha256Hex, titleFromFilename } from './domain';
import { readCbzInfo } from './cbz-info';
import { readEpubInfo } from './epub-info';
import { storage } from './index';
import { coverDataUrl, readPdfInfo } from './meta';

export { DEFAULT_SETTINGS } from './domain';

const MIME = { epub: 'application/epub+zip', pdf: 'application/pdf', cbz: 'application/vnd.comicbook+zip' };

type Found = { title?: string; author?: string; cover?: string };

/** `clock` is injectable so ordering can be tested without sleeping. */
export function createLibrary(fs: Storage, clock: () => number = Date.now) {
  const readJson = async <T>(path: string): Promise<T | null> => {
    const data = await fs.read(path);
    if (!data) return null;
    try {
      return JSON.parse(new TextDecoder().decode(data)) as T;
    } catch {
      return null; // a damaged file reads as missing rather than breaking the whole library
    }
  };
  const writeJson = (path: string, value: unknown) => fs.write(path, JSON.stringify(value));
  const getMeta = (id: string) => readJson<BookMeta>(`meta/${id}.json`);

  async function inspect(blob: Blob, format: BookFormat): Promise<Found> {
    if (format === 'pdf') return readPdfInfo(blob).catch(() => ({})); // the reader reports an unreadable PDF on open
    if (format === 'cbz') {
      let pages;
      try {
        pages = await readCbzInfo(blob);
      } catch (e) {
        throw new Error(`Not a valid CBZ file (${(e as Error).message})`);
      }
      const cover = pages.cover ? await coverDataUrl(pages.cover).catch(() => undefined) : undefined;
      return { cover };
    }
    let info;
    try {
      info = await readEpubInfo(blob);
    } catch (e) {
      throw new Error(`Not a valid EPUB file (${(e as Error).message})`);
    }
    const cover = info.cover ? await coverDataUrl(info.cover).catch(() => undefined) : undefined;
    return { title: info.title, author: info.author, cover };
  }

  async function addBook(file: File): Promise<BookMeta> {
    const format = formatOf(file.name);
    if (!format) throw new Error(`Unsupported file type: ${file.name}`);
    if (file.size === 0) throw new Error(`The file is empty: ${file.name}`);
    const buf = await file.arrayBuffer();
    const id = await sha256Hex(buf);
    const existing = await getMeta(id);
    if (existing) return existing;

    const found = await inspect(new Blob([buf]), format);
    const meta: BookMeta = {
      id,
      title: found.title || titleFromFilename(file.name),
      author: found.author,
      format,
      size: buf.byteLength,
      addedAt: clock(),
      cover: found.cover,
    };
    await fs.write(`books/${id}.${format}`, new Uint8Array(buf));
    await writeJson(`meta/${id}.json`, meta);
    return meta;
  }

  async function listBooks(): Promise<BookMeta[]> {
    const metas = await Promise.all((await fs.list('meta/')).map((p) => readJson<BookMeta>(p)));
    return newestFirst(metas.filter((m): m is BookMeta => !!m && typeof m.id === 'string'));
  }

  async function getBookBlob(id: string): Promise<Blob> {
    const meta = await getMeta(id);
    if (!meta) throw new Error(`Unknown book: ${id}`);
    const data = await fs.read(`books/${id}.${meta.format}`);
    if (!data) throw new Error(`Book file missing: ${id}`);
    return new Blob([data as BlobPart], { type: MIME[meta.format] });
  }

  async function removeBook(id: string): Promise<void> {
    await Promise.all([
      fs.remove(`books/${id}.epub`),
      fs.remove(`books/${id}.pdf`),
      fs.remove(`books/${id}.cbz`),
      fs.remove(`meta/${id}.json`),
      fs.remove(`progress/${id}.json`),
      fs.remove(`annotations/${id}.json`),
    ]);
  }

  return {
    addBook,
    listBooks,
    getBookBlob,
    removeBook,
    saveProgress: (p: Progress) => writeJson(`progress/${p.bookId}.json`, p),
    getProgress: (bookId: string) => readJson<Progress>(`progress/${bookId}.json`),
    /** Highlights, notes and bookmarks of one book (tombstones included); a damaged file reads as empty. */
    getAnnotations: async (bookId: string) => readAnnotationFile(await readJson<unknown>(`annotations/${bookId}.json`), bookId),
    saveAnnotations: (file: AnnotationFile) => writeJson(`annotations/${file.bookId}.json`, file),
    saveSettings: (s: ReaderSettings) => writeJson('settings.json', s),
    async getSettings(): Promise<ReaderSettings> {
      return mergeSettings(await readJson<unknown>('settings.json'));
    },
  };
}

export const { addBook, listBooks, getBookBlob, removeBook, saveProgress, getProgress, getAnnotations, saveAnnotations, saveSettings, getSettings } =
  createLibrary(storage);

import { cleanTags } from '../library/tags';

/** Replaces a book's tags (cleaned) and stamps `updatedAt`, so sync keeps the newest edit. `fs` and `clock` are injectable for tests. */
export async function setTags(id: string, tags: string[], fs: Storage = storage, clock: () => number = Date.now): Promise<BookMeta> {
  const data = await fs.read(`meta/${id}.json`);
  if (!data) throw new Error(`Unknown book: ${id}`);
  const meta: BookMeta = { ...JSON.parse(new TextDecoder().decode(data)), tags: cleanTags(tags), updatedAt: clock() };
  await fs.write(`meta/${id}.json`, JSON.stringify(meta));
  return meta;
}
