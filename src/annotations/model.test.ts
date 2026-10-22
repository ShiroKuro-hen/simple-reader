import { describe, expect, it } from 'vitest';
import type { Annotation, AnnotationFile } from '../types';
import {
  bookmarkOn,
  createAnnotation,
  editAnnotation,
  listAnnotations,
  mergeAnnotationFiles,
  previewText,
  putAnnotation,
  readAnnotationFile,
  removeAnnotation,
  upsertMark,
} from './model';

const A = 'epubcfi(/6/4!/4/2,/1:0,/1:12)'; // chapter 1
const B = 'epubcfi(/6/4!/4/10,/1:5,/1:9)'; // later in chapter 1
const C = 'epubcfi(/6/10!/4/2,/1:0,/1:4)'; // spine index 10: after 4, and after 8 even though "10" < "8" as text
const CHAPTER_9 = 'epubcfi(/6/18!/4/2,/1:0,/1:4)';

const make = (over: Partial<Annotation> = {}): Annotation => ({
  id: 'a1', bookId: 'book', kind: 'highlight', location: A, text: 'the lighthouse keeper',
  color: 'yellow', createdAt: 1000, updatedAt: 1000, ...over,
});

describe('createAnnotation', () => {
  it('builds a highlight with fresh ids and the given time', () => {
    const a = createAnnotation({ bookId: 'book', kind: 'highlight', location: A, text: 'x' }, 5000);
    const b = createAnnotation({ bookId: 'book', kind: 'highlight', location: A, text: 'x' }, 5000);
    expect(a).toMatchObject({ bookId: 'book', kind: 'highlight', location: A, text: 'x', color: 'yellow', createdAt: 5000, updatedAt: 5000 });
    expect(a.id).toMatch(/^[0-9a-z-]{8,}$/);
    expect(a.id).not.toBe(b.id);
    expect(a).not.toHaveProperty('deleted');
  });

  it('turns a highlight created with a note into a note, and drops a blank note', () => {
    expect(createAnnotation({ bookId: 'b', kind: 'highlight', location: A, text: 'x', note: ' why? ' }, 1)).toMatchObject({ kind: 'note', note: 'why?' });
    const blank = createAnnotation({ bookId: 'b', kind: 'note', location: A, text: 'x', note: '  \n ' }, 1);
    expect(blank.kind).toBe('highlight');
    expect(blank).not.toHaveProperty('note');
  });

  it('refuses an unknown colour by falling back to yellow', () => {
    expect(createAnnotation({ bookId: 'b', kind: 'highlight', location: A, text: 'x', color: 'chartreuse' as any }, 1).color).toBe('yellow');
  });

  it('never gives a bookmark a note', () => {
    const bm = createAnnotation({ bookId: 'b', kind: 'bookmark', location: A, text: 'x', note: 'n' }, 1);
    expect(bm.kind).toBe('bookmark');
    expect(bm).not.toHaveProperty('note');
  });
});

describe('editAnnotation', () => {
  it('sets the note, which makes a highlight a note, and clearing it makes it a highlight again', () => {
    const withNote = editAnnotation(make(), { note: 'remember this' }, 2000);
    expect(withNote).toMatchObject({ kind: 'note', note: 'remember this', updatedAt: 2000, createdAt: 1000 });
    const cleared = editAnnotation(withNote, { note: '   ' }, 3000);
    expect(cleared.kind).toBe('highlight');
    expect(cleared).not.toHaveProperty('note');
  });

  it('changes the colour only to a valid one and leaves the input untouched', () => {
    const a = make();
    expect(editAnnotation(a, { color: 'pink' }, 2000).color).toBe('pink');
    expect(editAnnotation(a, { color: 'nope' as any }, 2000).color).toBe('yellow');
    expect(a.updatedAt).toBe(1000);
  });

  it('never moves updatedAt backwards, so an edit on a slow clock still beats the version it edited', () => {
    expect(editAnnotation(make({ updatedAt: 9000 }), { color: 'blue' }, 100).updatedAt).toBe(9001);
  });

  it('ignores a note on a bookmark', () => {
    expect(editAnnotation(make({ kind: 'bookmark' }), { note: 'n' }, 2000)).not.toHaveProperty('note');
  });
});

