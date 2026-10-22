// Pure sync domain: decides what to copy where. No I/O, no fetch, no storage.
// Rules (see plan.test.ts):
//  - Books are immutable (id = content hash): copy only if the key is missing on the target.
//  - Small JSON files: newest updatedAt/addedAt wins; equal content is skipped.
//  - Nothing is ever deleted: a plan can only name files that exist on the source side.

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
  const have = new Set(dst.books);
  for (const p of src.books) (have.has(p) ? skip : copy).push(p);
  for (const [p, text] of Object.entries(src.files)) {
    const old = dst.files[p];
    (old === undefined || srcWins(text, old) ? copy : skip).push(p);
  }
  return direction === 'push'
    ? { upload: copy, download: [], skip }
    : { upload: [], download: copy, skip };
}
