import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../storage/opfs';
import type { Annotation, AnnotationFile, Progress } from '../types';
import { withS3 } from './fake-s3';
import { syncBookState } from './r2';

const enc = new TextEncoder();
const dec = new TextDecoder();
const json = (v: unknown) => enc.encode(JSON.stringify(v));
const progress = (location: string, updatedAt: number): Progress => ({ bookId: 'b1', location, fraction: 0.5, updatedAt });
const mark = (id: string, updatedAt: number, extra: Partial<Annotation> = {}): Annotation =>
  ({ id, bookId: 'b1', kind: 'highlight', location: id, text: id, color: 'yellow', createdAt: 1, updatedAt, ...extra });
const notes = (...items: Annotation[]): AnnotationFile => ({ bookId: 'b1', items });
const read = async (fs: ReturnType<typeof memoryStorage>, path: string) => {
  const b = await fs.read(path);
  return b ? JSON.parse(dec.decode(b)) : null;
};

describe('syncBookState: one book\'s position and notes, both ways', () => {
  it('sends a position the bucket does not have', async () => {
    const fs = memoryStorage();
    await fs.write('progress/b1.json', JSON.stringify(progress('p7', 10)));
    const objects: Record<string, Uint8Array> = {};
    const r = await withS3(objects, {}, (cfg) => syncBookState(cfg, fs, 'b1'));
    expect(r).toEqual({ pulledProgress: false });
    expect(JSON.parse(dec.decode(objects['progress/b1.json']))).toEqual(progress('p7', 10));
  });

  it('takes a newer position from the bucket and says so', async () => {
    const fs = memoryStorage();
    await fs.write('progress/b1.json', JSON.stringify(progress('p7', 10)));
    const objects = { 'progress/b1.json': json(progress('p40', 99)) };
    const r = await withS3(objects, {}, (cfg) => syncBookState(cfg, fs, 'b1'));
    expect(r).toEqual({ pulledProgress: true });
    expect(await read(fs, 'progress/b1.json')).toEqual(progress('p40', 99));
  });

  it('keeps a newer local position and sends it up', async () => {
    const fs = memoryStorage();
    await fs.write('progress/b1.json', JSON.stringify(progress('p40', 99)));
    const objects = { 'progress/b1.json': json(progress('p7', 10)) };
    const r = await withS3(objects, {}, (cfg) => syncBookState(cfg, fs, 'b1'));
    expect(r).toEqual({ pulledProgress: false });
    expect(JSON.parse(dec.decode(objects['progress/b1.json']))).toEqual(progress('p40', 99));
    expect(await read(fs, 'progress/b1.json')).toEqual(progress('p40', 99));
  });

  it('merges the notes: each side ends with both devices\' marks', async () => {
    const fs = memoryStorage();
    await fs.write('annotations/b1.json', JSON.stringify(notes(mark('local', 5))));
    const objects = { 'annotations/b1.json': json(notes(mark('remote', 6))) };
    await withS3(objects, {}, (cfg) => syncBookState(cfg, fs, 'b1'));
    const ids = (f: AnnotationFile) => f.items.map((i) => i.id).sort();
    expect(ids(await read(fs, 'annotations/b1.json'))).toEqual(['local', 'remote']);
    expect(ids(JSON.parse(dec.decode(objects['annotations/b1.json'])))).toEqual(['local', 'remote']);
  });

  it('a deletion made on one device survives the merge', async () => {
    const fs = memoryStorage();
    await fs.write('annotations/b1.json', JSON.stringify(notes(mark('x', 9, { deleted: true }))));
    const objects = { 'annotations/b1.json': json(notes(mark('x', 5))) };
    await withS3(objects, {}, (cfg) => syncBookState(cfg, fs, 'b1'));
    expect((JSON.parse(dec.decode(objects['annotations/b1.json'])) as AnnotationFile).items[0]?.deleted).toBe(true);
  });

  it('writes nothing when both sides already agree', async () => {
    const fs = memoryStorage();
    const same = JSON.stringify(progress('p7', 10));
    await fs.write('progress/b1.json', same);
    const objects = { 'progress/b1.json': enc.encode(same) };
    const before = objects['progress/b1.json'];
    expect(await withS3(objects, {}, (cfg) => syncBookState(cfg, fs, 'b1'))).toEqual({ pulledProgress: false });
    expect(objects['progress/b1.json']).toBe(before); // not replaced by a PUT
  });

  it('touches nothing but this book\'s position and notes', async () => {
    const fs = memoryStorage();
    await fs.write('progress/b1.json', JSON.stringify(progress('p7', 10)));
    await fs.write('progress/other.json', JSON.stringify({ ...progress('p1', 1), bookId: 'other' }));
    await fs.write('books/b1.epub', 'bytes');
    const objects: Record<string, Uint8Array> = {};
    await withS3(objects, {}, (cfg) => syncBookState(cfg, fs, 'b1'));
    expect(Object.keys(objects)).toEqual(['progress/b1.json']);
  });
});
