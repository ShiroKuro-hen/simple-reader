// Opens a web page outside the app. The desktop and Android webviews ignore target="_blank" links, so the native app asks
// its opener plugin (the system browser) to do it; a plain browser opens a tab.

export function openExternal(url: string): void {
  const tauri = (window as { __TAURI_INTERNALS__?: { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> } }).__TAURI_INTERNALS__;
  if (tauri) void tauri.invoke('plugin:opener|open_url', { url }).catch(() => window.open(url, '_blank', 'noopener,noreferrer'));
  else window.open(url, '_blank', 'noopener,noreferrer');
}
