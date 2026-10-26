// The desktop app's update offer, in a real browser with a stand-in for the native bridge (the two commands the Rust side
// answers: check_update and install_update). The Rust side itself is checked on the built app, not here.
// Run through e2e/run-annotations.mjs.
async (page, ctx = {}) => {
  const BASE = ctx.BASE ?? 'http://localhost:5199/';
  const results = [];
  const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
  const step = async (name, fn) => {
    try { results.push({ name, ok: true, note: (await fn()) ?? '' }); }
    catch (e) { results.push({ name, ok: false, note: String(e.message ?? e).split('\n')[0] }); }
  };
  const toastBox = () => page.locator('.release-toast');
  const calls = () => page.evaluate(() => window.__calls);

  // Before any page script runs: the bridge a Tauri webview has. A newer version exists; installing never returns (the
  // real installer closes the app) unless the page was told to fail it.
  await page.addInitScript(() => {
    window.__calls = [];
    window.__TAURI_INTERNALS__ = {
      invoke: async (command) => {
        window.__calls.push(command);
        if (command === 'check_update') return '9.9.9';
        if (command === 'take_opened_books') return [];
        if (command === 'install_update') {
          if (sessionStorage.getItem('failInstall')) throw new Error('boom');
          return new Promise(() => {});
        }
        return null;
      },
    };
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(BASE);
  await page.locator('.lib').waitFor();

  await step('a newer version is offered with one button that updates and restarts', async () => {
    await toastBox().waitFor();
    ok((await toastBox().textContent()).includes('Version 9.9.9 is available'), await toastBox().textContent());
    await toastBox().getByRole('button', { name: 'Update and restart', exact: true }).waitFor();
  });

  await step('pressing it starts the install once and says the app is updating', async () => {
    const go = toastBox().getByRole('button', { name: 'Update and restart', exact: true });
    await go.click();
    await page.waitForFunction(() => document.querySelector('.release-toast')?.textContent?.includes('Updating'));
    ok(await go.isDisabled(), 'the button can be pressed twice');
    ok((await calls()).filter((c) => c === 'install_update').length === 1, JSON.stringify(await calls()));
  });

  await step('when the install fails the offer comes back and an error says so', async () => {
    await page.evaluate(() => sessionStorage.setItem('failInstall', '1'));
    await page.reload();
    await page.locator('.lib').waitFor();
    const go = toastBox().getByRole('button', { name: 'Update and restart', exact: true });
    await go.waitFor();
    await go.click();
    await page.locator('.toast', { hasText: "Couldn't update" }).waitFor();
    ok(await go.isEnabled(), 'the button stays disabled after a failure');
    ok((await toastBox().textContent()).includes('Version 9.9.9 is available'), 'the message is still "updating"');
  });

  await step('Later puts the offer away', async () => {
    await toastBox().getByRole('button', { name: 'Later', exact: true }).click();
    ok((await toastBox().count()) === 0, 'still there');
  });

  const failed = results.filter((r) => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, results };
}
