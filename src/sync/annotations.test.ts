import { describe, expect, it } from 'vitest';
import type { Annotation, AnnotationFile } from '../types';
import { mergeAnnotationFiles } from '../annotations/model';
import { parseAnnotationFile } from './annotations';

const ann = (id: string, updatedAt: number, over: Partial<Annotation> = {}): Annotation => ({
  id,
  bookId: 'b1',
  kind: 'highlight',
  location: 'epubcfi(/6/4)',
  text: `text of ${id}`,
  color: 'yellow',
  createdAt: 1,
  updatedAt,
  ...over,
});
const file = (...items: Annotation[]): AnnotationFile => ({ bookId: 'b1', items });
const ids = (f: AnnotationFile) => f.items.map((i) => i.id);
const byId = (f: AnnotationFile, id: string) => f.items.find((i) => i.id === id);

// mergeAnnotationFiles lives in src/annotations/model.ts (shared with the annotations module); these are the
// sync-side rules it must keep.
describe('mergeAnnotationFiles: per annotation id, newest updatedAt wins', () => {
  it('keeps annotations that exist on one side only', () => {
    const m = mergeAnnotationFiles(file(ann('a', 5)), file(ann('b', 6)));
    expect(ids(m)).toEqual(['a', 'b']);
  });

  it.each([
    ['local edit is newer', ann('a', 9, { note: 'new' }), ann('a', 5, { note: 'old' }), 'new'],
    ['remote edit is newer', ann('a', 5, { note: 'old' }), ann('a', 9, { note: 'new' }), 'new'],
  ])('%s', (_n, l, r, want) => {
    const m = mergeAnnotationFiles(file(l), file(r));
    expect(m.items).toHaveLength(1);
    expect(byId(m, 'a')?.note).toBe(want);
  });

  it.each([
    ['a newer tombstone beats an older edit (local deletes)', ann('a', 9, { deleted: true }), ann('a', 5, { note: 'edit' })],
    ['a newer tombstone beats an older edit (remote deletes)', ann('a', 5, { note: 'edit' }), ann('a', 9, { deleted: true })],
  ])('%s', (_n, l, r) => {
    for (const m of [mergeAnnotationFiles(file(l), file(r)), mergeAnnotationFiles(file(r), file(l))]) {
      expect(byId(m, 'a')?.deleted).toBe(true);
    }
  });

  it('an edit newer than the tombstone wins: the user re-edited after deleting elsewhere', () => {
    const m = mergeAnnotationFiles(file(ann('a', 9, { note: 'later' })), file(ann('a', 5, { deleted: true })));
    expect(byId(m, 'a')).toMatchObject({ note: 'later' });
    expect(byId(m, 'a')?.deleted).toBeUndefined();
  });

  it('same updatedAt: the tombstone wins (never resurrect), and the result does not depend on the argument order', () => {
    const dead = ann('a', 7, { deleted: true });
    const live = ann('a', 7, { note: 'x' });
    expect(byId(mergeAnnotationFiles(file(dead), file(live)), 'a')?.deleted).toBe(true);
    expect(byId(mergeAnnotationFiles(file(live), file(dead)), 'a')?.deleted).toBe(true);
  });

  it('same updatedAt, both live, different content: same winner from either side', () => {
    const x = ann('a', 7, { note: 'x' });
    const y = ann('a', 7, { note: 'y' });
    expect(mergeAnnotationFiles(file(x), file(y))).toEqual(mergeAnnotationFiles(file(y), file(x)));
  });

  it('keeps tombstones in the output (sync never deletes) and is idempotent', () => {
    const m = mergeAnnotationFiles(file(ann('a', 9, { deleted: true }), ann('b', 2)), file(ann('b', 3)));
    expect(ids(m)).toEqual(['a', 'b']);
    expect(mergeAnnotationFiles(m, m)).toEqual(m);
    expect(mergeAnnotationFiles(m, file(ann('b', 3)))).toEqual(m);
  });

  it('keeps the bookId', () => {
    expect(mergeAnnotationFiles(file(), file(ann('a', 1))).bookId).toBe('b1');
  });
});

describe('parseAnnotationFile: only a readable AnnotationFile counts', () => {
  const ok = JSON.stringify(file(ann('a', 1)));
  it.each([
    ['valid', ok, true],
    ['broken JSON', '{"bookId":', false],
    ['not an object', '[1,2]', false],
    ['null', 'null', false],
    ['no items array', '{"bookId":"b1"}', false],
    ['no bookId', '{"items":[]}', false],
  ])('%s', (_n, text, readable) => expect(parseAnnotationFile(text) !== undefined).toBe(readable));

  it('drops items without a usable id/updatedAt instead of rejecting the whole file', () => {
    const f = parseAnnotationFile(JSON.stringify({ bookId: 'b1', items: [ann('a', 1), { id: 'zz' }, null, { updatedAt: 3 }] }));
    expect(f && ids(f)).toEqual(['a']);
  });
});
