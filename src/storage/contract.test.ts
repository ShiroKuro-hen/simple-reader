import { describe, it } from 'vitest';
import { memoryStorage } from './opfs';
import { storageContract } from './contract';

// The same cases run against the real OPFS in a browser: see src/reader/e2e.
describe('Storage contract: memoryStorage', () => {
  let n = 0;
  for (const [name, run] of Object.entries(storageContract))
    it(name, () => run(memoryStorage(), `t${n++}`));
});
