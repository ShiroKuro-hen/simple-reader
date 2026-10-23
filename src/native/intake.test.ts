import { describe, expect, it } from 'vitest';
import { bookFileName, planIncoming } from './intake';

const EPUB = 'application/epub+zip';
const OCTET = 'application/octet-stream';
const CBZ = 'application/vnd.comicbook+zip';

describe('bookFileName', () => {
  it.each([
    ['book.epub', EPUB, 'book.epub'],
    ['Lord of the Mysteries Vol 1.EPUB', OCTET, 'Lord of the Mysteries Vol 1.EPUB'], // the extension is enough, whatever the MIME type
    ['scan.pdf', null, 'scan.pdf'],
    ['document (3)', EPUB, 'document (3).epub'], // a content provider that hides the extension
    ['paper', 'application/pdf; charset=binary', 'paper.pdf'],
    ['dir/sub\\evil.epub', OCTET, 'evil.epub'], // never a path
    [null, 'application/pdf', 'book.pdf'],
    ['', EPUB, 'book.epub'],
    ['photo.jpg', 'image/jpeg', null],
    ['data.bin', OCTET, null], // octet-stream without a book extension is not claimed
    ['archive.zip', 'application/zip', null],
    ['book.epub.txt', 'text/plain', null],
    ['noext', null, null],
    ['Vol 1.cbz', OCTET, 'Vol 1.cbz'], // cbz extension, whatever the MIME type
    ['issue', CBZ, 'issue.cbz'],
    ['issue', 'application/x-cbz', 'issue.cbz'], // the older MIME name maps to cbz too
    ['issue (2)', OCTET, null], // octet-stream without the extension is not claimed
    ['Vol 3.cbr', OCTET, 'Vol 3.cbr'], // cbr extension is a comic too
    ['issue', 'application/vnd.comicbook-rar', 'issue.cbz'],
    ['issue', 'application/x-cbr', 'issue.cbz'],
  ])('%j + %j -> %j', (name, mime, expected) => {
    expect(bookFileName(name, mime)).toBe(expected);
  });
});

describe('planIncoming', () => {
  it('splits a share of mixed files into the books to import and the ids to discard', () => {
    const plan = planIncoming([
      { id: 1, name: 'a.epub', mime: EPUB },
      { id: 2, name: 'cat.png', mime: 'image/png' },
      { id: 3, name: 'b', mime: 'application/pdf' },
      { id: 4, name: 'c.pdf', mime: OCTET },
    ]);
    expect(plan.take).toEqual([
      { id: 1, fileName: 'a.epub', type: EPUB },
      { id: 3, fileName: 'b.pdf', type: 'application/pdf' },
      { id: 4, fileName: 'c.pdf', type: 'application/pdf' },
    ]);
    expect(plan.skipped).toEqual([2]);
  });

  it('plans a comic sent as the older cbz MIME type with the canonical type back', () => {
    expect(planIncoming([{ id: 7, name: 'Vol 2', mime: 'application/x-cbz' }]).take).toEqual([
      { id: 7, fileName: 'Vol 2.cbz', type: CBZ },
    ]);
  });

  it('plans a RAR comic under its own name, with the canonical cbz type', () => {
    expect(planIncoming([{ id: 9, name: 'Vol 3.cbr', mime: OCTET }]).take).toEqual([
      { id: 9, fileName: 'Vol 3.cbr', type: CBZ },
    ]);
  });

  it('plans nothing for nothing', () => {
    expect(planIncoming([])).toEqual({ take: [], skipped: [] });
  });
});