describe('removeAnnotation', () => {
  it('leaves a tombstone instead of deleting, and keeps the other items', () => {
    const items = [make({ id: 'a' }), make({ id: 'b' })];
    const out = removeAnnotation(items, 'a', 5000);
    expect(out).toHaveLength(2);
    expect(out.find((i) => i.id === 'a')).toMatchObject({ deleted: true, updatedAt: 5000 });
    expect(out.find((i) => i.id === 'b')).toEqual(items[1]);
    expect(items[0]).not.toHaveProperty('deleted');
  });

  it('ignores an unknown id, and removing twice keeps the first tombstone time', () => {
    const items = [make({ id: 'a' })];
    expect(removeAnnotation(items, 'zzz', 5000)).toEqual(items);
    const once = removeAnnotation(items, 'a', 5000);
    expect(removeAnnotation(once, 'a', 9000)).toEqual(once);
  });

  it('a tombstone made on a slow clock still beats the version it removed', () => {
    expect(removeAnnotation([make({ id: 'a', updatedAt: 9000 })], 'a', 100)[0]!.updatedAt).toBe(9001);
  });
});

describe('putAnnotation', () => {
  it('appends a new item and replaces one with the same id', () => {
    const one = putAnnotation([], make({ id: 'a' }));
    const two = putAnnotation(one, make({ id: 'b' }));
    const three = putAnnotation(two, make({ id: 'a', note: 'x', kind: 'note' }));
    expect(three.map((i) => i.id)).toEqual(['a', 'b']);
    expect(three[0]!.note).toBe('x');
  });
});

describe('listAnnotations', () => {
  it('hides tombstones and orders by position in the book, not by id or text', () => {
    const items = [
      make({ id: 'z', location: CHAPTER_9 }),
      make({ id: 'c', location: C }),
      make({ id: 'b', location: B }),
      make({ id: 'gone', location: A, deleted: true }),
      make({ id: 'a', location: A }),
    ];
    expect(listAnnotations(items).map((i) => i.id)).toEqual(['a', 'b', 'c', 'z']);
  });

  it('breaks position ties by creation time, then id', () => {
    const items = [
      make({ id: 'late', createdAt: 3000 }),
      make({ id: 'b', createdAt: 2000 }),
      make({ id: 'a', createdAt: 2000 }),
    ];
    expect(listAnnotations(items).map((i) => i.id)).toEqual(['a', 'b', 'late']);
  });

  it('orders PDF page numbers numerically, so page 10 follows page 9', () => {
    const items = ['10', '2', '9', '1'].map((p) => make({ id: `p${p}`, location: p, kind: 'bookmark' }));
    expect(listAnnotations(items).map((i) => i.location)).toEqual(['1', '2', '9', '10']);
  });

  it('survives a location it cannot parse', () => {
    const items = [make({ id: 'x', location: 'garbage' }), make({ id: 'a', location: A })];
    expect(listAnnotations(items)).toHaveLength(2);
  });

  it('can be limited to some kinds', () => {
    const items = [make({ id: 'h' }), make({ id: 'm', kind: 'bookmark' }), make({ id: 'n', kind: 'note', note: 'x' })];
    expect(listAnnotations(items, ['bookmark']).map((i) => i.id)).toEqual(['m']);
    expect(listAnnotations(items, ['highlight', 'note']).map((i) => i.id)).toEqual(['h', 'n']);
  });
});

