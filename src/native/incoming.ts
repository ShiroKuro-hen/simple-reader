// Android only (loaded lazily from main.ts inside Tauri). MainActivity queues the files of "Open with" / "Share"
// and exposes them as window.SRIntent; this module pulls the bytes in chunks and hands them to the library.
import { addBook } from '../storage/library';
import { toast } from '../ui/dom';
import { planIncoming, type Incoming } from './intake';
import { oneAtATime } from './one-at-a-time';

type Bridge = { list(): string; read(id: number, max: number): string | null; close(id: number): void; pickFolder(): void; takeFolder(): string };
/** A book inside a folder the user picked: `path` is "Folder/sub/file.ext", `id` is read with fetchFile. */
export type PickedFile = { id: number; path: string };
declare global {
  interface Window {
    SRIntent?: Bridge;
    __srIncoming?: () => void;
    __srFolder?: () => void;
  }
}

const CHUNK = 768 * 1024;

export async function fetchFile(b: Bridge, id: number, name: string, type: string): Promise<File> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  try {
    for (;;) {
      const b64 = b.read(id, CHUNK);
      if (b64 === null) throw new Error('could not read the shared file');
      if (!b64) break;
      parts.push(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      await new Promise((r) => setTimeout(r)); // let the UI breathe between chunks
    }
  } finally {
    b.close(id);
  }
  return new File(parts, name, { type });
}

export function listenForIncoming(showLibrary: () => void): void {
  const bridge = window.SRIntent;
  if (!bridge) return;
  async function importPending() {
    const items = JSON.parse(bridge!.list()) as Incoming[];
    if (!items.length) return;
    const plan = planIncoming(items);
    plan.skipped.forEach((id) => bridge!.close(id));
    if (plan.skipped.length) toast('Only EPUB, PDF, CBZ and CBR files are supported.', 'error');
    const names = new Map(items.map((i) => [i.id, i.name]));
    let added = 0;
    for (const t of plan.take) {
      try {
        await addBook(await fetchFile(bridge!, t.id, t.fileName, t.type));
        added++;
      } catch {
        toast(`Couldn't add "${names.get(t.id) ?? t.fileName}". The file may be damaged.`, 'error');
      }
    }
    if (added) toast(`Added ${added} book${added === 1 ? '' : 's'}`);
    showLibrary();
  }

  // One import at a time; a second intent that arrives meanwhile is picked up by the next round.
  window.__srIncoming = oneAtATime(importPending);
  window.__srIncoming(); // a cold start: the file arrived before this page did
}
