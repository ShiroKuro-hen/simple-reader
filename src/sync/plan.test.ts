import { describe, expect, it } from 'vitest';
import { mergeAnnotationFiles } from '../annotations/model';
import { parseAnnotationFile } from './annotations';
import { planSync, stamp, type Direction, type Plan, type Snapshot } from './plan';
import type { Annotation, AnnotationFile } from '../types';

const j = (o: object) => JSON.stringify(o);
const prog = (fraction: number, updatedAt: number) => j({ bookId: 'x', location: 'l', fraction, updatedAt });
const meta = (title: string, addedAt: number) => j({ id: 'x', title, addedAt });
const snap = (books: string[] = [], files: Record<string, string> = {}): Snapshot => ({ books, files });

describe('books are immutable (id is the content hash)', () => {
  const cases: [string, Direction, Snapshot, Snapshot, Partial<Plan>][] = [
    ['push: missing remotely -> upload', 'push', snap(['books/a.epub']), snap(), { upload: ['books/a.epub'] }],
    ['push: already remote -> skip', 'push', snap(['books/a.epub']), snap(['books/a.epub']), { skip: ['books/a.epub'] }],
    ['push: remote-only book is not touched', 'push', snap(), snap(['books/b.pdf']), {}],
    ['pull: missing locally -> download', 'pull', snap(), snap(['books/b.pdf']), { download: ['books/b.pdf'] }],
    ['pull: local-only book is not touched', 'pull', snap(['books/a.epub']), snap(), {}],
  ];
  it.each(cases)('%s', (_n, dir, local, remote, want) => {
    expect(planSync(dir, local, remote)).toEqual({ upload: [], download: [], skip: [], merge: [], ...want });
  });
});

describe('small JSON files: newest wins per file', () => {
  const p = 'progress/x.json';
  const m = 'meta/x.json';
  const cases: [string, Direction, string, string | undefined, 'copy' | 'skip'][] = [
    // [name, direction, local file, remote file, outcome]
    ['push: absent remotely', 'push', prog(0.1, 5), undefined, 'copy'],
    ['push: local newer', 'push', prog(0.9, 30), prog(0.5, 20), 'copy'],
    ['push: stale local never overwrites remote', 'push', prog(0.5, 20), prog(0.9, 30), 'skip'],
    ['push: identical content', 'push', prog(0.5, 20), prog(0.5, 20), 'skip'],
    ['pull: remote newer', 'pull', prog(0.5, 20), prog(0.9, 30), 'copy'],
    ['pull: stale remote never overwrites local', 'pull', prog(0.9, 30), prog(0.5, 20), 'skip'],
  ];
  it.each(cases)('progress %s', (_n, dir, local, remote, want) => {
    const plan = planSync(dir, snap([], { [p]: local }), snap([], remote === undefined ? {} : { [p]: remote }));
    expect(plan).toEqual({
      upload: dir === 'push' && want === 'copy' ? [p] : [],
      download: dir === 'pull' && want === 'copy' ? [p] : [],
      skip: want === 'skip' ? [p] : [],
      merge: [],
    });
  });

  it('meta uses addedAt', () => {
    const plan = planSync('push', snap([], { [m]: meta('new', 9) }), snap([], { [m]: meta('old', 3) }));
    expect(plan.upload).toEqual([m]);
    expect(planSync('push', snap([], { [m]: meta('old', 3) }), snap([], { [m]: meta('new', 9) })).skip).toEqual([m]);
  });

  describe('meta: updatedAt (tags edit) beats addedAt for newest-wins', () => {
    const mt = (addedAt: number, updatedAt?: number, tags?: string[]) => j({ id: 'x', title: 't', addedAt, updatedAt, tags });
    const cases: [string, string, string, 'copy' | 'skip'][] = [
      // [name, local, remote, push outcome]
      ['tag edit on an old book beats the untouched copy with a newer addedAt', mt(1, 50, ['a']), mt(40), 'copy'],
      ['an untouched copy never overwrites a tag edit, even with a newer addedAt', mt(40), mt(1, 50, ['a']), 'skip'],
      ['two edits: the later updatedAt wins', mt(1, 60, ['b']), mt(1, 50, ['a']), 'copy'],
      ['two edits: the earlier updatedAt loses', mt(1, 50, ['a']), mt(1, 60, ['b']), 'skip'],
      ['updatedAt is compared, not addedAt, when both have it', mt(99, 10, ['a']), mt(1, 20, ['b']), 'skip'],
    ];
    it.each(cases)('%s', (_n, local, remote, want) => {
      const plan = planSync('push', snap([], { [m]: local }), snap([], { [m]: remote }));
      expect(want === 'copy' ? plan.upload : plan.skip).toEqual([m]);
    });
  });

  it('a readable timestamp beats a corrupt file, never the reverse', () => {
    const good = prog(0.5, 20);
    expect(planSync('push', snap([], { [p]: good }), snap([], { [p]: '{broken' })).upload).toEqual([p]);
    expect(planSync('push', snap([], { [p]: '{broken' }), snap([], { [p]: good })).skip).toEqual([p]);
  });

  it('equal timestamps with different content pick the same winner from either side', () => {
    const a = prog(0.3, 50);
    const b = prog(0.4, 50);
    const winnerWhenPushing = planSync('push', snap([], { [p]: a }), snap([], { [p]: b })).upload.length === 1 ? a : b;
    const winnerWhenPulling = planSync('pull', snap([], { [p]: b }), snap([], { [p]: a })).download.length === 1 ? a : b;
    expect(winnerWhenPushing).toBe(winnerWhenPulling);
  });
});

