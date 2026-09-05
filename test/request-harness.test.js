const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
test("capture correlates save responses and omits unrelated requests and credentials", async () => {
  let onEvent;
  const event = () => ({ addListener() {} });
  const context = vm.createContext({
    URL, console: { log() {} }, setTimeout: () => 1, clearTimeout() {},
    chrome: {
      runtime: { onMessage: event() }, tabs: { onRemoved: event(), onUpdated: event() },
      storage: { session: { set: async () => {}, get: async () => ({}) } },
      debugger: {
        onDetach: event(), onEvent: { addListener(fn) { onEvent = fn; } },
        sendCommand: async () => ({ body: '{"data":{"gameStoredRecord":{"gamePlayState":"END_SOLVED"}}}' }),
      },
    },
  });
  vm.runInContext(fs.readFileSync(require.resolve("../src/background.js"), "utf8"), context);
  const source = { tabId: 10 };
  await onEvent(source, "Network.requestWillBeSent", {
    requestId: "unrelated", request: { url: "https://www.linkedin.com/messaging", postData: '{"text":"private"}' },
  });
  await onEvent(source, "Network.requestWillBeSent", {
    requestId: "save", request: {
      method: "POST", url: "https://www.linkedin.com/voyager/api/graphql?queryId=test&token=secret",
      postData: '{"gameStoredRecord":{},"csrfToken":"secret","resourceKey":"urn:li:fsd_game:(123,1,857)"}',
    },
  });
  await onEvent(source, "Network.responseReceived", { requestId: "save", response: { status: 200 } });
  await onEvent(source, "Network.loadingFinished", { requestId: "save" });
  const log = await context.capturedRequests(10);
  assert.equal(log.length, 3);
  assert.ok(log.every((entry) => entry.requestId === "save"));
  assert.equal(log[1].status, 200);
  assert.match(log[2].postData, /END_SOLVED/);
  assert.doesNotMatch(JSON.stringify(log), /secret|private|123/);
});

