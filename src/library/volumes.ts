// Reading through a series: which books are finished and which volume comes next. Pure, no DOM.
import type { BookMeta, Progress } from '../types';
import { volumeOrder } from './series';

/** From this fraction on a book counts as read: the last pages of a comic or the closing lines of a novel. */
export const FINISHED = 0.97;

export const isRead = (p: Progress | null | undefined): boolean => !!p && p.fraction >= FINISHED;

/** The volume after `id` in its series (names compare ignoring case, like the library), or undefined. */
export function nextVolume(books: readonly BookMeta[], id: string): BookMeta | undefined {
  const series = books.find((b) => b.id === id)?.series?.trim().toLowerCase();
  if (!series) return undefined;
  const volumes = volumeOrder(books.filter((b) => b.series?.trim().toLowerCase() === series));
  return volumes[volumes.findIndex((b) => b.id === id) + 1];
}

/** The progress to save when the user marks a book read (it keeps its place) or unread (back to the start). */
export function withReadMark(current: Progress | null, bookId: string, read: boolean, now: number): Progress {
  return read
    ? { bookId, location: current?.location ?? '', fraction: 1, updatedAt: now }
    : { bookId, location: '', fraction: 0, updatedAt: now };
}
