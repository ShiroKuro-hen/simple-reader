// Asks GitHub whether a newer build of the desktop/Android app exists. Only the native app calls this; the PWA has its own update flow.

export const DEFAULT_ENDPOINT = 'https://api.github.com/repos/ShiroKuro-hen/simple-reader/releases?per_page=10';

export interface Release {
  tag_name: string;
  html_url: string;
  draft?: boolean;
}

export type Version = [number, number, number];

/** Only plain x.y.z, with or without a leading v. Pre-release tags such as v1.2.3-rc.1 do not parse, so they never count as newer. */
export function parseVersion(tag: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isNewer(current: string, latest: string): boolean {
  const a = parseVersion(current);
  const b = parseVersion(latest);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (b[i] !== a[i]) return b[i]! > a[i]!;
  return false;
}

export function newestRelease(releases: Release[], current: string): { version: string; url: string } | null {
  if (!Array.isArray(releases)) return null;
  let best: { version: string; url: string } | null = null;
  for (const r of releases) {
    if (r.draft || !parseVersion(r.tag_name)) continue;
    if (!best || isNewer(best.version, r.tag_name)) best = { version: r.tag_name.replace(/^v/, ''), url: r.html_url };
  }
  return best && isNewer(current, best.version) ? best : null;
}

/** Never throws: an update check must not bother the user or break startup. Offline, rate limited or garbled answers all mean "no news". */
export async function checkForUpdate(current: string, endpoint = DEFAULT_ENDPOINT): Promise<{ version: string; url: string } | null> {
  try {
    const res = await fetch(endpoint, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return newestRelease(await res.json(), current);
  } catch {
    return null;
  }
}
