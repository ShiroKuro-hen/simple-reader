import { opfsStorage } from './opfs';

export { memoryStorage } from './opfs';
export const storage = opfsStorage();

// Ask the browser not to evict the library when disk is low. Best effort.
try {
  navigator.storage?.persist?.()?.catch(() => {});
} catch {
  /* no navigator.storage (tests) */
}
