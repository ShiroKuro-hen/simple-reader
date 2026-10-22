// Title, author and cover of an EPUB, read straight from its zip and package document.
// Regex-level XML on purpose: it must run without a DOM (node tests, workers), and we only
// need a handful of well-known elements.
import { BlobReader, BlobWriter, TextWriter, ZipReader, configure } from '../vendor/foliate-js/vendor/zip.js';

export interface OpfInfo {
  title?: string;
  author?: string;
  coverPath?: string;
  coverType?: string;
}

export interface EpubInfo {
  title?: string;
  author?: string;
  cover?: Blob;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(?:#x([0-9a-f]+)|#(\d+)|(\w+));/gi, (m, hex, dec, name) =>
      hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(+dec) : (ENTITIES[name] ?? m),
    )
    .trim();

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]!.toLowerCase()] = decode(m[2] ?? m[3] ?? '');
  return out;
}

const texts = (xml: string, name: string) =>
  [...xml.matchAll(new RegExp(`<(?:dc:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:dc:)?${name}>`, 'gi'))].map((m) => decode(m[1]!)).filter(Boolean);

/** Resolves `href` (relative, maybe percent-encoded, maybe with ../) against the folder of `basePath`. */
function resolvePath(basePath: string, href: string): string {
  const parts = basePath.split('/').slice(0, -1);
  for (const seg of decodeURI(href.split('#')[0]!).split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

export function parseContainer(xml: string): string | null {
  const root = [...xml.matchAll(/<rootfile\b[^>]*>/gi)].map((m) => attrs(m[0])).find((a) => a['full-path']);
  return root?.['full-path'] ?? null;
}

export function parseOpf(xml: string, opfPath: string): OpfInfo {
  const items = [...xml.matchAll(/<item\b[^>]*>/gi)].map((m) => attrs(m[0]));
  // EPUB3 marks the cover item itself; EPUB2 points at it from <meta name="cover" content="id">.
  const metaCoverId = [...xml.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0])).find((a) => a.name === 'cover')?.content;
  const cover =
    items.find((i) => i.properties?.split(/\s+/).includes('cover-image')) ?? items.find((i) => metaCoverId && i.id === metaCoverId);
  const creators = texts(xml, 'creator');
  return {
    title: texts(xml, 'title')[0],
    author: creators.length ? creators.join(', ') : undefined,
    coverPath: cover?.href ? resolvePath(opfPath, cover.href) : undefined,
    coverType: cover?.['media-type'],
  };
}

/** Throws if `file` is not a readable EPUB (not a zip, no container.xml, no package document). */
export async function readEpubInfo(file: Blob): Promise<EpubInfo> {
  configure({ useWebWorkers: false });
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = new Map((await reader.getEntries()).map((e: any) => [e.filename as string, e]));
    const text = async (name: string): Promise<string | null> => {
      const entry = entries.get(name);
      return entry ? entry.getData(new TextWriter()) : null;
    };
    const container = await text('META-INF/container.xml');
    const opfPath = container && parseContainer(container);
    if (!opfPath) throw new Error('no container.xml / rootfile');
    const opf = await text(opfPath);
    if (!opf) throw new Error(`missing package document ${opfPath}`);

    const info = parseOpf(opf, opfPath);
    const coverEntry = info.coverPath ? entries.get(info.coverPath) : undefined;
    const cover = coverEntry ? await coverEntry.getData(new BlobWriter(info.coverType)) : undefined;
    return { title: info.title, author: info.author, cover };
  } finally {
    await reader.close();
  }
}
