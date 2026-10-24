import { capHits, type ChapterHits, excerptParts, groupByChapter, MAX_HITS, normalizeQuery } from '../reader/search-results';
import type { SearchHit } from '../types';
import { h, iconButton, sheet, toast } from './dom';
import { debounce } from './timing';

const TYPING_DELAY_MS = 300;
/** Below this width the panel covers the book, so it closes once a result is picked. */
const NARROW_WIDTH = 700;

/** The in-book search side sheet: a search box, a status line, and the matches grouped by chapter. */
export function createSearchPanel(on: {
  /** The matches of `query` in book order; undefined while no book is open. */
  run(query: string): AsyncIterable<SearchHit> | undefined;
  clear(): void;
  jump(hit: SearchHit): void;
  /** Runs when the panel closes, to give focus back. */
  closed(): void;
}) {
  const dlg = sheet('sheet-search', 'Search in book');
  const input = h('input', { class: 'find-input', type: 'search', 'aria-label': 'Search in book', placeholder: 'Search in book', autocomplete: 'off', enterkeyhint: 'search' });
  const status = h('p', { class: 'search-status', role: 'status' });
  const list = h('div', { class: 'search-results' });
  let round = 0; // each query gets a number; the work of an older one stops
  let running: AsyncIterator<SearchHit> | undefined; // the matches still coming in
  let keepHighlights = false; // a picked result closes the panel, but its matches stay on the page

  /** Ends a search. No match is drawn after this, so the highlights can be cleared once it resolves. */
  async function end(it: AsyncIterator<SearchHit>) {
    if (running === it) running = undefined;
    await it.return?.(undefined);
  }
  async function stop() {
    if (running) await end(running);
  }

  /** The first matches up to the cap, or fewer when `alive` turns false (a newer query). */
  async function collect(it: AsyncIterator<SearchHit>, alive: () => boolean): Promise<SearchHit[]> {
    const found: SearchHit[] = [];
    for (let step = await it.next(); alive() && !step.done; step = await it.next()) {
      found.push(step.value);
      if (found.length > MAX_HITS) break;
    }
    return found;
  }

  async function search(raw: string) {
    const id = ++round;
    await stop(); // the old search finishes its step first, so it cannot draw a match after the clear
    if (id !== round) return;
    on.clear();
    list.replaceChildren();
    const query = normalizeQuery(raw);
    const it = query ? on.run(query)?.[Symbol.asyncIterator]() : undefined;
    if (!it) return say('');
    running = it;
    try {
      const found = await collect(it, () => id === round);
      if (id === round) show(found);
    } catch {
      if (id === round) {
        say('');
        toast("Couldn't search this book.", 'error');
      }
    } finally {
      await end(it);
    }
  }

  function say(text: string) {
    status.textContent = text;
  }

  function show(found: SearchHit[]) {
    if (!found.length) return say('No results');
    const { shown, truncated } = capHits(found);
    say(truncated ? `Showing the first ${MAX_HITS}` : `${found.length} ${found.length === 1 ? 'result' : 'results'}`);
    list.replaceChildren(...groupByChapter(shown).map(chapterGroup));
  }

  function chapterGroup({ chapter, hits }: ChapterHits) {
    return h('section', { class: 'search-group' },
      h('h3', {}, chapter.trim() || 'Untitled'),
      h('ul', {}, ...hits.map((hit) => h('li', {}, resultButton(hit)))));
  }

  function resultButton(hit: SearchHit) {
    const { pre, match, post } = excerptParts(hit);
    return h('button', { class: 'search-hit', type: 'button', onclick: () => pick(hit) }, pre, h('mark', {}, match), post);
  }

  function pick(hit: SearchHit) {
    if (innerWidth < NARROW_WIDTH) {
      keepHighlights = true;
      dlg.close();
    }
    on.jump(hit);
  }

  // The search waits for a pause in typing; the status shows the wait at once.
  const typed = debounce(() => {
    if (dlg.open) void search(input.value);
  }, TYPING_DELAY_MS);
  input.addEventListener('input', () => {
    say(normalizeQuery(input.value) ? 'Searching…' : '');
    typed();
  });

  // Escape in a search box clears its text instead of closing the panel, so the box closes it.
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    dlg.close();
  });

  dlg.addEventListener('close', () => {
    const keep = keepHighlights;
    keepHighlights = false;
    on.closed();
    if (keep) return;
    input.value = '';
    list.replaceChildren();
    say('');
    round++; // a search still running stops
    void stop().then(on.clear);
  });

  dlg.replaceChildren(
    h('div', { class: 'toc' },
      h('div', { class: 'set-head' }, h('h2', {}, 'Search in book'), iconButton('close', 'Close search', () => dlg.close())),
      h('div', { class: 'search-form', role: 'search' }, input),
      status,
      list));

  return {
    el: dlg,
    /** Opens the panel; a `query` (from the library's search) is filled in and run at once. */
    open(query = '') {
      dlg.showModal();
      if (query) {
        input.value = query;
        void search(query);
      }
      input.focus(); // the close button comes first in the dialog, so the input needs an explicit focus
    },
  };
}
