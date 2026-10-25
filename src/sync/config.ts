// The user's bucket settings and the automatic-sync switch. They live only in localStorage; the keys are never logged
// or put in error text.
import type { R2Config } from '../types';

const R2_KEY = 'sr.r2';
const AUTOSYNC_KEY = 'sr.autosync';
const EMPTY_R2: R2Config = { accountId: '', bucket: '', accessKeyId: '', secretAccessKey: '' };

export function loadR2(): R2Config {
  try {
    return { ...EMPTY_R2, ...JSON.parse(localStorage.getItem(R2_KEY) ?? '{}') };
  } catch {
    return { ...EMPTY_R2 };
  }
}

export function saveR2(c: R2Config) {
  try {
    localStorage.setItem(R2_KEY, JSON.stringify(c));
  } catch {
    /* private mode: the user just retypes it next time */
  }
}

/** All four fields are filled in. */
export const isConfigured = (c: R2Config) => Object.values(c).every(Boolean);

/** On unless the user turned it off: with a bucket set up, the position and notes follow the user between devices. */
export function autoSyncOn(): boolean {
  try {
    return localStorage.getItem(AUTOSYNC_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAutoSync(on: boolean) {
  try {
    localStorage.setItem(AUTOSYNC_KEY, on ? 'on' : 'off');
  } catch {
    /* the choice just won't survive a restart */
  }
}