describe('settings.json has no timestamp: the side being synced from wins', () => {
  const s = 'settings.json';
  const dark = j({ theme: 'dark', fontSize: 100, furigana: 'off' });
  const sepia = j({ theme: 'sepia', fontSize: 100, furigana: 'off' });
  it('push sends local, pull takes remote, identical is skipped', () => {
    expect(planSync('push', snap([], { [s]: dark }), snap([], { [s]: sepia })).upload).toEqual([s]);
    expect(planSync('pull', snap([], { [s]: dark }), snap([], { [s]: sepia })).download).toEqual([s]);
    expect(planSync('push', snap([], { [s]: dark }), snap([], { [s]: dark })).skip).toEqual([s]);
  });
});

describe('stamp', () => {
  it.each([
    [prog(0.1, 7), 7],
    [meta('t', 3), 3],
    [j({ addedAt: 3, updatedAt: 9 }), 9],
    [j({ theme: 'dark' }), undefined],
    ['not json', undefined],
    ['null', undefined],
    [j({ updatedAt: '7' }), undefined],
  ])('%s -> %s', (text, want) => expect(stamp(text)).toBe(want));
});

// --- the properties that matter to a user with two devices ---------------------

/** Apply a plan the way the executor would: copy source -> destination, nothing else. */
function apply(dir: Direction, plan: Plan, local: Snapshot, remote: Snapshot) {
  const [src, dst] = dir === 'push' ? [local, remote] : [remote, local];
  for (const p of dir === 'push' ? plan.upload : plan.download) {
    if (p.startsWith('books/')) dst.books.push(p);
    else dst.files[p] = src.files[p]!;
  }
  for (const m of plan.merge) {
    if (m.local) local.files[m.path] = m.text;
    if (m.remote) remote.files[m.path] = m.text;
  }
}
const clone = (s: Snapshot): Snapshot => ({ books: [...s.books], files: { ...s.files } });
/** Annotation files are compared by content, not by how they were formatted. */
const normFile = (p: string, text: string) => {
  const f = p.startsWith('annotations/') ? parseAnnotationFile(text) : undefined;
  return f ? j(mergeAnnotationFiles(f, f)) : text;
};
const canon = (s: Snapshot) => j({ b: [...s.books].sort(), f: Object.entries(s.files).map(([p, t]) => [p, normFile(p, t)]).sort() });

// small deterministic generator so failures are reproducible
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
/** Few ids and few timestamps on purpose: lots of ties, edits vs deletions, and overlap between devices. */
function randomAnnotations(r: () => number, bookId: string): string {
  const items: Annotation[] = [];
  for (const id of ['h1', 'h2', 'h3']) {
    if (r() < 0.6) items.push({ id, bookId, kind: 'note', location: 'l', text: 't', color: 'blue', createdAt: 1, updatedAt: 1 + Math.floor(r() * 4), note: `n${Math.floor(r() * 3)}`, ...(r() < 0.35 ? { deleted: true } : {}) });
  }
  return j({ bookId, items });
}
function randomSnap(r: () => number): Snapshot {
  const s = snap();
  for (const b of ['books/a.epub', 'books/b.pdf', 'books/c.epub']) if (r() < 0.5) s.books.push(b);
  for (const id of ['x', 'y']) {
    if (r() < 0.6) s.files[`annotations/${id}.json`] = randomAnnotations(r, id);
    if (r() < 0.7) s.files[`progress/${id}.json`] = prog(Math.floor(r() * 4) / 4, 1 + Math.floor(r() * 4));
    if (r() < 0.7) s.files[`meta/${id}.json`] = meta(`t${Math.floor(r() * 3)}`, 1 + Math.floor(r() * 3));
  }
  if (r() < 0.6) s.files['settings.json'] = j({ theme: ['light', 'dark', 'sepia'][Math.floor(r() * 3)] });
  return s;
}
const newestStamp = (p: string, ...ss: Snapshot[]) =>
  Math.max(-1, ...ss.map((s) => (s.files[p] === undefined ? -1 : stamp(s.files[p]!) ?? -1)));

