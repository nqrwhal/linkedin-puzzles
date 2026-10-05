const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const content = fs.readFileSync(require.resolve('../src/content.js'), 'utf8');

function page(storage, { template = null, game = {}, path = '/games/wend/', unresponsive = false, embedded = false } = {}) {
  const status = { dataset: {} };
  const button = { addEventListener(_name, handler) { this.click = handler; } };
  const nodes = { '.lls__status': status, '.lls__solve': button, '.lls__title': {},
    '.lls__diagnostics button': { addEventListener() {} } };
  const panel = { setAttribute() {}, querySelector: key => nodes[key] };
  const state = { reloads: 0, saves: 0, won: false };
  const location = { pathname: path, href: 'https://www.linkedin.com' + path,
    reload() { state.reloads++; } };
  let serviceMessage;
  const context = vm.createContext({
    window: {}, location, Date, AbortSignal, getComputedStyle: () => ({ visibility: 'visible' }),
    sessionStorage: { getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: { cookie: 'JSESSIONID="test"', createElement: () => panel,
      documentElement: { appendChild() { panel.isConnected = true; } }, querySelector: () => null,
      querySelectorAll: selector => embedded
        ? (selector === 'iframe' ? [{ getClientRects: () => [1], contentDocument: { querySelectorAll: inner => inner === 'a,button' && state.won
          ? [{ textContent: 'See results', closest: () => null, getClientRects: () => [1] }] : [] } }] : [])
        : selector === 'a,button' && state.won ? [{ textContent: 'See results', closest: () => null, getClientRects: () => [1] }] : [] },
    chrome: { runtime: { id: 'test-extension', onMessage: { addListener(fn) { serviceMessage = fn; } }, getManifest: () => ({ version: 'test' }),
      sendMessage: async ({ type }) => unresponsive ? new Promise(() => {}) : type === 'lls-request-context'
        ? { ok: true, game, template } : { ok: true } } },
    LinkedInGameRequests: { wendSave: () => ({}), sduiResponse: () => '/games/wend/results/' },
    fetch: async () => { state.saves++; return { ok: true, text: async () => 'accepted' }; },
    setTimeout: fn => setImmediate(fn), clearTimeout: clearImmediate, setInterval() {}, clearInterval() {}, addEventListener() {},
  });
  vm.runInContext(content, context);
  return { state, status, button, panel, context, serviceMessage };
}
async function settle() { for (let i = 0; i < 150; i++) await new Promise(setImmediate); }

test('missing native contract reloads once, resumes save, then verifies persisted completion', async () => {
  const storage = new Map();
  const first = page(storage);
  first.button.click();
  await settle();
  assert.equal(first.state.reloads, 1);
  assert.equal(first.state.saves, 0);
  assert.ok(storage.has('llsRequestRecovery'));
  const second = page(storage, { template: {} });
  await settle();
  assert.equal(second.state.saves, 1);
  assert.equal(second.state.reloads, 1);
  assert.ok(storage.has('llsPendingRequest'));
  const third = page(storage);
  third.state.won = true;
  await settle();
  assert.equal(third.status.textContent, 'Solved by request. Verified after reload.');
  assert.equal(third.state.saves, 0);
});
test('recovery stops after one reload when the native contract remains absent', async () => {
  const storage = new Map([['llsRequestRecovery', JSON.stringify({ game: 'wend', path: '/games/wend/', savedAt: Date.now() })]]);
  const current = page(storage);
  await settle();
  assert.equal(current.state.reloads, 0);
  assert.equal(current.state.saves, 0);
  assert.match(current.status.textContent, /even after reloading/);
});
test('recovery cannot resume on another game or from an expired marker', async () => {
  for (const savedAt of [Date.now(), Date.now() - 180000]) {
    const storage = new Map([['llsRequestRecovery', JSON.stringify({ game: 'wend', path: '/games/wend/', savedAt })]]);
    const current = page(storage, { path: savedAt < Date.now() - 120000 ? '/games/wend/' : '/games/queens/' });
    await settle();
    assert.equal(current.state.reloads, 0);
    assert.equal(current.state.saves, 0);
    assert.equal(storage.has('llsRequestRecovery'), false);
  }
});

test('an unresponsive extension produces an actionable error and re-enables Solve', async () => {
  const current = page(new Map(), { unresponsive: true });
  current.button.click();
  await settle();
  assert.match(current.status.textContent, /taking too long/);
  assert.equal(current.button.disabled, false);
  assert.equal(current.state.saves, 0);
});

test('persisted completion is recognized inside LinkedIn’s same-origin preload frame', async () => {
  const storage = new Map([['llsPendingRequest', JSON.stringify({ game: 'wend', path: '/games/wend/', savedAt: Date.now() })]]);
  const current = page(storage, { embedded: true });
  current.state.won = true;
  await settle();
  assert.equal(current.status.textContent, 'Solved by request. Verified after reload.');
  assert.equal(current.state.saves, 0);
});

test('reinjection restores a detached panel without duplicating it', () => {
  const current = page(new Map());
  current.panel.isConnected = false;
  vm.runInContext(content, current.context);
  assert.equal(current.panel.isConnected, true);
  assert.equal(current.state.reloads, 0);
  assert.equal(current.state.saves, 0);
});

test('service control accepts only this extension and the matching game', async () => {
  const current = page(new Map(), { template: {} });
  let replies = 0;
  const respond = () => replies++;
  current.serviceMessage({ type: 'lls-service-solve', game: 'wend' }, { id: 'other-extension' }, respond);
  current.serviceMessage({ type: 'lls-service-solve', game: 'queens' }, { id: 'test-extension' }, respond);
  await settle();
  assert.equal(replies, 0);
  assert.equal(current.state.saves, 0);
  current.serviceMessage({ type: 'lls-service-solve', game: 'wend' }, { id: 'test-extension' }, respond);
  await settle();
  assert.equal(replies, 1);
  assert.equal(current.state.saves, 1);
});
