"use strict";

const attachedTabs = new Set();
const attachPromises = new Map();
const inputTabs = new Set();
const inputTimers = new Map();
const captureTabs = new Set();
const captureTimers = new Map();
const captureDocuments = new Map();
const puzzleRoutes = new Map();
const pageScanTimes = new Map();
const pendingPuzzleResponses = new Map();
const puzzleSources = new Map();

function puzzleRoute(url) {
  const match = String(url || "").match(/^https:\/\/www\.linkedin\.com\/games\/(?:view\/)?([^/?#]+)/);
  return match?.[1] || "";
}

function syncPuzzleRoute(tabId, url) {
  const route = puzzleRoute(url);
  if (!route) return;
  const previous = puzzleRoutes.get(tabId);
  if (previous && previous !== route) {
    puzzleSources.delete(tabId);
    pendingPuzzleResponses.delete(tabId);
    pageScanTimes.delete(tabId);
  }
  puzzleRoutes.set(tabId, route);
}

function capturePagePuzzleSource() {
  const reactKeyPattern = /^__react(?:Props|Fiber)\$/;
  const gamePuzzleKeyPattern = /blueprintGamePuzzle|pinpointGamePuzzle|crossClimbGamePuzzle|wendGamePuzzle|solutionWords|puzzleLetters|rungs/;
  const answerKeyPattern = /solutions?|answer|category/;
  const clueKeyPattern = /clues?/;
  const puzzleSourcePattern = /blueprintGamePuzzle|pinpointGamePuzzle|crossClimbGamePuzzle|wendGamePuzzle|"solutions?"\s*:|"answer"\s*:|solutionWords|puzzleLetters|rungs/;
  const seen = new Set();
  const puzzles = new Set();
  let inspected = 0;

  function entriesFor(value) {
    try {
      return Object.entries(value);
    } catch {
      return [];
    }
  }

  function containsPuzzleKey(value) {
    const keys = entriesFor(value).map(([key]) => key);
    return keys.some((key) => gamePuzzleKeyPattern.test(key))
      || (keys.some((key) => answerKeyPattern.test(key)) && keys.some((key) => clueKeyPattern.test(key)));
  }

  function findReactPuzzles(value, depth = 0) {
    if (!value || typeof value !== "object" || value instanceof Node || depth > 48 || seen.has(value) || inspected >= 25000) return;
    seen.add(value);
    inspected += 1;

    const candidates = [value, value.game?.puzzle, value.props?.game?.puzzle, value.puzzle];
    for (const candidate of candidates) {
      if (containsPuzzleKey(candidate)) puzzles.add(candidate);
    }

    for (const [key, child] of entriesFor(value)) {
      if (child instanceof Node) continue;
      if (depth < 12 || /child|sibling|return|props|state|game|puzzle|solution|clue|category/i.test(key)) {
        findReactPuzzles(child, depth + 1);
      }
      if (puzzles.size >= 12 || inspected >= 25000) return;
    }
  }

  const main = document.querySelector("main");
  const pageElements = [...(main?.querySelectorAll("*") || [])].slice(0, 1500);
  const roots = [main, ...pageElements, document.body, document.documentElement].filter(Boolean);
  // React props attached to the game controls are much closer to the puzzle
  // payload than the root fiber. Inspect those first so a large LinkedIn app
  // tree cannot exhaust the traversal budget before we reach the game data.
  for (const kind of ["Props", "Fiber"]) {
    for (const root of roots) {
      for (const key of Object.keys(root)) {
        if (!reactKeyPattern.test(key) || !key.startsWith(`__react${kind}$`)) continue;
        findReactPuzzles(root[key]);
        if (puzzles.size >= 12 || inspected >= 25000) break;
      }
      if (puzzles.size >= 12 || inspected >= 25000) break;
    }
    if (puzzles.size >= 12 || inspected >= 25000) break;
  }

  const serializedPuzzles = [];
  let totalLength = 0;
  for (const puzzle of puzzles) {
    try {
      const serialized = JSON.stringify(puzzle);
      if (!serialized || !puzzleSourcePattern.test(serialized) || serialized.length > 4 * 1024 * 1024) continue;
      if (totalLength + serialized.length > 4 * 1024 * 1024) break;
      serializedPuzzles.push(serialized);
      totalLength += serialized.length;
    } catch {
      // Ignore non-serializable framework objects and keep looking.
    }
  }
  return serializedPuzzles.join("\n");
}

function clearTimer(timers, tabId) {
  const timer = timers.get(tabId);
  if (timer) clearTimeout(timer);
  timers.delete(tabId);
}

async function ensureAttached(tabId) {
  if (attachedTabs.has(tabId)) return;
  if (!attachPromises.has(tabId)) {
    const pending = chrome.debugger.attach({ tabId }, "1.3").then(() => {
      attachedTabs.add(tabId);
    }).finally(() => {
      attachPromises.delete(tabId);
    });
    attachPromises.set(tabId, pending);
  }
  await attachPromises.get(tabId);
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
  try {
    await attachPromises.get(tabId);
  } catch {
    // A failed attachment needs no matching detach.
  }
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
  }, 15000));
}

