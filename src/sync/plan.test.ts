import { describe, expect, it } from 'vitest';
import { planSync, stamp, type Direction, type Plan, type Snapshot } from './plan';

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
    expect(planSync(dir, local, remote)).toEqual({ upload: [], download: [], skip: [], ...want });
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
    });
  });

  it('meta uses addedAt', () => {
    const plan = planSync('push', snap([], { [m]: meta('new', 9) }), snap([], { [m]: meta('old', 3) }));
    expect(plan.upload).toEqual([m]);
    expect(planSync('push', snap([], { [m]: meta('old', 3) }), snap([], { [m]: meta('new', 9) })).skip).toEqual([m]);
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
}
const clone = (s: Snapshot): Snapshot => ({ books: [...s.books], files: { ...s.files } });
const canon = (s: Snapshot) => j({ b: [...s.books].sort(), f: Object.entries(s.files).sort() });

// small deterministic generator so failures are reproducible
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function randomSnap(r: () => number): Snapshot {
  const s = snap();
  for (const b of ['books/a.epub', 'books/b.pdf', 'books/c.epub']) if (r() < 0.5) s.books.push(b);
  for (const id of ['x', 'y']) {
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
        if (p !== 'settings.json') expect(stamp(local.files[p]!) ?? -1, p).toBe(newestStamp(p, l0, r0));
      }
    }
  });

  it('a plan only ever names files the source side holds', () => {
    for (const [l, rm] of worlds) {
      const up = planSync('push', l, rm);
      const down = planSync('pull', l, rm);
      for (const p of [...up.upload, ...up.skip]) expect(p.startsWith('books/') ? l.books : Object.keys(l.files)).toContain(p);
      for (const p of [...down.download, ...down.skip]) expect(p.startsWith('books/') ? rm.books : Object.keys(rm.files)).toContain(p);
    }
  });
});
