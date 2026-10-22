// Runs against the real shipped dictionary file (public/dict/jmdict.json.gz).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Jmdict, findEntry, parseJmdict } from './jmdict';

const file = readFileSync(fileURLToPath(new URL('../../public/dict/jmdict.json.gz', import.meta.url)));
let dict: Jmdict;
beforeAll(async () => {
  dict = await parseJmdict(new Uint8Array(file));
}, 60_000);

describe('parseJmdict', () => {
  it('accepts the gzip file as shipped and also an already-decompressed body', async () => {
    const unzipped = await new Response(new Blob([file as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const plain = await parseJmdict(new Uint8Array(unzipped));
    expect(findEntry(plain, [{ form: '猫' }])).toEqual(findEntry(dict, [{ form: '猫' }]));
  });

  it('rejects something that is not a dictionary', async () => {
    await expect(parseJmdict(new TextEncoder().encode('<html>404</html>'))).rejects.toThrow();
  });
});

describe('findEntry', () => {
  it('gives Spanish glosses when JMdict has them', () => {
    const e = findEntry(dict, [{ form: '猫' }])!;
    expect(e.reading).toBe('ねこ');
    expect(e.es[0]).toBe('gato');
    expect(e.en.join(' ')).toContain('cat');
  });

  it('finds an entry through its kana form too', () => {
    expect(findEntry(dict, [{ form: 'ねこ' }])?.es[0]).toBe('gato');
  });

  it('uses the reading to choose between homographs', () => {
    expect(findEntry(dict, [{ form: '日', reading: 'ひ' }])?.reading).toBe('ひ');
    expect(findEntry(dict, [{ form: '日', reading: 'にち' }])?.reading).toBe('にち');
    expect(findEntry(dict, [{ form: '生', reading: 'なま' }])?.reading).toBe('なま');
  });

  it('prefers a common entry when the reading says nothing', () => {
    const e = findEntry(dict, [{ form: '日' }])!;
    expect(e.common).toBe(true);
  });

  it('prefers the common sense over a rarer one that happens to have Spanish glosses', () => {
    const e = findEntry(dict, [{ form: 'ぎりぎり' }])!;
    expect(e.common).toBe(true);
    expect(e.en[0]).toContain('barely');
  });

  it('tries candidates in order and skips the ones that are not in the dictionary', () => {
    const e = findEntry(dict, [{ form: '食べました' }, { form: '食べる', reading: 'たべる' }])!;
    expect(e.reading).toBe('たべる');
  });

  it('returns undefined for unknown text', () => {
    expect(findEntry(dict, [{ form: 'ぬぬぬぬぬ' }, { form: '' }])).toBeUndefined();
  });

  it('has English-only entries, where Spanish is missing', () => {
    const forms = Object.keys(dict);
    expect(forms.length).toBeGreaterThan(50_000);
    const englishOnly = forms.map((f) => findEntry(dict, [{ form: f }])!).find((e) => e.es.length === 0 && e.en.length > 0);
    expect(englishOnly).toBeDefined();
  });
});
