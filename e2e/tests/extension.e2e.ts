import { createRequire } from 'node:module';
import { test, surfaceOf } from '@e2e-dev/web';
import { expect } from 'e2e';
import { extensionEngine } from '../extension-engine.ts';
import { fixture, games } from '../fixtures.ts';

const require = createRequire(import.meta.url);
const { workerFor, extensionCommand } = require('../../service/browser.js');
const { solveGame } = require('../../service/runner.js');

for (const game of games) test(`${game}: panel request solve persists after reload with no board input`, async ({ browser }) => {
  const f = await fixture(browser, game);
  await browser.goto(`/games/${game}/`);
  await expect(browser.locator('.lls__status')).toHaveText('Ready to solve by request.');
  await expect(browser.locator('main a')).toHaveCount(0);
  await browser.locator('.lls__solve').click();
  await expect(browser.locator('.lls__status')).toHaveText('Solved by request. Verified after reload.');
  await expect(browser.locator('main a')).toHaveText('See results');
  expect(f.stats().saves).toBe(1);
  expect(f.stats().navigations).toBeGreaterThanOrEqual(2);
  if (!['pinpoint', 'crossclimb', 'mini-sudoku'].includes(game)) expect(f.stats().initialSaves).toBe(1);
  expect(await browser.evaluate(() => sessionStorage.getItem('fixtureBoardInput'))).toBe(null);
  // A second, explicit refresh proves the fixture server's state survives navigation.
  await browser.reload();
  await expect(browser.locator('main a')).toHaveText('See results');
  await expect(browser.locator('.lls__status')).toHaveText('This game is already completed.');
  await browser.locator('.lls__solve').click();
  expect(f.stats().saves).toBe(1);
});

test('guest board fails before a save', async ({ browser }) => {
  const f = await fixture(browser, 'pinpoint', { guest: true });
  await browser.goto('/games/pinpoint/');
  await browser.locator('.lls__solve').click();
  await expect(browser.locator('.lls__status')).toHaveText('Sign in to LinkedIn to save a completed game.');
  expect(f.stats().saves).toBe(0);
});

for (const game of ['pinpoint', 'tango'] as const) for (const mode of ['http-error', 'wrong-resource'] as const) {
  test(`${game}: ${mode} save cannot report success`, async ({ browser }) => {
    const f = await fixture(browser, game, { mode });
    await browser.goto(`/games/${game}/`);
    await browser.locator('.lls__solve').click();
    await expect(browser.locator('.lls__status')).toHaveText(mode === 'http-error'
      ? 'LinkedIn rejected the save: HTTP 403.'
      : game === 'pinpoint' ? "LinkedIn did not confirm this game's save." : 'Save response belongs to another game.');
    expect(f.stats().saves).toBe(1);
    expect(f.stats().navigations).toBe(1);
    expect(await browser.evaluate(() => sessionStorage.getItem('fixtureBoardInput'))).toBe(null);
  });
}

test('accepted request without persisted completion reports failure', async ({ browser }) => {
  const f = await fixture(browser, 'pinpoint', { mode: 'no-persistence' });
  await browser.goto('/games/pinpoint/');
  await browser.locator('.lls__solve').click();
  await expect(browser.locator('.lls__status')).toHaveText('Save was not confirmed after reload. No UI fallback was attempted.');
  expect(f.stats().saves).toBe(1);
  expect(f.stats().navigations).toBe(2);
});

test('stale native contract rejects another puzzle without a completed save', async ({ browser }) => {
  const f = await fixture(browser, 'zip', { staleContract: true });
  await browser.goto('/games/zip/');
  await browser.locator('.lls__solve').click();
  await expect(browser.locator('.lls__status')).toHaveText('Captured request belongs to another puzzle.');
  expect(f.stats().initialSaves).toBe(1);
  expect(f.stats().saves).toBe(0);
  expect(f.stats().navigations).toBe(1);
});

test('changed native hooks fail closed after exactly one recovery reload', async ({ browser }) => {
  const f = await fixture(browser, 'zip', { brokenNative: true });
  await browser.goto('/games/zip/');
  await browser.locator('.lls__solve').click();
  await expect(browser.locator('.lls__status')).toHaveText("LinkedIn's initial save request was not captured, even after reloading. No save was sent.");
  expect(f.stats().initialSaves).toBe(0);
  expect(f.stats().saves).toBe(0);
  expect(f.stats().navigations).toBe(2);
  expect(await browser.evaluate(() => sessionStorage.getItem('fixtureBoardInput'))).toBe(null);
});

test('hidden completed control does not skip an unsolved board', async ({ browser }) => {
  const f = await fixture(browser, 'pinpoint', { hiddenResults: true });
  await browser.goto('/games/pinpoint/');
  await expect(browser.locator('.lls__status')).toHaveText('Ready to solve by request.');
  await browser.locator('.lls__solve').click();
  await expect(browser.locator('.lls__status')).toHaveText('Solved by request. Verified after reload.');
  expect(f.stats().saves).toBe(1);
});

test('headless service uses actual extension messaging, verifies reload, and skips a completed board', async ({ browser }) => {
  const f = await fixture(browser, 'pinpoint');
  await browser.goto('/games/pinpoint/');
  const live = surfaceOf(extensionEngine)!;
  const context = live.context(), page = live.page();
  const worker = await workerFor(context);
  expect(worker.url()).toMatch(/chrome-extension:\/\/.+\/src\/background\.js$/);
  await expect(browser.locator('.lls__status')).toHaveText('Ready to solve by request.');
  const before = await extensionCommand(context, page, 'pinpoint', 'lls-service-state');
  expect(before.completed).toBe(false);
  const result = await solveGame(context, page, 'pinpoint', { timeoutMs: 15000 });
  expect(result.status).toBe('solved');
  expect(result.verified).toBe(true);
  expect(result.initiallyUnsolved).toBe(true);
  expect((await solveGame(context, page, 'pinpoint')).status).toBe('already_completed');
  expect(f.stats().saves).toBe(1);
  expect(await browser.evaluate(() => sessionStorage.getItem('fixtureBoardInput'))).toBe(null);
});

test('background diagnostic capture redacts credentials and survives worker restart', async ({ browser }) => {
  await fixture(browser, 'tango');
  await browser.goto('/games/tango/');
  await browser.locator('.lls__solve').click();
  await expect(browser.locator('.lls__status')).toHaveText('Solved by request. Verified after reload.');
  await browser.locator('summary').click();
  await browser.locator('.lls__diagnostics button').click();
  await expect(browser.locator('.lls__diagnostics pre')).toContainText('updateGameState');
  const capture = await browser.locator('.lls__diagnostics pre').textContent();
  expect(capture).not.toContain('fixture-secret');
  const live = surfaceOf(extensionEngine)!;
  const worker = await workerFor(live.context());
  const target = await live.context().newCDPSession(live.page());
  const { targetInfos } = await target.send('Target.getTargets');
  const info = targetInfos.find((t: any) => t.url === worker.url());
  expect(info).toBeDefined();
  await target.send('Target.closeTarget', { targetId: info.targetId });
  await target.detach();
  // Sending a real content-script message wakes the MV3 worker and reads its session mirror.
  await browser.locator('.lls__diagnostics button').click();
  await expect(browser.locator('.lls__diagnostics pre')).toContainText('updateGameState');
  expect(await browser.locator('.lls__diagnostics pre').textContent()).not.toContain('fixture-secret');
});
