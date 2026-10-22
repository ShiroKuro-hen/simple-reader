// Shared contracts. Every module imports types from here and nowhere else,
// so the storage, reader, lookup, sync and ui pieces can be built in parallel.

export type BookFormat = 'epub' | 'pdf';

export interface BookMeta {
  /** SHA-256 hex of the file content: the same book on two devices shares one id. */
  id: string;
  title: string;
  author?: string;
  format: BookFormat;
  size: number;
  addedAt: number;
  /** Small data: URL of the cover, if the book has one. */
  cover?: string;
  /** Shelves/labels chosen by the user, lowercase, trimmed, no duplicates. */
  tags?: string[];
  /** Set when the user edits the metadata (tags); sync keeps the newest. */
  updatedAt?: number;
}

export type AnnotationKind = 'highlight' | 'note' | 'bookmark';
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

/** One highlight, note or bookmark. Stored as items of annotations/<bookId>.json. */
export interface Annotation {
  /** Random id, stable across devices. */
  id: string;
  bookId: string;
  kind: AnnotationKind;
  /** EPUB CFI range (highlight/note) or CFI point (bookmark); PDF: page number as a string. */
  location: string;
  /** The highlighted text (or the first words of the page for a bookmark), kept to re-find it and to export. */
  text: string;
  /** The user's note, for kind 'note' (and optional on highlights). */
  note?: string;
  color: HighlightColor;
  /** Chapter label at the time, for exports. */
  chapter?: string;
  createdAt: number;
  updatedAt: number;
  /** Tombstone: sync never deletes files, so a removed annotation stays with deleted=true and the newest updatedAt wins. */
  deleted?: boolean;
}

export interface AnnotationFile {
  bookId: string;
  items: Annotation[];
}

export interface Progress {
  bookId: string;
  /** Opaque to everyone but the reader (EPUB CFI or PDF page). */
  location: string;
  /** 0..1, for the progress bar. */
  fraction: number;
  updatedAt: number;
}

/** Files live behind this interface: OPFS on the web, app folder on Tauri. */
export interface Storage {
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, data: Uint8Array | string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Paths under `prefix`, full paths. */
  list(prefix: string): Promise<string[]>;
}

export type Theme = 'light' | 'dark' | 'sepia';
export type FuriganaMode = 'off' | 'furigana' | 'romaji';
/** 'auto': two pages side by side when the window is wide enough; 'single': always one. */
export type PageLayout = 'auto' | 'single';

export interface ReaderSettings {
  theme: Theme;
  /** Percent, 100 = the book's own size. */
  fontSize: number;
  furigana: FuriganaMode;
  layout: PageLayout;
}

export interface TocItem {
  label: string;
  href: string;
  children?: TocItem[];
}

export interface TextSelection {
  /** The selected text, trimmed. */
  text: string;
  /** The sentence or paragraph around it, for disambiguation. */
  context: string;
  /** Selection box in the host page's viewport coordinates, to place the popup. */
  rect: { x: number; y: number; width: number; height: number };
}

export interface ReaderHandle {
  next(): Promise<void>;
  prev(): Promise<void>;
  goTo(target: string): Promise<void>;
  /** `fraction` is 0..1. */
  goToFraction(fraction: number): Promise<void>;
  toc: TocItem[];
  setSettings(settings: ReaderSettings): void;
  onSelect(cb: (sel: TextSelection) => void): void;
  onRelocate(cb: (p: { location: string; fraction: number; label?: string }) => void): void;
  destroy(): void;
}

export interface OpenBookOptions {
  settings: ReaderSettings;
  /** Where to resume. */
  location?: string;
  /** Called with every freshly rendered EPUB document, so lookup can add <ruby>. */
  onDocLoad?: (doc: Document) => void;
}

export interface LookupResult {
  word: string;
  lang: 'ja' | 'en' | 'es' | 'other';
  /** Hiragana reading, for Japanese. */
  reading?: string;
  romaji?: string;
  /** Short definitions, in Spanish when possible. */
  definitions: string[];
  /** Spanish translation of the selection. */
  translation?: string;
  /** Where the answer came from, shown small in the popup. */
  source: string;
}

export interface R2Config {
  /** Only for tests/other S3-compatible servers; R2's own URL is built from accountId when absent. */
  endpoint?: string;
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}
