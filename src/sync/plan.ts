import { mergeAnnotationFiles } from '../annotations/model';
import { parseAnnotationFile } from './annotations';

// Pure sync domain: decides what to copy where. No I/O, no fetch, no storage.
// Rules (see plan.test.ts):
//  - Books are immutable (id = content hash): copy only if the key is missing on the target.
//  - Small JSON files: newest updatedAt (else addedAt) wins; equal content is skipped.
//  - annotations/<bookId>.json is the exception: both copies are MERGED per annotation (./annotations.ts)
//    and the result is written to whichever side differs, whatever the direction.
//  - Nothing is ever deleted (annotation deletions are tombstones inside the merged file).

/** What one side (this device, or the bucket) holds. `files` maps path -> JSON text. */
export interface Snapshot {
  /** Paths under books/. Content is never needed to decide. */
  books: string[];
  /** meta/*.json, progress/*.json, settings.json -> their text. */
  files: Record<string, string>;
}

export type Direction = 'push' | 'pull';

export interface Plan {
  /** Paths to copy local -> remote (push only). */
  upload: string[];
  /** Paths to copy remote -> local (pull only). */
  download: string[];
  skip: string[];
  /** annotations/*.json to write: `text` goes to the local side and/or the remote side. */
  merge: Merge[];
}

export interface Merge {
  path: string;
  text: string;
  local: boolean;
  remote: boolean;
}

export const isAnnotationPath = (p: string) => p.startsWith('annotations/');

/** What to write for one annotations file, or undefined when both sides already agree (or nothing readable exists). */
export function planAnnotations(path: string, local: string | undefined, remote: string | undefined): Merge | undefined {
  const l = local === undefined ? undefined : parseAnnotationFile(local);
  const r = remote === undefined ? undefined : parseAnnotationFile(remote);
  if (!l && !r) return undefined;
  if (!l || !r) return { path, text: l ? local! : remote!, local: !l, remote: !r }; // the readable one wins, copied verbatim
  if (l.bookId !== r.bookId) return undefined; // corrupt/foreign file: leave both alone rather than fail the sync
  const norm = (f: typeof l) => JSON.stringify(mergeAnnotationFiles(f, f));
  const merged = JSON.stringify(mergeAnnotationFiles(l, r));
  const [needLocal, needRemote] = [norm(l) !== merged, norm(r) !== merged];
  if (!needLocal && !needRemote) return undefined;
  return { path, text: !needLocal ? local! : !needRemote ? remote! : merged, local: needLocal, remote: needRemote };
}

/** updatedAt (progress) or addedAt (meta); undefined when absent or unreadable. */
export function stamp(json: string): number | undefined {
  try {
    const v = JSON.parse(json) as { updatedAt?: unknown; addedAt?: unknown } | null;
    const t = v?.updatedAt ?? v?.addedAt;
    return typeof t === 'number' ? t : undefined;
  } catch {
    return undefined;
  }
}

/** Should `src` overwrite `dst`? Pure per-file merge rule. */
export function srcWins(src: string, dst: string): boolean {
  if (src === dst) return false;
  const [s, d] = [stamp(src), stamp(dst)];
  if (s !== undefined && d !== undefined) return s !== d ? s > d : src > dst; // tie: deterministic, so devices converge
  if (s !== undefined || d !== undefined) return s !== undefined; // a readable timestamp beats none
  return true; // no timestamps (settings.json): the side being synced from wins
}

export function planSync(direction: Direction, local: Snapshot, remote: Snapshot): Plan {
  const [src, dst] = direction === 'push' ? [local, remote] : [remote, local];
  const copy: string[] = [];
  const skip: string[] = [];
  const merge: Merge[] = [];
  const have = new Set(dst.books);
  for (const p of src.books) (have.has(p) ? skip : copy).push(p);
  for (const p of new Set([...Object.keys(local.files), ...Object.keys(remote.files)].filter(isAnnotationPath))) {
    const m = planAnnotations(p, local.files[p], remote.files[p]);
    if (m) merge.push(m);
    else if (local.files[p] !== undefined && remote.files[p] !== undefined && parseAnnotationFile(local.files[p]!)) skip.push(p);
  }
  for (const [p, text] of Object.entries(src.files)) {
    if (isAnnotationPath(p)) continue;
    const old = dst.files[p];
    (old === undefined || srcWins(text, old) ? copy : skip).push(p);
  }
  return direction === 'push'
    ? { upload: copy, download: [], skip, merge }
    : { upload: [], download: copy, skip, merge };
}
