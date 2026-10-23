// Regenerates the binary fixtures next to this file: `node src/reader/fixtures/build.mjs`.
// Output is deterministic, so the committed files only change when this script does.
import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = (name, bytes) => writeFileSync(join(here, name), bytes);

// ---- EPUB ----------------------------------------------------------------
function png(w, h, [r, g, b]) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');


// Minimal store-only zip writer: foliate's vendored zip.js can only read.
function zipFiles(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name);
    const d = Buffer.from(data);
    const crc = crc32(d);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0021, 10); // fixed 1980-01-01 date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(d.length, 18);
    local.writeUInt32LE(d.length, 22);
    local.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0021, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(d.length, 20);
    c.writeUInt32LE(d.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    parts.push(local, n, d);
    offset += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}

async function epub({ id, title, author, lang, chapters, cover, css }) {
  const files = [];
  const add = async (name, data) => files.push([name, data]);
  await add('mimetype', 'application/epub+zip');
  await add(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  const items = chapters.map((c, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join('');
  await add(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${id}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator><dc:language>${lang}</dc:language>
${cover ? '<meta name="cover" content="cover-img"/>' : ''}
</metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${css ? '<item id="css" href="style.css" media-type="text/css"/>' : ''}${cover ? '<item id="cover-img" href="cover.png" media-type="image/png" properties="cover-image"/>' : ''}${items}</manifest>
<spine>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine>
</package>`,
  );
  await add(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body>
<nav epub:type="toc"><ol>${chapters.map((c, i) => `<li><a href="c${i}.xhtml">${esc(c.title)}</a></li>`).join('')}</ol></nav></body></html>`,
  );
  for (const [i, c] of chapters.entries())
    await add(
      `OEBPS/c${i}.xhtml`,
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${lang}"><head><title>${esc(c.title)}</title>${css ? '<link rel="stylesheet" type="text/css" href="style.css"/>' : ''}</head><body>
<h1>${esc(c.title)}</h1>
${c.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('\n')}
</body></html>`,
    );
  if (cover) await add('OEBPS/cover.png', cover);
  if (css) await add('OEBPS/style.css', css);
  return zipFiles(files);
}

const filler = (n) =>
  Array.from(
    { length: n },
    (_, i) =>
      `Paragraph ${i + 1} wanders on for a while so that the page has to turn: the tide came in, the tide went out, and nobody on the quiet shore remembered which hour it was.`,
  );

const en = await epub({
  id: 'urn:uuid:11111111-1111-1111-1111-111111111111',
  title: 'The Lighthouse & the Sea',
  author: 'Ada Marlowe',
  lang: 'en',
  cover: png(60, 90, [200, 40, 40]),
  css: 'p { margin: 0 0 0.6em; }',
  chapters: [
    {
      title: 'Chapter One',
      paragraphs: [
        'The lighthouse keeper climbed the spiral stairs every evening. He carried a lamp, a flask of tea and a worn book.',
        ...filler(30),
      ],
    },
    {
      title: 'Chapter Two',
      paragraphs: ['A storm arrived without warning. The windows rattled and the sea turned the colour of slate.', ...filler(30)],
    },
    {
      title: 'Chapter Three',
      paragraphs: ['By morning the water was calm again. Gulls circled the tower, crying over the wreckage.', ...filler(30)],
    },
  ],
});
out('book-en.epub', en);
out('book-en-copy.epub', en); // same bytes, other name: must dedupe to one book
out('corrupt.epub', en.slice(0, Math.floor(en.length / 2)));
out('empty.epub', new Uint8Array(0));

out(
  'book-ja.epub',
  await epub({
    id: 'urn:uuid:22222222-2222-2222-2222-222222222222',
    title: '吾輩は猫である',
    author: '夏目漱石',
    lang: 'ja',
    cover: null,
    chapters: [
      {
        title: '第一章',
        paragraphs: [
          '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。',
          '何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。',
          ...Array.from({ length: 40 }, (_, i) => `第${i + 1}段落。猫は静かに縁側で日向ぼっこをしながら、庭の雀をじっと眺めていた。`),
        ],
      },
      {
        title: '第二章',
        paragraphs: [
          '吾輩はここで始めて人間というものを見た。',
          ...Array.from({ length: 40 }, (_, i) => `続き${i + 1}。主人は書斎で本を読みながら、いつの間にか居眠りをしている。`),
        ],
      },
    ],
  }),
);

// ---- PDF -----------------------------------------------------------------
function pdf({ title, author, pages, outline }) {
  const objs = []; // objs[i] is the body of object i+1
  const add = (body) => objs.push(body);
  const catalog = add(''),
    pagesObj = add(''),
    font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    info = add(`<< /Title (${title}) /Author (${author}) >>`);
  const pageIds = pages.map((lines) => {
    const text = lines.map((l, i) => `BT /F1 20 Tf 72 ${700 - i * 30} Td (${l}) Tj ET`).join('\n');
    const content = add(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
    return add(
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
    );
  });
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const first = objs.length + 1;
  const rootId = first + outline.length;
  outline.forEach((o, i) =>
    add(
      `<< /Title (${o.title}) /Parent ${rootId} 0 R ${i ? `/Prev ${first + i - 1} 0 R` : ''} ${
        i < outline.length - 1 ? `/Next ${first + i + 1} 0 R` : ''
      } /Dest [${pageIds[o.page - 1]} 0 R /Fit] >>`,
    ),
  );
  add(`<< /Type /Outlines /First ${first} 0 R /Last ${first + outline.length - 1} 0 R /Count ${outline.length} >>`);
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R /Outlines ${rootId} 0 R >>`;
  let s = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((b, i) => {
    offsets.push(s.length);
    s += `${i + 1} 0 obj\n${b}\nendobj\n`;
  });
  const xref = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  s += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(s, 'latin1');
}

const sample = pdf({
  title: 'Sample PDF Manual',
  author: 'Pat Doe',
  pages: [1, 2, 3, 4, 5, 6].map((n) => [`Page ${n} heading.`, `The harbour master counted ${n} ships and`, `wrote the number down.`]),
  outline: [
    { title: 'Start', page: 1 },
    { title: 'Second half', page: 4 },
  ],
});
out('sample.pdf', sample);
out('corrupt.pdf', sample.subarray(0, 120));
// ---- CBZ -----------------------------------------------------------------
// Flat-colour pages, stored out of order; the names test natural order (10 and 11 come after 4 in reading order).
const comicPage = (rgb) => png(60, 90, rgb);
const manga = zipFiles([
  ['1.png', comicPage([220, 40, 40])],
  ['2.png', comicPage([40, 180, 60])],
  ['3.png', comicPage([40, 80, 220])],
  ['10.png', comicPage([240, 220, 30])],
  ['11.png', comicPage([200, 40, 200])],
  ['4.png', comicPage([30, 200, 220])],
]);
out('manga.cbz', manga);
out('corrupt.cbz', manga.slice(0, Math.floor(manga.length / 2)));
out('no-pages.cbz', zipFiles([['ComicInfo.xml', '<ComicInfo/>'], ['readme.txt', 'no pictures in here']]));
console.log('fixtures written to', here);
