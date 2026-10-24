import { describe, expect, it } from 'vitest';
import { fixtureFile } from '../reader/fixtures/load';
import { extractText, xhtmlText } from './book-text';

describe('xhtmlText', () => {
  it('keeps the words, collapses whitespace and drops the head, scripts, styles and comments', () => {
    const xml = `<?xml version="1.0"?><html><head><title>Ignored</title><style>p {}</style></head><body>
      <!-- a note -->
      <p>Hello   <em>big</em>
        world &amp; &#8220;co&#8221;.</p><script>var x = 1 &lt;</script></body></html>`;
    expect(xhtmlText(xml)).toBe('Hello big world & “co”.');
  });
});

describe('extractText', () => {
  it('reads every document of an EPUB in reading order', async () => {
    const text = await extractText(fixtureFile('book-en.epub'), 'epub');
    expect(text).toContain('A storm arrived without warning.');
    expect(text.indexOf('The lighthouse keeper')).toBeLessThan(text.indexOf('A storm arrived'));
    expect(text.indexOf('A storm arrived')).toBeLessThan(text.indexOf('By morning the water'));
  });

  it('reads Japanese text in an EPUB', async () => {
    expect(await extractText(fixtureFile('book-ja.epub'), 'epub')).toContain('吾輩は猫である');
  });

  it('reads the text of a PDF, page by page', async () => {
    expect(await extractText(fixtureFile('sample.pdf'), 'pdf')).toContain('harbour');
  });

  it('refuses a damaged EPUB or PDF with an error instead of an empty text', async () => {
    await expect(extractText(fixtureFile('corrupt.epub'), 'epub')).rejects.toThrow();
    await expect(extractText(fixtureFile('corrupt.pdf'), 'pdf')).rejects.toThrow();
  });
});
