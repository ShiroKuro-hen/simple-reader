import { describe, expect, it } from 'vitest';
import { oneAtATime } from './one-at-a-time';

const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('oneAtATime', () => {
  it('never runs the task twice at once', async () => {
    let running = 0;
    let peak = 0;
    const run = oneAtATime(async () => {
      peak = Math.max(peak, ++running);
      await pause();
      running--;
    });
    await Promise.all([run(), run(), run()]);
    expect(peak).toBe(1);
  });

  it('runs once more when a call arrived while it was busy, so nothing is missed', async () => {
    let runs = 0;
    const run = oneAtATime(async () => {
      runs++;
      await pause();
    });
    await Promise.all([run(), run(), run()]);
    expect(runs).toBe(2); // the busy round, plus one round that covers the calls made meanwhile
  });

  it('runs a task for every call that comes after it finished', async () => {
    let runs = 0;
    const run = oneAtATime(async () => void runs++);
    await run();
    await run();
    expect(runs).toBe(2);
  });

  it('keeps working after a task fails', async () => {
    let runs = 0;
    const run = oneAtATime(async () => {
      if (++runs === 1) throw new Error('boom');
    });
    await expect(run()).rejects.toThrow('boom');
    await run();
    expect(runs).toBe(2);
  });
});
