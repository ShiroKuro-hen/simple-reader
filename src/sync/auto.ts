// Runs the per-book sync when a book is opened or left. Silent: a missing bucket, no network or a slow answer just means
// nothing was synced this time, and the book opens and saves as it always did.
import { storage } from '../storage/index';
import { autoSyncOn, isConfigured, loadR2 } from './config';

/** Syncs one book's position and notes; true when a newer position came down from the bucket. Gives up after `timeoutMs`. */
export async function syncBookQuietly(id: string, timeoutMs: number): Promise<boolean> {
  const cfg = loadR2();
  if (!isConfigured(cfg) || !autoSyncOn()) return false;
  try {
    const { syncBookState } = await import('./r2');
    const give = new Promise<never>((_, reject) => setTimeout(reject, timeoutMs));
    return (await Promise.race([syncBookState(cfg, storage, id), give])).pulledProgress;
  } catch {
    return false;
  }
}
