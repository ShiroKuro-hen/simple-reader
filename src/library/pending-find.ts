// A search made in the library, handed to the reader of the book it found: set just before the book opens, taken once.
// Kept in memory only, so no query is left in the URL or in storage.
let pending: { bookId: string; query: string } | undefined;

export function setPendingFind(bookId: string, query: string): void {
  pending = { bookId, query };
}

/** The query waiting for this book, or null. Taking it clears it, whichever book it was for. */
export function takePendingFind(bookId: string): string | null {
  const found = pending;
  pending = undefined;
  return found?.bookId === bookId ? found.query : null;
}
