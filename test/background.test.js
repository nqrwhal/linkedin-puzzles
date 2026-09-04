const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("input releases the debugger while word-game capture retains answers", async () => {
  let onEvent;
  const detached = [];
  const writes = [];
  const event = () => ({ addListener() {} });
  const context = vm.createContext({
    console: { log() {} },
    setTimeout: () => 1,
    clearTimeout() {},
    chrome: {
      runtime: { onMessage: event() },
      tabs: { onRemoved: event(), onUpdated: event() },
      storage: { session: {
        get: async () => ({}),
        set: async (value) => { writes.push(value); },
      } },
      debugger: {
        attach: async () => {},
        detach: async ({ tabId }) => { detached.push(tabId); },
        sendCommand: async (_target, method) => method === "Network.getResponseBody"
          ? { body: '{"pinpointGamePuzzle":{"solutions":["category"]}}' } : {},
        onDetach: event(),
        onEvent: { addListener(listener) { onEvent = listener; } },
      },
    },
  });
  vm.runInContext(fs.readFileSync(require.resolve("../src/background.js"), "utf8"), context);
  const send = (type, tabId) => context.handleMessage({ type }, {
    tab: { id: tabId }, url: 'https://www.linkedin.com/games/pinpoint/',
  });
  const response = (tabId) => onEvent({ tabId }, "Network.responseReceived", {
    requestId: "puzzle", response: { url: "https://www.linkedin.com/puzzle", mimeType: "application/json" },
  });

  await send("lls-input-start", 1);
  await onEvent({ tabId: 1 }, "Network.requestWillBeSent", {
    request: { url: "https://www.linkedin.com/voyager/api/graphql?queryId=observed", postData: '{"gameStoredRecord":{}}' },
  });
  assert.equal((await send("lls-game-query-id", 1)).queryId, "observed");
  assert.equal(writes.length, 0, "query observation must not store requests");
  await response(1);
  await send("lls-input-stop", 1);
  assert.deepEqual(detached, [1], "input responses must not extend the capture lease");

  await send("lls-capture-start", 2);
  await send("lls-input-start", 2);
  await response(2);
  await onEvent({ tabId: 2 }, "Network.loadingFinished", { requestId: "puzzle" });
  await send("lls-input-stop", 2);
  assert.deepEqual(detached, [1], "word-game capture must survive input completion");
  assert.ok(writes.some((value) => value.llsPuzzleState?.sources[2]?.[0].text.includes("category")));
  await context.forceDetach(2);
  assert.deepEqual(detached, [1, 2]);
});
