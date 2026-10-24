import { describe, expect, it } from 'vitest';
import { fixtureFile } from '../reader/fixtures/load';
import { parseContainer, parseOpf, parseSpine, readEpubInfo } from './epub-info';

describe('parseContainer', () => {
  it('finds the package document path', () => {
    const xml = `<container><rootfiles><rootfile media-type="application/oebps-package+xml" full-path="OPS/book.opf"/></rootfiles></container>`;
    expect(parseContainer(xml)).toBe('OPS/book.opf');
  });
  it('returns null when there is no rootfile', () => {
    expect(parseContainer('<container/>')).toBeNull();
  });
});

describe('parseOpf', () => {
  const opf = (meta: string, manifest = '') =>
    `<package><metadata xmlns:dc="x">${meta}</metadata><manifest>${manifest}</manifest></package>`;

  it('decodes entities and ignores attributes on dc elements', () => {
    const info = parseOpf(opf('<dc:title id="t1" xml:lang="en">Tom &amp; Jerry&#39;s &lt;Book&gt;</dc:title>'), 'content.opf');
    expect(info.title).toBe("Tom & Jerry's <Book>");
  });
  it('joins several creators', () => {
    const info = parseOpf(opf('<dc:title>T</dc:title><dc:creator>A</dc:creator><dc:creator opf:role="aut">B</dc:creator>'), 'x.opf');
    expect(info.author).toBe('A, B');
  });
  it('resolves an EPUB3 cover-image against the OPF folder', () => {
    const info = parseOpf(
      opf('<dc:title>T</dc:title>', '<item id="i" href="img/c.jpg" media-type="image/jpeg" properties="cover-image"/>'),
      'OEBPS/content.opf',
    );
    expect(info.coverPath).toBe('OEBPS/img/c.jpg');
  });
  it('follows the EPUB2 <meta name="cover"> pointer, whatever the attribute order', () => {
    const info = parseOpf(
      opf('<dc:title>T</dc:title><meta content="cov" name="cover"/>', '<item href="c.png" id="cov" media-type="image/png"/>'),
      'content.opf',
    );
    expect(info.coverPath).toBe('c.png');
  });
  it('reports no cover and no author when the book has none', () => {
    const info = parseOpf(opf('<dc:title>T</dc:title>', '<item id="c0" href="c0.xhtml" media-type="application/xhtml+xml"/>'), 'x.opf');
    expect(info.coverPath).toBeUndefined();
    expect(info.author).toBeUndefined();
  });
});

describe('parseSpine', () => {
  it('lists the reading documents in spine order, resolved against the OPF folder', () => {
    const opf = '<package><manifest><item id="b" href="c1.xhtml"/><item id="a" href="text/c%30.xhtml"/></manifest>' +
      '<spine><itemref idref="a"/><itemref idref="b"/></spine></package>';
    expect(parseSpine(opf, 'OEBPS/content.opf')).toEqual(['OEBPS/text/c0.xhtml', 'OEBPS/c1.xhtml']);
  });
  it('skips a spine item that the manifest does not list', () => {
    const opf = '<package><manifest><item id="a" href="a.xhtml"/></manifest><spine><itemref idref="x"/><itemref idref="a"/></spine></package>';
    expect(parseSpine(opf, 'content.opf')).toEqual(['a.xhtml']);
  });
});

describe('readEpubInfo on real files', () => {
  it('reads title, author and cover bytes of an English book', async () => {
    const info = await readEpubInfo(fixtureFile('book-en.epub'));
    expect(info.title).toBe('The Lighthouse & the Sea');
    expect(info.author).toBe('Ada Marlowe');
    const png = new Uint8Array(await info.cover!.arrayBuffer());
    expect([...png.slice(1, 4)]).toEqual([80, 78, 71]); // "PNG"
  });
  it('reads Japanese metadata, and a book without a cover has none', async () => {
    const info = await readEpubInfo(fixtureFile('book-ja.epub'));
    expect(info.title).toBe('吾輩は猫である');
    expect(info.author).toBe('夏目漱石');
    expect(info.cover).toBeUndefined();
  });
  it('rejects a truncated archive and an empty file', async () => {
    await expect(readEpubInfo(fixtureFile('corrupt.epub'))).rejects.toThrow();
    await expect(readEpubInfo(fixtureFile('empty.epub'))).rejects.toThrow();
  });
  it('rejects a zip that is not an EPUB', async () => {
    await expect(readEpubInfo(fixtureFile('sample.pdf'))).rejects.toThrow();
  });
});
