// Adding a whole folder: which files of a picked directory are books or page images, in what order, what the series is
// called, and how a folder of page images becomes a comic. Pure, no DOM.
// Paths are the `webkitRelativePath` strings a directory <input> gives ("Root/sub/file.ext").
import type { BookFormat } from '../types';
import { isImageName } from '../reader/manga-nav';
import { formatOf } from '../storage/domain';
import { storeZip } from '../storage/store-zip';

export type FolderBook = { index: number; path: string; format: BookFormat };
/** A directory of page images, to be packed into one comic. `pages` are input indexes, in reading order. */
export type ImageVolume = { name: string; pages: { index: number; path: string }[] };
export type FolderPlan = { folder: string; books: FolderBook[]; counts: Record<BookFormat, number>; ignored: number; volumes: ImageVolume[] };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** macOS zip and Finder metadata: a `__MACOSX` folder or any dotfile (`._Vol 1.cbz`, `.DS_Store`). The picked root itself is never junk. */
const isJunk = (segments: string[]) => segments.slice(1).some((s) => s === '__MACOSX' || s.startsWith('.'));

export function planFolderImport(paths: string[]): FolderPlan {
  const folder = paths[0]?.split('/')[0] ?? '';
  const counts: Record<BookFormat, number> = { epub: 0, pdf: 0, cbz: 0 };
  const candidates: FolderBook[] = [];
  const dirs = new Map<string, ImageVolume['pages']>(); // directory path -> its page images
  let images = 0;
  paths.forEach((path, index) => {
    const segments = path.split('/');
    const file = segments[segments.length - 1] ?? '';
    if (isJunk(segments)) return;
    const format = formatOf(file);
    if (format) {
      candidates.push({ index, path, format });
    } else if (isImageName(file)) {
      const dir = segments.slice(0, -1).join('/');
      const pages = dirs.get(dir) ?? [];
      pages.push({ index, path });
      dirs.set(dir, pages);
      images++;
    }
  });
  candidates.sort((a, b) => collator.compare(a.path, b.path));
  for (const book of candidates) counts[book.format]++;
  const volumes = [...dirs]
    .sort(([a], [b]) => collator.compare(a, b))
    .map(([dir, pages]) => ({ name: dir.split('/').pop() ?? '', pages: pages.sort((a, b) => collator.compare(a.path, b.path)) }));
  return { folder, books: candidates, counts, ignored: paths.length - candidates.length - images, volumes };
}

/** The books of the selected formats, in the plan's order. */
export function chooseFormats(plan: FolderPlan, formats: ReadonlySet<BookFormat>): FolderBook[] {
  return plan.books.filter((b) => formats.has(b.format));
}

/** The series name: what the user typed, else the folder name; undefined when both are blank. */
export function seriesNameFor(raw: string, folder: string): string | undefined {
  return raw.trim() || folder.trim() || undefined;
}

/** A page's entry name in a comic: its position zero padded so the names sort in reading order, and its own extension. */
export function pageName(position: number, total: number, path: string): string {
  const width = Math.max(4, String(total).length);
  return `${String(position).padStart(width, '0')}.${(path.split('.').pop() ?? '').toLowerCase()}`;
}

/** The volume as a store-only .cbz named after it. The same pages always give the same bytes, so re-adding does not duplicate. */
export async function packVolume(volume: ImageVolume, files: readonly File[]): Promise<File> {
  const entries: Record<string, Uint8Array> = {};
  for (const [i, page] of volume.pages.entries()) {
    entries[pageName(i + 1, volume.pages.length, page.path)] = new Uint8Array(await files[page.index]!.arrayBuffer());
  }
  return new File([storeZip(entries)], `${volume.name}.cbz`, { type: 'application/vnd.comicbook+zip' });
}
