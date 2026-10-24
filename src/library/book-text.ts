// The plain text of a book, for searching across the library. Storage caches the result (getBookText), so this runs once per book.
import { decode, parseSpine, withEpub } from '../storage/epub-info';
import type { BookFormat } from '../types';
import { pageText } from '../reader/pdf-search';
import { loadPdf } from '../reader/pdfjs';

/** The text of an EPUB (its documents in reading order) or a PDF (its pages). Throws if the file is damaged. */
export function extractText(blob: Blob, format: BookFormat): Promise<string> {
  if (format === 'epub') return epubText(blob);
  if (format === 'pdf') return pdfText(blob);
  return Promise.reject(new Error('Comics have no text to search'));
}

async function epubText(blob: Blob): Promise<string> {
  return withEpub(blob, async (pkg) => {
    const parts: string[] = [];
    for (const path of parseSpine(pkg.opf, pkg.opfPath)) {
      const xml = await pkg.text(path);
      if (xml !== null) parts.push(xhtmlText(xml));
    }
    return parts.join('\n');
  });
}

/**
 * The text of an XHTML document as its textContent gives it: head, scripts, styles and comments left out, whitespace
 * collapsed. EPUB documents are XML, so only the XML entities and numeric references can occur, and a regex reads them.
 * A DOM would do the same, but there is none in the node tests.
 */
export function xhtmlText(xml: string): string {
  const body = xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<head\b[\s\S]*?<\/head\s*>/gi, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '');
  return decode(body.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/** Pages in order, one per line; the items of a page are joined as the text layer joins them. */
async function pdfText(blob: Blob): Promise<string> {
  const task = loadPdf(new Uint8Array(await blob.arrayBuffer()));
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const { items } = await page.getTextContent();
      pages.push(pageText(items.map((i) => ('str' in i ? i.str : ''))));
      page.cleanup();
    }
    return pages.join('\n');
  } finally {
    await task.destroy(); // frees the document too
  }
}
