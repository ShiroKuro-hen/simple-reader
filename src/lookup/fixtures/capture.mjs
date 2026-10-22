// Re-records the provider payloads the tests parse: node src/lookup/fixtures/capture.mjs
// Each file is { url, captured, body } with the raw JSON the live API returned.
import fs from 'node:fs';

const enc = encodeURIComponent;
const gtx = (q, sl) => `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=es&dt=t&dt=bd&q=${enc(q)}`;
const mm = (q, sl) => `https://api.mymemory.translated.net/get?q=${enc(q)}&langpair=${sl}|es`;
const wk = (w) => `https://es.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&origin=*&titles=${enc(w)}`;

const targets = {
  'gtx-house-en': gtx('house', 'en'),
  'gtx-neko-ja': gtx('猫', 'ja'),
  'gtx-sentence-ja': gtx('吾輩は猫である', 'ja'),
  'gtx-perro-auto': gtx('perro', 'auto'),
  'gtx-bonjour-auto': gtx('bonjour', 'auto'),
  'gtx-two-sentences-en': gtx('Hello there. How are you today?', 'en'),
  'mymemory-house-en': mm('house', 'en'),
  'mymemory-hello-en': mm('hello', 'en'),
  'mymemory-neko-ja': mm('猫', 'ja'),
  'wiktionary-casa': wk('casa'),
  'wiktionary-running': wk('running'),
  'wiktionary-dog': wk('dog'),
  'wiktionary-missing': wk('qzxwvk'),
};

const dir = new URL('./', import.meta.url);
for (const [name, url] of Object.entries(targets)) {
  const res = await fetch(url);
  const body = await res.json();
  fs.writeFileSync(new URL(`${name}.json`, dir), JSON.stringify({ url, captured: new Date().toISOString().slice(0, 10), status: res.status, body }, null, 1));
  console.log(name, res.status);
}
