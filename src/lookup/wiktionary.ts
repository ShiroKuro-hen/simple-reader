// es.wiktionary.org: Spanish definitions for Spanish and English words. CORS-open with origin=*.
const UNUSABLE = /^(Ejemplo|Uso|Sinónimos?|Antónimos?|Hiperónimos?|Hipónimos?|Ámbito|Etimología|Relacionados?)\b/;

export const wiktionaryUrl = (word: string) =>
  `https://es.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(word)}`;

/** Plain text of the page, '' when the page does not exist. */
export function extractOf(body: any): string {
  const page = Object.values(body?.query?.pages ?? {})[0] as { extract?: string } | undefined;
  return page?.extract ?? '';
}

export async function fetchExtract(word: string): Promise<string> {
  const res = await fetch(wiktionaryUrl(word), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`wiktionary ${res.status}`);
  return extractOf(await res.json());
}

/** Language sections present on the page ("Español", "Inglés"...). */
export function languagesOf(extract: string): string[] {
  return [...extract.matchAll(/^== ([^=].*?) ==$/gm)].map((m) => m[1]!);
}

/** Numbered senses of one language section. The extract lists "N [topic]" then the gloss on the next line. */
export function parseDefinitions(extract: string, language: string, max = 5): string[] {
  const start = extract.search(new RegExp(`^== ${language} ==$`, 'm'));
  if (start < 0) return [];
  const rest = extract.slice(start + 1);
  const end = rest.search(/^== [^=]/m);
  const lines = (end < 0 ? rest : rest.slice(0, end)).split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length && out.length < max; i++) {
    if (!/^\d+(\s+\S.*)?$/.test(lines[i]!)) continue;
    const def = lines[i + 1]?.trim();
    if (def && !UNUSABLE.test(def) && !out.includes(def)) out.push(def.length > 200 ? `${def.slice(0, 197)}...` : def);
  }
  return out;
}
