// Desktop "Open with" (a double-click on a book in the file manager): the Rust side keeps the paths the system handed
// to the app, and only those can be read. Android has its own bridge (incoming.ts).
import { addBook } from '../storage/library';
import { toast } from '../ui/dom';
import { bookFileName } from './intake';
import { oneAtATime } from './one-at-a-time';

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
const invoke: Invoke = (command, args) => (window as any).__TAURI_INTERNALS__.invoke(command, args);

/** The books among the paths, each with the file name to import it under. */
export function planOpened(paths: string[]): { path: string; fileName: string }[] {
  return paths.flatMap((path) => {
    const fileName = bookFileName(path, null);
    return fileName ? [{ path, fileName }] : [];
  });
}

export function listenForOpenedBooks(showLibrary: () => void): void {
  if (window.SRIntent) return;

  const importOpened = oneAtATime(async () => {
    let added = 0;
    for (const { path, fileName } of planOpened(await invoke<string[]>('take_opened_books'))) {
      try {
        await addBook(new File([await invoke<ArrayBuffer>('read_opened_book', { path })], fileName));
        added++;
      } catch {
        toast(`Couldn't add "${fileName}". The file may be damaged.`, 'error');
      }
    }
    if (added) toast(`Added ${added} book${added === 1 ? '' : 's'}`);
    if (added) showLibrary();
  });

  addEventListener('sr-opened', () => void importOpened()); // the Rust side fires it when a second launch hands over a book
  void importOpened(); // a double-click that started the app
}
