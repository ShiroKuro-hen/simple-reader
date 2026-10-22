// One-off: builds public/dict/jmdict.json.gz from the jmdict-simplified releases
// (https://github.com/scriptin/jmdict-simplified/releases, files jmdict-eng and jmdict-spa, un-tarred).
//   node src/lookup/tools/build-jmdict.mjs <jmdict-eng.json> <jmdict-spa.json>
// Keeps entries that are common or have Spanish glosses (41k of 219k; 8.9 MB, 2.2 MB gzipped).
// Output: { form: [[reading, [es senses], [en senses], common 0|1], ...] } with every kanji and kana form as key.
import fs from 'node:fs';
import zlib from 'node:zlib';

const [engPath, spaPath] = process.argv.slice(2);
const eng = JSON.parse(fs.readFileSync(engPath, 'utf8')).words;
const spa = new Map(JSON.parse(fs.readFileSync(spaPath, 'utf8')).words.map((w) => [w.id, w]));
const senses = (w, n, m) => w.sense.slice(0, n).map((s) => s.gloss.slice(0, m).map((g) => g.text).join(', '));

const out = {};
for (const w of eng) {
  const es = spa.get(w.id);
  const common = w.kanji.some((k) => k.common) || w.kana.some((k) => k.common);
  if (!common && !es) continue;
  const e = [w.kana[0].text, es ? senses(es, 3, 3) : [], senses(w, 3, 2), common ? 1 : 0];
  for (const k of [...w.kanji, ...w.kana]) (out[k.text] ??= []).push(e);
}
fs.writeFileSync(new URL('../../../public/dict/jmdict.json.gz', import.meta.url), zlib.gzipSync(JSON.stringify(out), { level: 9 }));
console.log(Object.keys(out).length, 'forms');
