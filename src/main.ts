import './ui/styles.css';
import { getSettings, listBooks, saveSettings } from './storage/library';
import type { ReaderSettings, Theme } from './types';
import { toast } from './ui/dom';
import { mountLibrary } from './ui/library-view';
import { mountReader } from './ui/reader-view';
import { resolveTheme } from './ui/reading';
import type { App } from './ui/settings';

const THEME_KEY = 'sr.theme'; // also read by the inline script in index.html
const root = document.getElementById('app')!;
const dark = matchMedia('(prefers-color-scheme: dark)');

const storedTheme = (): string | null => {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
};

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

async function createApp(): Promise<App> {
  const saved: Partial<ReaderSettings> = await getSettings().catch(() => ({}));
  const listeners = new Set<(s: ReaderSettings) => void>();
  const app: App = {
    settings: {
      theme: resolveTheme(storedTheme(), dark.matches),
      fontSize: saved.fontSize ?? 100,
      furigana: saved.furigana ?? 'off',
      layout: saved.layout ?? 'auto',
    },
    update(patch, remember = true) {
      app.settings = { ...app.settings, ...patch };
      if (patch.theme) {
        applyTheme(patch.theme);
        if (remember) {
          try {
            localStorage.setItem(THEME_KEY, patch.theme);
          } catch {
            /* the choice just won't survive a restart */
          }
        }
      }
      saveSettings(app.settings).catch(() => toast("Couldn't save your settings.", 'error'));
      listeners.forEach((cb) => cb(app.settings));
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  applyTheme(app.settings.theme);
  // Until the user picks a theme, track the system one.
  dark.addEventListener('change', () => storedTheme() || app.update({ theme: resolveTheme(null, dark.matches) }, false));
  return app;
}

async function boot() {
  const app = await createApp();
  let unmount: (() => void) | null = null;
  let inApp = false; // true once we navigated from the library, so Back can use history
  let routing = 0;

  const open = (id: string) => {
    inApp = true;
    location.hash = `#/book/${id}`;
  };
  const back = () => (inApp ? history.back() : (location.hash = ''));

  async function route() {
    const run = ++routing;
    unmount?.();
    unmount = null;
    const id = /^#\/book\/([\w-]+)$/.exec(location.hash)?.[1];
    if (!id) {
      unmount = mountLibrary(root, app, open);
      return;
    }
    const book = (await listBooks().catch(() => [])).find((b) => b.id === id);
    if (run !== routing) return;
    if (!book) {
      toast('That book is no longer in your library.', 'error');
      location.hash = '';
      return;
    }
    unmount = mountReader(root, book, app, back);
  }

  addEventListener('hashchange', () => void route());
  await route();
}

void boot();
