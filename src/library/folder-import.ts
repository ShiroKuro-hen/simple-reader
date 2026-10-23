// Adding a whole folder: which files of a picked directory are books, in what order, and what the series is called.
// Pure, no DOM. Paths are the `webkitRelativePath` strings a directory <input> gives ("Root/sub/file.ext").
import type { BookFormat } from '../types';
import { formatOf } from '../storage/domain';

export type FolderBook = { index: number; path: string; format: BookFormat };
export type FolderPlan = { folder: string; books: FolderBook[]; counts: Record<BookFormat, number>; ignored: number };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** macOS zip and Finder metadata: a `__MACOSX` folder or any dotfile (`._Vol 1.cbz`, `.DS_Store`). The picked root itself is never junk. */
const isJunk = (segments: string[]) => segments.slice(1).some((s) => s === '__MACOSX' || s.startsWith('.'));

export function planFolderImport(paths: string[]): FolderPlan {
  const folder = paths[0]?.split('/')[0] ?? '';
  const counts: Record<BookFormat, number> = { epub: 0, pdf: 0, cbz: 0 };
  const candidates: FolderBook[] = [];
  paths.forEach((path, index) => {
    const segments = path.split('/');
    const format = formatOf(segments[segments.length - 1] ?? '');
    if (!format || isJunk(segments)) return;
    candidates.push({ index, path, format });
  });
  candidates.sort((a, b) => collator.compare(a.path, b.path));
  for (const book of candidates) counts[book.format]++;
  return { folder, books: candidates, counts, ignored: paths.length - candidates.length };
}

/** The books of the selected formats, in the plan's order. */
export function chooseFormats(plan: FolderPlan, formats: ReadonlySet<BookFormat>): FolderBook[] {
  return plan.books.filter((b) => formats.has(b.format));
}

/** The series name: what the user typed, else the folder name; undefined when both are blank. */
export function seriesNameFor(raw: string, folder: string): string | undefined {
  return raw.trim() || folder.trim() || undefined;
}