async function startCapture(tabId, documentId, url) {
  syncPuzzleRoute(tabId, url);
  const previousDocument = captureDocuments.get(tabId);
  if (previousDocument && previousDocument !== documentId) {
    captureDocuments.set(tabId, documentId);
    puzzleSources.delete(tabId);
  } else if (!previousDocument) {
    // onUpdated can capture the puzzle response before the content script
    // announces its document. Preserve that early response on first attach.
    captureDocuments.set(tabId, documentId);
  }
  await primeCapture(tabId, url);
}

async function primeCapture(tabId, url) {
  syncPuzzleRoute(tabId, url);
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
  if (!/(blueprintGamePuzzle|pinpointGamePuzzle|crossClimbGamePuzzle|wendGamePuzzle|"solutions?"\s*:|"answer"\s*:|solutionWords|puzzleLetters|rungs)/.test(text)) return;
  const cutoff = Date.now() - 15 * 60 * 1000;
  const entries = (puzzleSources.get(tabId) || []).filter((entry) => entry.capturedAt >= cutoff);
  if (!entries.some((entry) => entry.text === text)) entries.push({ text, capturedAt: Date.now() });
  while (entries.length > 6 || entries.reduce((total, entry) => total + entry.text.length, 0) > 12 * 1024 * 1024) entries.shift();
  puzzleSources.set(tabId, entries);
}

async function handleMessage(message, sender) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) throw new Error("The solver could not identify this tab.");

  if (message?.type === "lls-capture-start") {
    await startCapture(tabId, sender.documentId || `${sender.frameId || 0}:${sender.url || ""}`, sender.url);
    return { ok: true };
  }

  if (message?.type === "lls-puzzle-sources") {
    syncPuzzleRoute(tabId, sender.url);
    try {
      const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
      const response = await chrome.tabs.sendMessage(tabId, { type: "lls-bootstrap-sources" }, { frameId });
      for (const source of response?.sources || []) rememberPuzzleSource(tabId, source);
    } catch {
      // Network-captured data remains available when the top frame has navigated.
    }
    const lastPageScan = pageScanTimes.get(tabId) || 0;
    if (Date.now() - lastPageScan >= 750) {
      pageScanTimes.set(tabId, Date.now());
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
    }
    const cutoff = Date.now() - 15 * 60 * 1000;
    const sources = (puzzleSources.get(tabId) || []).filter((entry) => entry.capturedAt >= cutoff);
    if (sources.length) puzzleSources.set(tabId, sources);
    else puzzleSources.delete(tabId);
    return { ok: true, sources: sources.map((entry) => entry.text) };
  }

  if (message?.type === "lls-puzzle-source") {
    syncPuzzleRoute(tabId, sender.url);
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
    const events = Array.isArray(message.events) ? message.events : [];
    if (!events.length || events.length > 500) throw new Error("Chrome received an invalid puzzle mouse sequence.");
    await ensureAttached(tabId);
    inputTabs.add(tabId);
    armInputSafety(tabId);
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
    armInputSafety(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Input.insertText", {
      text: String(message.text || ""),
    });
    armInputSafety(tabId);
    return { ok: true };
  }

  if (message?.type === "lls-input-key") {
    await ensureAttached(tabId);
    inputTabs.add(tabId);
    armInputSafety(tabId);
    await dispatchKey(tabId, message);
    armInputSafety(tabId);
    return { ok: true };
  }

  if (message?.type === "lls-input-keys") {
    const keys = Array.isArray(message.keys) ? message.keys : [];
    if (!keys.length || keys.length > 500) throw new Error("Chrome received an invalid puzzle key sequence.");
    await ensureAttached(tabId);
    inputTabs.add(tabId);
    armInputSafety(tabId);
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
    attachPromises.delete(source.tabId);
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
    const mimeType = params?.response?.mimeType || "";
    if (!/^https:\/\/www\.linkedin\.com\/(?:voyager\/api\/|games\/api\/)/.test(url) || !/json/i.test(mimeType)) return;
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
  puzzleRoutes.delete(tabId);
  pageScanTimes.delete(tabId);
  puzzleSources.delete(tabId);
  void forceDetach(tabId);
});

chrome.tabs?.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  if (/^https:\/\/www\.linkedin\.com\/games\//.test(changeInfo.url)) {
    syncPuzzleRoute(tabId, changeInfo.url);
    if (/^https:\/\/www\.linkedin\.com\/games\/(?:view\/)?(?:pinpoint|crossclimb|wend)(?:\/|[?#]|$)/.test(changeInfo.url)) {
      // Prime Network capture on the route transition instead of waiting for
      // the content script. On a cold service worker, that delay can miss the
      // one response containing Pinpoint or Crossclimb answers.
      void primeCapture(tabId, changeInfo.url).catch(() => {
        // React props and bootstrap scripts remain available as fallbacks.
      });
    }
    return;
  }
  captureDocuments.delete(tabId);
  puzzleRoutes.delete(tabId);
  pageScanTimes.delete(tabId);
  puzzleSources.delete(tabId);
  void forceDetach(tabId);
});
