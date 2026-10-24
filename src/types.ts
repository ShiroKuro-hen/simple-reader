// Shared contracts. Every module imports types from here and nowhere else,
// so the storage, reader, lookup, sync and ui pieces can be built in parallel.

export type BookFormat = 'epub' | 'pdf' | 'cbz';

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
  /** Series name shown as one entry in the library; set when imported from a folder. Syncs with the meta file. */
  series?: string;
  /** Shelves/labels chosen by the user, lowercase, trimmed, no duplicates. */
  tags?: string[];
  /** EPUB text direction chosen for this book; absent means 'book'. */
  writing?: TextDirection;
  /** Set when the user edits the metadata (tags or direction); sync keeps the newest. */
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
  /** EPUB CFI range (highlight/note) or CFI point (bookmark). PDF: a page number (bookmark), or "<page>@x,y,w,h;..." (highlight, see pdf-highlights.ts). */
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
  /** Comics (cbz) read right to left; ignored by EPUB and PDF. */
  rtl: boolean;
}

/** EPUB only: 'book' keeps the book's own writing direction (vertical Japanese stays vertical); 'horizontal' forces left-to-right text. */
export type TextDirection = 'book' | 'horizontal';

/** What an open book is rendered with: the global settings plus this book's text direction. */
export type ViewSettings = ReaderSettings & { writing: TextDirection };

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
  /** Where the selection is, as an Annotation.location (EPUB CFI range or PDF highlight location). Absent when there is nothing to paint. */
  location?: string;
}

/** One match of an in-book search: the excerpt is the text around it, `match` is the matched text. */
export interface SearchHit {
  /** The chapter label the match is in; '' when the book gives none. */
  chapter: string;
  /** Where the match is, for `goTo`: an EPUB CFI or a PDF page number. */
  cfi: string;
  pre: string;
  match: string;
  post: string;
}

export interface ReaderHandle {
  next(): Promise<void>;
  prev(): Promise<void>;
  goTo(target: string): Promise<void>;
  /** `fraction` is 0..1. */
  goToFraction(fraction: number): Promise<void>;
  toc: TocItem[];
  /** EPUB and PDF: finds `query` in every section or page, yielding the matches in book order. Matches stay highlighted until `clearSearch`. */
  search?(query: string): AsyncIterable<SearchHit>;
  /** EPUB and PDF: removes the highlights of the last search. */
  clearSearch?(): void;
  /** Returns a promise when the change re-loads the book's section (EPUB writing direction), which settles once it is shown again. */
  setSettings(settings: ViewSettings): void | Promise<void>;
  onSelect(cb: (sel: TextSelection) => void): void;
  onRelocate(cb: (p: { location: string; fraction: number; label?: string }) => void): void;
  /** Draws the highlights and notes of `items` (not bookmarks) on every section, now and as sections load; removes the ones no longer listed. PDFs draw the current page's. */
  setAnnotations(items: Annotation[]): void;
  /** The user tapped a drawn highlight; `rect` is its box in the host viewport. */
  onAnnotationClick(cb: (id: string, rect: TextSelection['rect']) => void): void;
  /** The current page as a bookmark anchor: a point location (EPUB CFI / PDF page number), the first words on the page, the chapter or page label. */
  here(): { location: string; text: string; label?: string };
  /** Whether the page on screen turns right to left: the keys and the edge zones follow it. EPUB: the direction foliate detected for the section; PDF: false; comics: their setting. */
  rtl(): boolean;
  destroy(): void;
}

export interface OpenBookOptions {
  settings: ViewSettings;
  /** Where to resume. */
  location?: string;
  /** Called with every freshly rendered EPUB document, so lookup can add <ruby>. */
  onDocLoad?: (doc: Document) => void;
  /** Heights in px of the toolbars drawn over the reader: EPUB keeps its text clear of them. */
  getBars?: () => { top: number; bottom: number };
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
