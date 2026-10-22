// Lookup results: a Map in memory, mirrored to localStorage so repeat lookups work offline.
import type { LookupResult } from '../types';

const KEY = 'sr.lookup.v1';
const MAX = 300;
let memory: Map<string, LookupResult> | undefined;

function store(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // blocked in private windows, previews, sandboxed frames
  }
}

function load(): Map<string, LookupResult> {
  if (memory) return memory;
  try {
    memory = new Map(Object.entries(JSON.parse(store()?.getItem(KEY) ?? '{}')));
  } catch {
    memory = new Map(); // corrupt or unreadable: start clean
  }
  return memory;
}

export const cacheGet = (key: string) => load().get(key);

export function cacheSet(key: string, value: LookupResult): void {
  const m = load();
  m.delete(key); // re-insert so the newest is last
  m.set(key, value);
  while (m.size > MAX) m.delete(m.keys().next().value!);
  try {
    store()?.setItem(KEY, JSON.stringify(Object.fromEntries(m)));
  } catch {
    /* quota exceeded: memory copy still works */
  }
}
