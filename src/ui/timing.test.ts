import { describe, expect, it } from 'vitest';
import { debounce } from './timing';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('debounce', () => {
  it('runs once with the last arguments after the quiet period', async () => {
    const seen: number[] = [];
    const d = debounce((n: number) => seen.push(n), 25);
    d(1);
    d(2);
    d(3);
    expect(seen).toEqual([]);
    await sleep(70);
    expect(seen).toEqual([3]);
  });
  it('flush runs the pending call immediately, once', async () => {
    const seen: string[] = [];
    const d = debounce((s: string) => seen.push(s), 1000);
    d('a');
    d.flush();
    d.flush();
    expect(seen).toEqual(['a']);
  });
  it('flush with nothing pending does nothing', () => {
    let calls = 0;
    debounce(() => calls++, 10).flush();
    expect(calls).toBe(0);
  });
});
