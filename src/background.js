"use strict";

const attachedTabs = new Set();
const inputTabs = new Set();
const inputTimers = new Map();
const captureTabs = new Set();
const captureTimers = new Map();
const captureDocuments = new Map();
const pendingPuzzleResponses = new Map();
const puzzleSources = new Map();

function capturePagePuzzleSource() {
  const reactKeyPattern = /^__react(?:Props|Fiber)\$/;
  const puzzleKeyPattern = /blueprintGamePuzzle|crossClimbGamePuzzle|wendGamePuzzle|solutionWords|puzzleLetters|rungs/;
  const seen = new Set();

  function entriesFor(value) {
    try {
      return Object.entries(value);
    } catch {
      return [];
    }
  }

  function containsPuzzleKey(value) {
    return entriesFor(value).some(([key]) => puzzleKeyPattern.test(key));
  }

  function findReactPuzzle(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 24 || seen.has(value)) return null;
    seen.add(value);

    const candidates = [value.game?.puzzle, value.props?.game?.puzzle, value.puzzle];
    for (const candidate of candidates) {
      if (containsPuzzleKey(candidate)) return candidate;
    }

    for (const [, child] of entriesFor(value)) {
      const puzzle = findReactPuzzle(child, depth + 1);
      if (puzzle) return puzzle;
    }
    return null;
  }

  const roots = [document.querySelector("main"), document.body].filter(Boolean);
  for (const root of roots) {
    for (const key of Object.keys(root)) {
      if (!reactKeyPattern.test(key)) continue;
      const puzzle = findReactPuzzle(root[key]);
      if (!puzzle) continue;
      try {
        const serialized = JSON.stringify(puzzle);
        if (serialized && puzzleKeyPattern.test(serialized)) return serialized;
      } catch {
        // Ignore non-serializable framework objects and keep looking.
      }
    }
  }
  return "";
}

function clearTimer(timers, tabId) {
  const timer = timers.get(tabId);
  if (timer) clearTimeout(timer);
  timers.delete(tabId);
}

async function ensureAttached(tabId) {
  if (attachedTabs.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, "1.3");
  attachedTabs.add(tabId);
}

function inputInterval(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
}

function waitForInput(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function dispatchMouseEvent(tabId, event) {
  const { eventType, x, y, button = "none", buttons = 0, clickCount = 0 } = event || {};
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: eventType,
    x,
    y,
    button,
    buttons,
    clickCount,
  });
}

async function dispatchKey(tabId, keyEvent) {
  const { key, code, keyCode = 0, modifiers = 0 } = keyEvent || {};
  const common = {
    key,
    code,
    modifiers,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  };
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    ...common,
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyUp",
    ...common,
  });
}

async function detachIfIdle(tabId) {
  if (inputTabs.has(tabId) || captureTabs.has(tabId)) return;
  if (!attachedTabs.has(tabId)) return;
  attachedTabs.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // The tab may have closed or navigated while the solve was finishing.
  }
}

async function forceDetach(tabId) {
  inputTabs.delete(tabId);
  captureTabs.delete(tabId);
  clearTimer(inputTimers, tabId);
  clearTimer(captureTimers, tabId);
  pendingPuzzleResponses.delete(tabId);
  await detachIfIdle(tabId);
}

function armInputSafety(tabId) {
  clearTimer(inputTimers, tabId);
  inputTimers.set(tabId, setTimeout(() => {
    inputTabs.delete(tabId);
    inputTimers.delete(tabId);
    void detachIfIdle(tabId);
  }, 30000));
}

function armCaptureStop(tabId) {
  clearTimer(captureTimers, tabId);
  captureTimers.set(tabId, setTimeout(() => {
    captureTabs.delete(tabId);
    captureTimers.delete(tabId);
    pendingPuzzleResponses.delete(tabId);
    void detachIfIdle(tabId);
  }, 8000));
}

async function startCapture(tabId, documentId) {
  if (captureDocuments.get(tabId) !== documentId) {
    captureDocuments.set(tabId, documentId);
    puzzleSources.delete(tabId);
  }
  await ensureAttached(tabId);
  captureTabs.add(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, "Network.enable", {
      maxResourceBufferSize: 4 * 1024 * 1024,
      maxTotalBufferSize: 8 * 1024 * 1024,
    });
    armCaptureStop(tabId);
  } catch (error) {
    captureTabs.delete(tabId);
    pendingPuzzleResponses.delete(tabId);
    await detachIfIdle(tabId);
    throw error;
  }
}

function rememberPuzzleSource(tabId, text) {
  if (typeof text !== "string" || text.length > 4 * 1024 * 1024) return;
  if (!/(blueprintGamePuzzle|crossClimbGamePuzzle|wendGamePuzzle|solutionWords|puzzleLetters)/.test(text)) return;
  const entries = puzzleSources.get(tabId) || [];
  if (!entries.some((entry) => entry.text === text)) entries.push({ text, capturedAt: Date.now() });
  puzzleSources.set(tabId, entries.slice(-6));
}

