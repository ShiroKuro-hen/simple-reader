import { describe, expect, it } from 'vitest';
import { crc32, storeZip } from './store-zip';

describe('crc32', () => {
  it('matches the standard check value of "123456789"', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('storeZip', () => {
  it('writes the same bytes for the same entries', () => {
    const files = { '0001.png': new Uint8Array([1, 2]), '0002.jpg': new Uint8Array([3]) };
    expect(storeZip(files)).toEqual(storeZip({ ...files }));
  });
});
