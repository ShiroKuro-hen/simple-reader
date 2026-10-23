// Comic archives: a .cbz is a ZIP and a .cbr is a RAR, but file names lie, so the container is sniffed from the bytes.
// ZIP reads through the vendored foliate zip reader; RAR is loaded only when a RAR file is actually opened.
import { IMAGE_TYPE } from '../storage/cbz-info';
import { BlobReader, BlobWriter, ZipReader, configure } from '../vendor/foliate-js/vendor/zip.js';

export type ArchiveKind = 'zip' | 'rar';

export interface ComicArchive {
  kind: ArchiveKind;
  /** Every file entry (directories excluded), in archive order. Callers pick and sort the pages. */
  names: string[];
  read(name: string): Promise<Blob>;
  close(): Promise<void>;
}

const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04], // local file header
  [0x50, 0x4b, 0x05, 0x06], // empty archive
  [0x50, 0x4b, 0x07, 0x08], // spanned archive
];
const RAR4 = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00];
const RAR5 = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00];

const startsWith = (head: Uint8Array, signature: number[]) => signature.every((b, i) => head[i] === b);

/** The container, from the first bytes of a file. A short head simply matches no signature. */
export function sniffArchive(head: Uint8Array): ArchiveKind | null {
  if (ZIP_SIGNATURES.some((s) => startsWith(head, s))) return 'zip';
  if (startsWith(head, RAR4) || startsWith(head, RAR5)) return 'rar';
  return null;
}

const typeOf = (name: string) => IMAGE_TYPE[name.split('.').pop()!.toLowerCase()];

/** `wasm` supplies the RAR decoder's wasm bytes; it is called only when the file is a RAR. */
export async function openComicArchive(blob: Blob, opts: { wasm?: () => Promise<ArrayBuffer | undefined> } = {}): Promise<ComicArchive> {
  const kind = sniffArchive(new Uint8Array(await blob.slice(0, 8).arrayBuffer()));
  if (kind === 'zip') return openZip(blob);
  if (kind === 'rar') return openRar(blob, opts.wasm);
  throw new Error('Not a ZIP or RAR archive');
}

async function openZip(blob: Blob): Promise<ComicArchive> {
  configure({ useWebWorkers: false });
  const reader = new ZipReader(new BlobReader(blob));
  const entries = new Map<string, any>();
  for (const e of (await reader.getEntries()) as any[]) if (!e.directory) entries.set(e.filename as string, e);
  let open = true;
  return {
    kind: 'zip',
    names: [...entries.keys()],
    async read(name) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`No entry named ${name}`);
      return entry.getData(new BlobWriter(typeOf(name)));
    },
    async close() {
      if (!open) return;
      open = false;
      entries.clear();
      await reader.close();
    },
  };
}

async function openRar(blob: Blob, wasm?: () => Promise<ArrayBuffer | undefined>): Promise<ComicArchive> {
  const { createExtractorFromData } = await import('node-unrar-js');
  const wasmBinary = await wasm?.();
  let names: string[];
  // Names are listed with '/'; the name as stored is what the decoder looks entries up by.
  const stored = new Map<string, string>();
  let extractor: Awaited<ReturnType<typeof createExtractorFromData>> | null = null;
  try {
    extractor = await createExtractorFromData({ data: await blob.arrayBuffer(), wasmBinary });
    // The listing is a generator; it must run to the end or the decoder's memory is never freed.
    names = [...extractor.getFileList().fileHeaders]
      .filter((h) => !h.flags.directory)
      .map((h) => {
        // WinRAR on Windows can store '\' in paths; the page sorting and image filter need '/'.
        const name = h.name.replaceAll('\\', '/');
        stored.set(name, h.name);
        return name;
      });
  } catch (e) {
    throw unreadable(e);
  }
  return {
    kind: 'rar',
    names,
    async read(name) {
      if (!extractor) throw new Error('The archive is closed');
      const original = stored.get(name) ?? name;
      try {
        // Only this one entry is decoded; the other files of the archive stay compressed.
        const [found] = [...extractor.extract({ files: [original] }).files].filter((f) => f.fileHeader.name === original);
        if (!found?.extraction) throw new Error(`No entry named ${name}`);
        return new Blob([found.extraction as Uint8Array<ArrayBuffer>], { type: typeOf(name) }); // the decoder allocates a fresh buffer per file
      } catch (e) {
        throw e instanceof Error && e.message.startsWith('No entry') ? e : unreadable(e);
      }
    },
    async close() {
      extractor = null; // the decoder and the archive bytes become garbage
    },
  };
}

/** The library's own wording for a RAR the decoder refuses; the decoder's reason codes stay out of the message. */
function unreadable(e: unknown): Error {
  const reason = (e as { reason?: string } | null)?.reason;
  if (reason === 'ERAR_MISSING_PASSWORD' || reason === 'ERAR_BAD_PASSWORD') {
    return new Error('RAR archive is password-protected, which is not supported');
  }
  const message = e instanceof Error ? e.message : String(e);
  return new Error(`RAR archive could not be read: ${message}`);
}
