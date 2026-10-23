// Pure rules for books handed to the Android app by "Open with" / "Share": no bridge, no DOM.
import type { BookFormat } from '../types';
import { formatOf } from '../storage/domain';

/** What the Android side knows about one incoming stream (display name and MIME type as the sender gave them). */
export type Incoming = { id: number; name: string | null; mime: string | null };
export type Plan = { take: { id: number; fileName: string; type: string }[]; skipped: number[] };

const TYPE: Record<BookFormat, string> = { epub: 'application/epub+zip', pdf: 'application/pdf', cbz: 'application/vnd.comicbook+zip' };

const formatOfMime = (mime: string | null): BookFormat | null => {
  const m = (mime ?? '').split(';')[0]!.trim().toLowerCase();
  // application/x-cbz is the older name some senders still use for the same comic archive.
  return m === TYPE.epub ? 'epub' : m === TYPE.pdf ? 'pdf' : m === TYPE.cbz || m === 'application/x-cbz' ? 'cbz' : null;
};

/**
 * The file name to import under, or null when this is not a book. The extension wins; a book MIME type
 * rescues names without one (Downloads often hands over "document (3)"); octet-stream counts only with a book extension.
 */
export function bookFileName(name: string | null, mime: string | null): string | null {
  const base = (name ?? '').split(/[/\\]/).pop()!.trim() || 'book';
  if (formatOf(base)) return base;
  const format = formatOfMime(mime);
  return format ? `${base}.${format}` : null;
}

export function planIncoming(items: Incoming[]): Plan {
  const plan: Plan = { take: [], skipped: [] };
  for (const { id, name, mime } of items) {
    const fileName = bookFileName(name, mime);
    if (fileName) plan.take.push({ id, fileName, type: TYPE[formatOf(fileName)!] });
    else plan.skipped.push(id);
  }
  return plan;
}