describe('bookmarkOn', () => {
  const page = 'epubcfi(/6/4!/4,/2/1:0,/10/1:40)'; // the visible range: from the start of /4/2 to /4/10 offset 40
  const bm = (id: string, location: string, over: Partial<Annotation> = {}) => make({ id, kind: 'bookmark', location, ...over });

  it('finds a bookmark whose point lies inside the visible range', () => {
    expect(bookmarkOn([bm('in', 'epubcfi(/6/4!/4/6/1:3)')], page)?.id).toBe('in');
  });

  it('finds the bookmark made at the first position of the page, but not one at its end (that is the next page)', () => {
    expect(bookmarkOn([bm('start', 'epubcfi(/6/4!/4/2/1:0)')], page)?.id).toBe('start');
    expect(bookmarkOn([bm('end', 'epubcfi(/6/4!/4/10/1:40)')], page)).toBeUndefined();
  });

  it('does not find bookmarks on other pages or chapters, deleted ones, or highlights', () => {
    const others = [
      bm('before', 'epubcfi(/6/2!/4/2/1:0)'),
      bm('after', 'epubcfi(/6/4!/4/12/1:0)'),
      bm('chapter', 'epubcfi(/6/14!/4/6/1:3)'),
      bm('dead', 'epubcfi(/6/4!/4/6/1:3)', { deleted: true }),
      make({ id: 'hl', kind: 'highlight', location: 'epubcfi(/6/4!/4/6/1:3)' }),
    ];
    expect(bookmarkOn(others, page)).toBeUndefined();
  });

  it('matches PDF pages exactly', () => {
    const p3 = bm('p3', '3');
    expect(bookmarkOn([p3], '3')?.id).toBe('p3');
    expect(bookmarkOn([p3], '30')).toBeUndefined();
    expect(bookmarkOn([p3], '2')).toBeUndefined();
  });

  it('gives up quietly on a malformed page location', () => {
    expect(bookmarkOn([bm('x', A)], 'epubcfi(((')).toBeUndefined();
  });
});

describe('previewText', () => {
  it.each([
    ['  a   b\n\tc  ', 80, 'a b c'],
    ['', 80, ''],
    ['short', 80, 'short'],
    ['one two three four five', 15, 'one two three…'],
    ['abcdefghijklmnopqrstuvwxyz', 10, 'abcdefghi…'],
    ['日本語のとても長い文章がここにあります', 8, '日本語のとても…'],
  ])('%j (max %i) -> %j', (input, max, out) => {
    expect(previewText(input, max)).toBe(out);
  });

  it('never splits an emoji', () => {
    expect(previewText('😀😀😀😀😀😀', 4)).toBe('😀😀😀…');
  });
});

describe('mergeAnnotationFiles', () => {
  const file = (items: Annotation[], bookId = 'book'): AnnotationFile => ({ bookId, items });

  it('keeps items that exist on only one side', () => {
    const out = mergeAnnotationFiles(file([make({ id: 'a' })]), file([make({ id: 'b' })]));
    expect(out.items.map((i) => i.id).sort()).toEqual(['a', 'b']);
  });

  it('lets the newest updatedAt win, whichever side it is on', () => {
    const old = make({ note: 'old', kind: 'note', updatedAt: 2000 });
    const fresh = make({ note: 'new', kind: 'note', updatedAt: 3000 });
    expect(mergeAnnotationFiles(file([old]), file([fresh])).items[0]!.note).toBe('new');
    expect(mergeAnnotationFiles(file([fresh]), file([old])).items[0]!.note).toBe('new');
  });

  it('a newer tombstone beats an older edit, and a newer edit beats an older tombstone', () => {
    const edited = make({ color: 'pink', updatedAt: 2000 });
    const removed = make({ deleted: true, updatedAt: 3000 });
    expect(mergeAnnotationFiles(file([edited]), file([removed])).items[0]!.deleted).toBe(true);
    const restored = make({ color: 'blue', updatedAt: 4000 });
    const merged = mergeAnnotationFiles(file([removed]), file([restored])).items[0]!;
    expect(merged.color).toBe('blue');
    expect(merged).not.toHaveProperty('deleted');
  });

  it('keeps tombstones in the result so the deletion travels', () => {
    const out = mergeAnnotationFiles(file([make({ deleted: true, updatedAt: 9 })]), file([]));
    expect(out.items).toHaveLength(1);
  });

  it('is commutative, idempotent and associative, also on timestamp ties', () => {
    const a = file([make({ id: '1', note: 'A', kind: 'note', updatedAt: 5 }), make({ id: '2', updatedAt: 1 })]);
    const b = file([make({ id: '1', note: 'B', kind: 'note', updatedAt: 5 }), make({ id: '3', updatedAt: 1 })]);
    const c = file([make({ id: '1', deleted: true, updatedAt: 5 }), make({ id: '2', color: 'blue', updatedAt: 7 })]);
    const m = mergeAnnotationFiles;
    expect(m(a, b)).toEqual(m(b, a));
    expect(m(a, a)).toEqual(m(a, file([])));
    expect(m(m(a, b), c)).toEqual(m(a, m(b, c)));
    expect(m(m(a, b), c)).toEqual(m(c, m(b, a)));
  });

  it('does not mutate its inputs', () => {
    const a = file([make({ id: '1' })]);
    const snapshot = JSON.stringify(a);
    mergeAnnotationFiles(a, file([make({ id: '1', updatedAt: 9 })]));
    expect(JSON.stringify(a)).toBe(snapshot);
  });

  it('refuses to mix two different books', () => {
    expect(() => mergeAnnotationFiles(file([], 'x'), file([], 'y'))).toThrow(/different books/);
  });
});

