// "Install app": Chromium fires beforeinstallprompt when the app is installable. Keep the event and offer it from a button.
// Safari (iOS) never fires it; there the user installs from the share sheet, so nothing is shown.

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallPrompt {
  available(): boolean;
  /** Shows the browser's install dialog. Resolves true if the user accepted. */
  prompt(): Promise<boolean>;
  /** Called whenever availability changes; returns the unsubscribe function. */
  subscribe(cb: () => void): () => void;
}

export function trackInstallPrompt(target: Pick<Window, 'addEventListener'> = window): InstallPrompt {
  let deferred: InstallPromptEvent | null = null;
  const subs = new Set<() => void>();
  const set = (e: InstallPromptEvent | null) => {
    deferred = e;
    subs.forEach((cb) => cb());
  };
  target.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own button instead of the browser's mini-infobar
    set(e as InstallPromptEvent);
  });
  target.addEventListener('appinstalled', () => set(null));
  return {
    available: () => deferred !== null,
    async prompt() {
      const e = deferred;
      if (!e) return false;
      set(null); // an event can be used once
      await e.prompt();
      return (await e.userChoice).outcome === 'accepted';
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
