---
name: add-lookup-provider
description: Add or replace a translation or dictionary provider in src/lookup (a new free API, or fixing one that broke). Use when the weekly "Lookup provider check failed" issue appears, or the user asks to add a dictionary/translation source.
---

# Add a lookup provider

The lookup chain lives in `src/lookup/providers.ts` (translation: Chrome Translator -> Google gtx -> MyMemory) and `src/lookup/wiktionary.ts` (Spanish definitions). The app is a static site, so a provider must allow cross-origin browser requests.

1. **Verify it first, for real.** Make a real request from node and check the response header `access-control-allow-origin` is `*` (or echoes the origin). No CORS, no provider. Note the date you checked.
2. **Record a real payload** into `src/lookup/fixtures/` with `fixtures/capture.mjs` (URL and capture date in a comment). Tests parse recorded real responses, never hand-written ones, and never a mocked `fetch`.
3. **Test first** (`providers.test.ts` / `wiktionary.test.ts`): the parser turns the recorded payload into the shared shape, the URL builder matches the recorded URL, an empty/garbage payload yields "no answer" rather than a throw.
4. **Implement the parser and URL builder** as pure functions, then add the provider to the chain. Keep the 8 s `AbortSignal.timeout`; a hanging provider must never stall a lookup.
5. **Add a case to `providers.live.test.ts`** (opt-in, `LIVE=1`) that asks the real service and asserts the CORS header.
6. **Mutation check:** break the new parser (wrong field, dropped alternative) and confirm a test fails; revert.
7. Run `npx tsc --noEmit`, `npx vitest run`, `LIVE=1 npx vitest run src/lookup/providers.live.test.ts`, then credit the source and its licence in the README ("Tech stack and credits").

Do not cache third-party responses in the service worker: `src/pwa/policy.ts` leaves other origins alone, and `src/lookup/cache.ts` has its own capped cache.