describe('readAnnotationFile', () => {
  it.each([null, undefined, 42, 'text', [], {}, { items: 'no' }, { bookId: 'x', items: {} }])('%j reads as an empty file', (raw) => {
    expect(readAnnotationFile(raw, 'book')).toEqual({ bookId: 'book', items: [] });
  });

  it('keeps well-formed items and drops broken ones instead of failing the whole file', () => {
    const good = make({ id: 'ok' });
    const raw = { bookId: 'book', items: [good, null, 7, { id: 'x' }, { ...good, id: 'bad-kind', kind: 'doodle' }, { ...good, id: 'bad-time', updatedAt: 'yesterday' }] };
    expect(readAnnotationFile(raw, 'book').items).toEqual([good]);
  });

  it('keeps fields it does not know, so a newer app version loses nothing', () => {
    const future = { ...make({ id: 'f' }), rects: [[1, 2, 3, 4]] };
    expect(readAnnotationFile({ bookId: 'book', items: [future] }, 'book').items).toEqual([future]);
  });

  it('repairs an unknown colour and takes the book id from the caller, not from the file', () => {
    const out = readAnnotationFile({ bookId: 'other', items: [{ ...make({ bookId: 'other' }), color: 'teal' }] }, 'book');
    expect(out.bookId).toBe('book');
    expect(out.items[0]!.bookId).toBe('book');
    expect(out.items[0]!.color).toBe('yellow');
  });
});

describe('upsertMark', () => {
  const init = { bookId: 'book', kind: 'highlight' as const, location: A, text: 'the lighthouse keeper' };

  it('creates a highlight, or a note when the first thing the user gives is a note', () => {
    const h = upsertMark([], { ...init, color: 'green' }, 10);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ kind: 'highlight', color: 'green', location: A });
    expect(upsertMark([], { ...init, kind: 'note', note: 'why?' }, 10)[0]).toMatchObject({ kind: 'note', note: 'why?' });
  });

  it('marking the same place again edits that item instead of stacking a second one', () => {
    const first = upsertMark([], { ...init, color: 'green' }, 10);
    const recolored = upsertMark(first, { ...init, color: 'pink' }, 20);
    expect(recolored).toHaveLength(1);
    expect(recolored[0]).toMatchObject({ id: first[0]!.id, color: 'pink', createdAt: 10, updatedAt: 20 });
    const noted = upsertMark(recolored, { ...init, kind: 'note', note: 'later thought' }, 30);
    expect(noted).toHaveLength(1);
    expect(noted[0]).toMatchObject({ id: first[0]!.id, kind: 'note', note: 'later thought', color: 'pink' });
  });

  it('keeps an existing note when the same place is only recoloured', () => {
    const noted = upsertMark([], { ...init, kind: 'note', note: 'keep me' }, 10);
    expect(upsertMark(noted, { ...init, color: 'blue' }, 20)[0]).toMatchObject({ note: 'keep me', color: 'blue' });
  });

  it('a deleted item or a bookmark at the same place does not count, a different place is a new item', () => {
    const dead = [make({ id: 'd', location: A, deleted: true })];
    const bm = [make({ id: 'm', kind: 'bookmark', location: A })];
    expect(upsertMark(dead, init, 20)).toHaveLength(2);
    expect(upsertMark(bm, init, 20)).toHaveLength(2);
    expect(upsertMark(upsertMark([], init, 10), { ...init, location: B }, 20)).toHaveLength(2);
  });
});
