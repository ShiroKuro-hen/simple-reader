import { afterEach, describe, expect, it } from 'vitest';
import { openExternal } from './open-url';

const URL = 'https://github.com/ShiroKuro-hen/simple-reader/releases/tag/v0.8.0';
type Call = [string, Record<string, unknown> | undefined];

/** A window with just the two things openExternal looks at; `invoke` stands where the native bridge would. */
function fakeWindow(invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>) {
  const opened: string[][] = [];
  (globalThis as { window?: unknown }).window = {
    open: (...a: string[]) => opened.push(a),
    ...(invoke ? { __TAURI_INTERNALS__: { invoke } } : {}),
  };
  return opened;
}
afterEach(() => delete (globalThis as { window?: unknown }).window);

describe('openExternal', () => {
  it('in the native app asks the opener plugin for the system browser, and opens no tab', () => {
    const calls: Call[] = [];
    const opened = fakeWindow(async (c, a) => void calls.push([c, a]));
    openExternal(URL);
    expect(calls).toEqual([['plugin:opener|open_url', { url: URL }]]);
    expect(opened).toEqual([]);
  });

  it('in a browser opens a tab that cannot reach back into the app', () => {
    const opened = fakeWindow();
    openExternal(URL);
    expect(opened).toEqual([[URL, '_blank', 'noopener,noreferrer']]);
  });

  it('falls back to a tab when the native opener refuses', async () => {
    const opened = fakeWindow(async () => { throw new Error('not allowed'); });
    openExternal(URL);
    await new Promise((r) => setTimeout(r, 0));
    expect(opened).toEqual([[URL, '_blank', 'noopener,noreferrer']]);
  });
});