describe('two devices converge and never lose data', () => {
  const r = rng(42);
  const worlds = Array.from({ length: 300 }, () => [randomSnap(r), randomSnap(r)] as const);

  it.each([['push then pull'], ['pull then push']])('%s: both sides end identical', (order) => {
    for (const [l0, r0] of worlds) {
      const local = clone(l0);
      const remote = clone(r0);
      for (const dir of (order === 'push then pull' ? ['push', 'pull'] : ['pull', 'push']) as Direction[]) {
        apply(dir, planSync(dir, local, remote), local, remote);
      }
      expect(canon(local), j([l0, r0])).toBe(canon(remote));
    }
  });

  it('keeps every book and the newest progress/meta of either side', () => {
    for (const [l0, r0] of worlds) {
      const local = clone(l0);
      const remote = clone(r0);
      apply('push', planSync('push', local, remote), local, remote);
      apply('pull', planSync('pull', local, remote), local, remote);
      for (const b of [...l0.books, ...r0.books]) expect(local.books).toContain(b);
      for (const p of new Set([...Object.keys(l0.files), ...Object.keys(r0.files)])) {
        expect(local.files[p], p).toBeDefined(); // nothing deleted
        if (p !== 'settings.json' && !p.startsWith('annotations/')) expect(stamp(local.files[p]!) ?? -1, p).toBe(newestStamp(p, l0, r0));
      }
    }
  });

  it('a plan only ever names files the source side holds', () => {
    for (const [l, rm] of worlds) {
      const up = planSync('push', l, rm);
      const down = planSync('pull', l, rm);
      for (const p of [...up.upload, ...up.skip].filter((q) => !q.startsWith('annotations/'))) expect(p.startsWith('books/') ? l.books : Object.keys(l.files)).toContain(p);
      for (const p of [...down.download, ...down.skip].filter((q) => !q.startsWith('annotations/'))) expect(p.startsWith('books/') ? rm.books : Object.keys(rm.files)).toContain(p);
    }
  });
});

describe('annotations across two devices (random worlds)', () => {
  const r = rng(7);
  const worlds = Array.from({ length: 300 }, () => [randomSnap(r), randomSnap(r)] as const);
  const items = (s: Snapshot, p: string) => (s.files[p] ? parseAnnotationFile(s.files[p]!)!.items : []);
  const paths = (a: Snapshot, b: Snapshot) => [...new Set([...Object.keys(a.files), ...Object.keys(b.files)])].filter((p) => p.startsWith('annotations/'));
  /** The copy that should survive for one id: newest updatedAt, a tombstone on a tie, then the larger JSON. */
  const expected = (id: string, ...copies: Annotation[]) =>
    copies.filter((c) => c.id === id).sort((a, b) => b.updatedAt - a.updatedAt || Number(!!b.deleted) - Number(!!a.deleted) || (j(b) > j(a) ? 1 : j(b) < j(a) ? -1 : 0))[0];

  it.each([['push then pull'], ['pull then push'], ['push only'], ['pull only']])('%s: no annotation is lost, the newest copy wins, a deletion never resurrects', (order) => {
    for (const [l0, r0] of worlds) {
      const local = clone(l0);
      const remote = clone(r0);
      const dirs: Direction[] = order === 'push then pull' ? ['push', 'pull'] : order === 'pull then push' ? ['pull', 'push'] : [order.split(' ')[0] as Direction];
      for (const dir of dirs) apply(dir, planSync(dir, local, remote), local, remote);
      for (const p of paths(l0, r0)) {
        const all = [...items(l0, p), ...items(r0, p)];
        for (const side of [local, remote]) {
          expect(items(side, p).map((i) => i.id).sort(), `${p}: no annotation lost`).toEqual([...new Set(all.map((i) => i.id))].sort());
          for (const id of new Set(all.map((i) => i.id))) {
            const want = expected(id, ...all)!;
            const got = items(side, p).find((i) => i.id === id)!;
            expect(got, `${p}/${id} newest wins`).toEqual(want);
            // never resurrects: a tombstone at least as new as every live copy keeps the item deleted
            const live = all.filter((c) => c.id === id && !c.deleted).map((c) => c.updatedAt);
            const dead = all.filter((c) => c.id === id && c.deleted).map((c) => c.updatedAt);
            if (dead.length && Math.max(...dead) >= Math.max(-1, ...live)) expect(got.deleted, `${p}/${id} stays deleted`).toBe(true);
          }
        }
      }
    }
  });

  it('a second sync right after the first plans nothing', () => {
    for (const [l0, r0] of worlds) {
      const local = clone(l0);
      const remote = clone(r0);
      apply('push', planSync('push', local, remote), local, remote);
      expect(planSync('push', local, remote).merge).toEqual([]);
      expect(planSync('pull', local, remote).merge).toEqual([]);
    }
  });
});

