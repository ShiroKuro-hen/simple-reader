// Page driven by browser.test.ts (Playwright). Not part of the app bundle.
import { cacheGet, cacheSet } from '../cache';
import { applyFurigana, lookup, LookupError, setDictBase } from '../index';

setDictBase('/dict/');

/** Opens XHTML text in an iframe the way the EPUB renderer does (blob URL, application/xhtml+xml). */
async function openChapter(xhtml: string): Promise<Document> {
  const frame = document.getElementById('book') as HTMLIFrameElement;
  await new Promise<void>((resolve) => {
    frame.onload = () => resolve();
    frame.src = URL.createObjectURL(new Blob([xhtml], { type: 'application/xhtml+xml' }));
  });
  return frame.contentDocument!;
}

/** Same call lookup() callers use, but errors come back as data so the test can read the code. */
async function tryLookup(text: string, context?: string) {
  try {
    return { ok: await lookup(text, context) };
  } catch (e) {
    return { error: e instanceof LookupError ? { code: e.code, message: e.message } : String(e) };
  }
}

(window as any).sr = { openChapter, applyFurigana, lookup: tryLookup, cacheGet, cacheSet };
(window as any).srReady = true;