async function handleMessage(message, sender) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) throw new Error("The solver could not identify this tab.");

  if (message?.type === "lls-capture-start") {
    await startCapture(tabId, sender.documentId || `${sender.frameId || 0}:${sender.url || ""}`);
    return { ok: true };
  }

  if (message?.type === "lls-puzzle-sources") {
    try {
      const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
      const response = await chrome.tabs.sendMessage(tabId, { type: "lls-bootstrap-sources" }, { frameId });
      for (const source of response?.sources || []) rememberPuzzleSource(tabId, source);
    } catch {
      // Network-captured data remains available when the top frame has navigated.
    }
    try {
      const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
      const results = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        world: "MAIN",
        func: capturePagePuzzleSource,
      });
      for (const result of results || []) rememberPuzzleSource(tabId, result.result);
    } catch {
      // React's page-world props are an optional fallback; captured responses still work.
    }
    const cutoff = Date.now() - 15 * 60 * 1000;
    const sources = (puzzleSources.get(tabId) || []).filter((entry) => entry.capturedAt >= cutoff);
    puzzleSources.set(tabId, sources);
    return { ok: true, sources: sources.map((entry) => entry.text) };
  }

  if (message?.type === "lls-puzzle-source") {
    rememberPuzzleSource(tabId, message.text);
    return { ok: true };
  }

  if (message?.type === "lls-input-start") {
    await ensureAttached(tabId);
    inputTabs.add(tabId);
    armInputSafety(tabId);
    return { ok: true };
  }

  if (message?.type === "lls-input-stop") {
    inputTabs.delete(tabId);
    clearTimer(inputTimers, tabId);
    await detachIfIdle(tabId);
    return { ok: true };
  }

  if (message?.type === "lls-input-events") {
    await ensureAttached(tabId);
    inputTabs.add(tabId);
    const events = Array.isArray(message.events) ? message.events : [];
    if (!events.length || events.length > 500) throw new Error("Chrome received an invalid puzzle mouse sequence.");
    const intervalMs = inputInterval(message.intervalMs);
    for (let index = 0; index < events.length; index += 1) {
      await dispatchMouseEvent(tabId, events[index]);
      if (index < events.length - 1) await waitForInput(intervalMs);
    }
    armInputSafety(tabId);
    return { ok: true };
  }

  if (message?.type === "lls-input-text") {
    await ensureAttached(tabId);
    inputTabs.add(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Input.insertText", {
      text: String(message.text || ""),
    });
    armInputSafety(tabId);
    return { ok: true };
  }

  if (message?.type === "lls-input-key") {
    await ensureAttached(tabId);
    inputTabs.add(tabId);
    await dispatchKey(tabId, message);
    armInputSafety(tabId);
    return { ok: true };
  }

  if (message?.type === "lls-input-keys") {
    await ensureAttached(tabId);
    inputTabs.add(tabId);
    const keys = Array.isArray(message.keys) ? message.keys : [];
    if (!keys.length || keys.length > 500) throw new Error("Chrome received an invalid puzzle key sequence.");
    const intervalMs = inputInterval(message.intervalMs);
    for (let index = 0; index < keys.length; index += 1) {
      await dispatchKey(tabId, keys[index]);
      if (index < keys.length - 1) await waitForInput(intervalMs);
    }
    armInputSafety(tabId);
    return { ok: true };
  }

  return { ok: false };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse, (error) =>
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
  return true;
});

chrome.debugger.onDetach.addListener((source) => {
  if (Number.isInteger(source.tabId)) {
    attachedTabs.delete(source.tabId);
    inputTabs.delete(source.tabId);
    captureTabs.delete(source.tabId);
    clearTimer(inputTimers, source.tabId);
    clearTimer(captureTimers, source.tabId);
    pendingPuzzleResponses.delete(source.tabId);
  }
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (!Number.isInteger(tabId) || !captureTabs.has(tabId)) return;

  if (method === "Network.responseReceived") {
    const url = params?.response?.url || "";
    if (!url.startsWith("https://www.linkedin.com/voyager/api/graphql")) return;
    if (!pendingPuzzleResponses.has(tabId)) pendingPuzzleResponses.set(tabId, new Set());
    pendingPuzzleResponses.get(tabId).add(params.requestId);
    return;
  }

  if (method !== "Network.loadingFinished") return;
  const pending = pendingPuzzleResponses.get(tabId);
  if (!pending?.has(params.requestId)) return;
  pending.delete(params.requestId);
  void chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", { requestId: params.requestId }).then((response) => {
    let body = response.body || "";
    if (response.base64Encoded) {
      const bytes = Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
      body = new TextDecoder().decode(bytes);
    }
    rememberPuzzleSource(tabId, body);
  }).catch(() => {
    // A navigation can discard a response before Chrome returns its body.
  });
});

chrome.tabs?.onRemoved.addListener((tabId) => {
  captureDocuments.delete(tabId);
  puzzleSources.delete(tabId);
  void forceDetach(tabId);
});
