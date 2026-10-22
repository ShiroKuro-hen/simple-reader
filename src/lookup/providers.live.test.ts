// Opt-in smoke test against the real services: LIVE=1 npx vitest run src/lookup/providers.live.test.ts
// Its job is to tell us when a provider changes its format, CORS policy or goes away.
import { describe, expect, it } from 'vitest';
import { gtxUrl, myMemoryUrl, parseGtx, parseMyMemory, translate } from './providers';
import { extractOf, parseDefinitions, wiktionaryUrl } from './wiktionary';

const LIVE = !!(globalThis as any).process?.env?.LIVE;
const getJson = async (url: string) => {
  const res = await fetch(url, { headers: { Origin: 'https://reader.example' } });
  expect(res.status).toBe(200);
  // the app is a static site: without this header the browser would block the response
  expect(res.headers.get('access-control-allow-origin')).toMatch(/^(\*|https:\/\/reader\.example)$/);
  return res.json();
};

describe.skipIf(!LIVE)('live providers', () => {
  it('gtx translates English and Japanese into Spanish', async () => {
    expect(parseGtx(await getJson(gtxUrl('house', 'en'))).text).toBe('casa');
    expect(parseGtx(await getJson(gtxUrl('猫', 'ja'))).text).toBe('gato');
  });

  it('MyMemory answers in a shape we can parse', async () => {
    const t = parseMyMemory(await getJson(myMemoryUrl('猫', 'ja')));
    expect(t.text).toBeTruthy();
  });

  it('es.wiktionary still has the Spanish sections we parse', async () => {
    const casa = extractOf(await getJson(wiktionaryUrl('casa')));
    expect(parseDefinitions(casa, 'Español')[0]).toBe('Edificación destinada a vivienda.');
    const dog = extractOf(await getJson(wiktionaryUrl('dog')));
    expect(parseDefinitions(dog, 'Inglés')[0]).toBe('Perro.');
  });

  it('translate() end to end', async () => {
    const t = await translate('hello', 'en');
    expect(t.text.length).toBeGreaterThan(0);
    expect(t.provider).toBeTruthy();
  });
});