// --- annotations: merged per annotation id, not newest-file-wins -----------------------
const A = 'annotations/b1.json';
const ann = (id: string, updatedAt: number, over: Partial<Annotation> = {}): Annotation => ({
  id,
  bookId: 'b1',
  kind: 'note',
  location: 'epubcfi(/6/2)',
  text: 'quote',
  color: 'yellow',
  createdAt: 1,
  updatedAt,
  ...over,
});
const afile = (...items: Annotation[]): string => j({ bookId: 'b1', items } satisfies AnnotationFile);
const read = (text: string | undefined) => (text === undefined ? undefined : parseAnnotationFile(text));

describe('annotations/<bookId>.json: both sides merged, result written where it differs', () => {
  const x = ann('x', 5, { note: 'local' });
  const y = ann('y', 6);
  const bothMerged = j(mergeAnnotationFiles(read(afile(x))!, read(afile(y))!));

  it.each(['push', 'pull'] as Direction[])('%s: disjoint annotations -> merged file goes to BOTH sides', (dir) => {
    const plan = planSync(dir, snap([], { [A]: afile(x) }), snap([], { [A]: afile(y) }));
    expect(plan).toEqual({ upload: [], download: [], skip: [], merge: [{ path: A, text: bothMerged, local: true, remote: true }] });
  });

  it('only one side differs from the merge: only that side is written, with the other side\'s text untouched', () => {
    const both = afile(x, y);
    const plan = planSync('push', snap([], { [A]: both }), snap([], { [A]: afile(x) }));
    expect(plan.merge).toEqual([{ path: A, text: both, local: false, remote: true }]);
    const plan2 = planSync('push', snap([], { [A]: afile(x) }), snap([], { [A]: both }));
    expect(plan2.merge).toEqual([{ path: A, text: both, local: true, remote: false }]);
  });

  it.each(['push', 'pull'] as Direction[])('%s: equal content is skipped, also when formatted differently', (dir) => {
    const same = afile(x, y);
    expect(planSync(dir, snap([], { [A]: same }), snap([], { [A]: same }))).toEqual({ upload: [], download: [], skip: [A], merge: [] });
    const pretty = JSON.stringify(JSON.parse(same), null, 2);
    expect(planSync(dir, snap([], { [A]: same }), snap([], { [A]: pretty })).merge).toEqual([]);
  });

  it('present on one side only: copied verbatim to the other side, whatever the direction', () => {
    const text = afile(x);
    for (const dir of ['push', 'pull'] as Direction[]) {
      expect(planSync(dir, snap([], { [A]: text }), snap()).merge).toEqual([{ path: A, text, local: false, remote: true }]);
      expect(planSync(dir, snap(), snap([], { [A]: text })).merge).toEqual([{ path: A, text, local: true, remote: false }]);
    }
  });

  it('a newer deletion on one device wins over the older edit on the other', () => {
    const deleted = afile(ann('x', 9, { deleted: true }));
    const edited = afile(ann('x', 5, { note: 'edit' }));
    const plan = planSync('pull', snap([], { [A]: edited }), snap([], { [A]: deleted }));
    expect(plan.merge).toEqual([{ path: A, text: deleted, local: true, remote: false }]);
  });

  it('unreadable JSON loses to a readable file, on either side', () => {
    const good = afile(x);
    expect(planSync('push', snap([], { [A]: good }), snap([], { [A]: '{broken' })).merge).toEqual([{ path: A, text: good, local: false, remote: true }]);
    expect(planSync('push', snap([], { [A]: '{broken' }), snap([], { [A]: good })).merge).toEqual([{ path: A, text: good, local: true, remote: false }]);
  });

  it('unreadable on both sides, or unreadable vs absent: nothing is spread', () => {
    expect(planSync('push', snap([], { [A]: '{a' }), snap([], { [A]: '{b' })).merge).toEqual([]);
    expect(planSync('push', snap([], { [A]: '{a' }), snap()).merge).toEqual([]);
    expect(planSync('pull', snap(), snap([], { [A]: '{a' })).merge).toEqual([]);
  });

  it('a file whose bookId disagrees with the other side is left alone instead of breaking the whole sync', () => {
    const other = j({ bookId: 'someone-else', items: [ann('z', 3)] });
    for (const dir of ['push', 'pull'] as Direction[]) {
      expect(planSync(dir, snap([], { [A]: afile(x), 'progress/x.json': prog(0.5, 2) }), snap([], { [A]: other })).merge).toEqual([]);
    }
  });

  it('does not touch other files: annotations never go through upload/download', () => {
    const plan = planSync('push', snap([], { [A]: afile(x), 'progress/x.json': prog(0.5, 2) }), snap());
    expect(plan.upload).toEqual(['progress/x.json']);
  });
});
