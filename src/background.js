"use strict";

const attachedTabs = new Set();
const attachPromises = new Map();
const captureTabs = new Set();
const captureTimers = new Map();
const puzzleRoutes = new Map();
const pageScanTimes = new Map();
const pendingPuzzleResponses = new Map();
const puzzleSources = new Map();

// Word-game puzzle payloads arrive once per navigation and are absent from
// the rendered DOM, so network capture stays attached for the whole word-game
// visit instead of a short window that can miss the response.
const CAPTURE_LEASE_MS = 15 * 60 * 1000;
const MAX_PERSISTED_SOURCE_CHARS = 6 * 1024 * 1024;

// The games save mutation's query id rotates with LinkedIn's build; any
// observed save overrides this shipped default in memory for the session.
const DEFAULT_GAME_QUERY_ID = "voyagerIdentityDashGames.f8508525e36bee5f9a5ab6b637854d87";
let observedGameQueryId = null;

// Retain only game-save protocol evidence, without request headers or cookies.
const sessionCapture = new Map();
const pendingSaveResponses = new Map();
const saveContracts = new Map();
const previousCapture = new Map();
const CAPTURE_LOG_PREFIX = "llsReqLog";
const PREVIOUS_CAPTURE_PREFIX = "llsReqLogPrev";

function redactCapture(text) {
  return String(text || "")
    .replace(/urn:li:fsd_game:\([^,]+,/g, "urn:li:fsd_game:(<member>,")
    .replace(/ajax:\d+/g, "<csrf>")
    .replace(/("(?:[^"]*(?:token|cookie|authorization|password|secret)[^"]*)"\s*:\s*)"[^"]*"/gi, '$1"<redacted>"');
}

function safeCapturedRequests(log) {
  return log.filter((entry) => /gameStoredRecord|updateGameState|fsd_game/.test(entry.postData || "")
    || entry.method === "SAVE-RESPONSE").map((entry) => ({
      ...entry, postData: redactCapture(entry.postData),
    }));
}

function capturePageGame(gameName) {
  const selectors = { queens: "#queens-game-board", tango: "#tango-cell-0", zip: "[data-cell-idx]", patches: "[data-cell-idx]", wend: "[data-game-content-root]" };
  if (!selectors[gameName]) return null;
  const board = document.querySelector(selectors[gameName]);
  if (!board) return null;
  let fiber = board[Object.keys(board).find((key) => key.startsWith("__reactFiber$"))];
  for (let depth = 0; fiber && depth < 20; depth += 1, fiber = fiber.return) {
    const game = fiber.memoizedProps?.game;
    if (game?.gameUrn && game?.puzzle) {
      return JSON.parse(JSON.stringify(game, (_key, value) => typeof value === "bigint" ? String(value) : value));
    }
  }
  return null;
}

function recordSessionRequest(tabId, entry) {
  const log = sessionCapture.get(tabId) || [];
  log.push({ capturedAt: Date.now(), ...entry });
  while (log.length > 800 || JSON.stringify(log).length > 1024 * 1024) log.shift();
  sessionCapture.set(tabId, log);
  chrome.storage.session?.set({ [`${CAPTURE_LOG_PREFIX}${tabId}`]: log }).catch(() => {
    // Losing the mirror only costs captures across a worker restart.
  });
}

// Games fire their END_SOLVED save immediately before the completion
// navigation replaces the document; a plain wipe on "loading" erased exactly
// the requests protocol analysis needs. Rotate the outgoing document's log
// into a previous-document bucket instead.
function rotateSessionCapture(tabId) {
  const outgoing = sessionCapture.get(tabId);
  if (outgoing?.length) {
    const kept = outgoing.slice(-400);
    previousCapture.set(tabId, kept);
    chrome.storage.session?.set({ [`${PREVIOUS_CAPTURE_PREFIX}${tabId}`]: kept }).catch(() => {});
  }
  sessionCapture.delete(tabId);
  chrome.storage.session?.remove(`${CAPTURE_LOG_PREFIX}${tabId}`).catch(() => {});
}

async function capturedRequests(tabId, { includePrevious = false } = {}) {
  let log = sessionCapture.get(tabId);
  if (!log) {
    try {
      const stored = await chrome.storage.session?.get(`${CAPTURE_LOG_PREFIX}${tabId}`);
      log = stored?.[`${CAPTURE_LOG_PREFIX}${tabId}`] || [];
      sessionCapture.set(tabId, log);
    } catch {
      log = [];
    }
  }
  if (!includePrevious) return safeCapturedRequests(log);
  let previous = previousCapture.get(tabId);
  if (!previous) {
    try {
      const stored = await chrome.storage.session?.get(`${PREVIOUS_CAPTURE_PREFIX}${tabId}`);
      previous = stored?.[`${PREVIOUS_CAPTURE_PREFIX}${tabId}`] || [];
      previousCapture.set(tabId, previous);
    } catch {
      previous = [];
    }
  }
  return safeCapturedRequests([...previous, ...log]);
}

function debug(...args) {
  console.log("[lls-bg]", ...args);
}

let sessionStateLoaded = null;

function loadSessionState() {
  if (!sessionStateLoaded) {
    sessionStateLoaded = chrome.storage.session?.get("llsPuzzleState").then((state) => {
      // A restarted service worker loses its in-memory maps; restore the
      // captured sources and routes so a slow solve still finds its data.
      for (const [tabId, entries] of Object.entries(state?.llsPuzzleState?.sources || {})) {
        if (Array.isArray(entries) && !puzzleSources.has(Number(tabId))) puzzleSources.set(Number(tabId), entries);
      }
      for (const [tabId, route] of Object.entries(state?.llsPuzzleState?.routes || {})) {
        if (!puzzleRoutes.has(Number(tabId))) puzzleRoutes.set(Number(tabId), route);
      }
    }).catch(() => {
      // In-memory capture still covers pages solved in this service worker run.
    });
  }
  return sessionStateLoaded;
}

function persistSessionState() {
  if (!chrome.storage.session) return;
  const sources = {};
  for (const [tabId, entries] of puzzleSources) {
    const kept = [];
    let total = 0;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (total + entry.text.length > MAX_PERSISTED_SOURCE_CHARS) break;
      total += entry.text.length;
      kept.unshift(entry);
    }
    if (kept.length) sources[tabId] = kept;
  }
  const routes = {};
  for (const [tabId, route] of puzzleRoutes) routes[tabId] = route;
  chrome.storage.session.set({ llsPuzzleState: { sources, routes } }).catch(() => {
    // Exceeding the session quota only costs restart durability.
  });
}

function puzzleRoute(url) {
  const match = String(url || "").match(/^https:\/\/www\.linkedin\.com\/games\/(?:view\/)?([^/?#]+)/);
  return match?.[1] || "";
}

function syncPuzzleRoute(tabId, url) {
  const route = puzzleRoute(url);
  if (!route) return;
  const previous = puzzleRoutes.get(tabId);
  if (previous && previous !== route) {
    saveContracts.delete(tabId);
    puzzleSources.delete(tabId);
    pendingPuzzleResponses.delete(tabId);
    pageScanTimes.delete(tabId);
    persistSessionState();
  }
  puzzleRoutes.set(tabId, route);
}

function capturePagePuzzleSource() {
  const reactKeyPattern = /^__react(?:Props|Fiber)\$/;
  const gamePuzzleKeyPattern = /blueprintGamePuzzle|pinpointGamePuzzle|crossClimbGamePuzzle|wendGamePuzzle|solutionWords|puzzleLetters|rungs/;
  const answerKeyPattern = /solutions?|answer|category/;
  const clueKeyPattern = /clues?/;
  const puzzleSourcePattern = /blueprintGamePuzzle|pinpointGamePuzzle|crossClimbGamePuzzle|wendGamePuzzle|"solutions?"\s*:|"answer"\s*:|solutionWords|puzzleLetters|rungs/;
  const MAX_SCAN_ELEMENTS = 4000;
  const MAX_INSPECTED = 40000;
  const MAX_SCAN_DEPTH = 64;
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
    if (!value || typeof value !== "object" || value instanceof Node || depth > MAX_SCAN_DEPTH || seen.has(value) || inspected >= MAX_INSPECTED) return;
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
      if (puzzles.size >= 12 || inspected >= MAX_INSPECTED) return;
    }
  }

  const main = document.querySelector("main");
  // SPA route renders can mount the game outside <main> or drop <main>
  // entirely, so sweep the whole body for React props instead of trusting
  // main's subtree. Keep main first so its closer controls are found sooner.
  const pageElements = [...document.body.querySelectorAll("*")].slice(0, MAX_SCAN_ELEMENTS);
  const roots = [main, ...pageElements, document.body, document.documentElement].filter(Boolean);
  for (const kind of ["Props", "Fiber"]) {
    for (const root of roots) {
      for (const key of Object.keys(root)) {
        if (!reactKeyPattern.test(key) || !key.startsWith(`__react${kind}$`)) continue;
        findReactPuzzles(root[key]);
        if (puzzles.size >= 12 || inspected >= MAX_INSPECTED) break;
      }
      if (puzzles.size >= 12 || inspected >= MAX_INSPECTED) break;
    }
    if (puzzles.size >= 12 || inspected >= MAX_INSPECTED) break;
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
    }).catch(async (error) => {
      if (!/already attached/i.test(String(error?.message || error))) throw error;
      // A restarted service worker forgets its own attachment while the
      // debugger link survives. Verify the link really belongs to this
      // extension before trusting it — a foreign DevTools session also
      // reports "already attached" but rejects our commands.
      try {
        await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", { expression: "1" });
        attachedTabs.add(tabId);
        return;
      } catch {
        throw new Error("Another debugger such as DevTools is attached to this tab. Close it and solve again.");
      }
    }).finally(() => {
      attachPromises.delete(tabId);
    });
    attachPromises.set(tabId, pending);
  }
  await attachPromises.get(tabId);
}

async function detachIfIdle(tabId) {
  if (captureTabs.has(tabId)) return;
  if (!attachedTabs.has(tabId)) return;
  attachedTabs.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // The tab may have closed or navigated while the solve was finishing.
  }
}

async function forceDetach(tabId) {
  captureTabs.delete(tabId);
  clearTimer(captureTimers, tabId);
  pendingPuzzleResponses.delete(tabId);
  try {
    await attachPromises.get(tabId);
  } catch {
    // A failed attachment needs no matching detach.
  }
  await detachIfIdle(tabId);
}

function armCaptureStop(tabId) {
  clearTimer(captureTimers, tabId);
  captureTimers.set(tabId, setTimeout(() => {
    captureTabs.delete(tabId);
    captureTimers.delete(tabId);
    pendingPuzzleResponses.delete(tabId);
    void detachIfIdle(tabId);
  }, CAPTURE_LEASE_MS));
}

function stopCapture(tabId) {
  clearTimer(captureTimers, tabId);
  captureTabs.delete(tabId);
  void detachIfIdle(tabId);
}

async function startCapture(tabId, url) {
  syncPuzzleRoute(tabId, url);
  // Navigation and route-change listeners clear stale sources before the new
  // response arrives. Never clear here: onUpdated may already have captured
  // this document's one-shot puzzle payload before its content script starts.
  await primeCapture(tabId, url);
}

async function primeCapture(tabId, url) {
  syncPuzzleRoute(tabId, url);
  await ensureAttached(tabId);
  captureTabs.add(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, "Network.enable", {
      maxPostDataSize: 64 * 1024,
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
  const matched = text.match(/blueprintGamePuzzle|pinpointGamePuzzle|crossClimbGamePuzzle|wendGamePuzzle|"solutions?"\s*:|"answer"\s*:|solutionWords|puzzleLetters|rungs/);
  if (!matched) return;
  debug("puzzle source", tabId, "len", text.length, "marker", matched[0]);
  const cutoff = Date.now() - 15 * 60 * 1000;
  const entries = (puzzleSources.get(tabId) || []).filter((entry) => entry.capturedAt >= cutoff);
  if (!entries.some((entry) => entry.text === text)) entries.push({ text, capturedAt: Date.now() });
  while (entries.length > 6 || entries.reduce((total, entry) => total + entry.text.length, 0) > 12 * 1024 * 1024) entries.shift();
  puzzleSources.set(tabId, entries);
  // Fresh responses mean the route is still delivering, so renew the lease.
  if (captureTabs.has(tabId)) armCaptureStop(tabId);
  persistSessionState();
}

async function handleMessage(message, sender) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) throw new Error("The solver could not identify this tab.");
  await loadSessionState();
  if (message?.type !== "lls-puzzle-sources") debug("msg", message?.type, "tab", tabId);
  if (message?.type === "lls-debug") {
    debug("[page]", message.text);
    return { ok: true };
  }

  if (message?.type === "lls-game-query-id") {
    return { ok: true, queryId: observedGameQueryId || DEFAULT_GAME_QUERY_ID };
  }

  if (message?.type === "lls-debug-requests") {
    return { ok: true, requests: await capturedRequests(tabId, { includePrevious: Boolean(message.all) }) };
  }

  if (message?.type === "lls-request-context") {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [sender.frameId || 0] }, world: "MAIN", func: capturePageGame, args: [puzzleRoute(sender.url)],
    });
    return { ok: true, game: results?.[0]?.result, template: saveContracts.get(tabId) || null };
  }

  if (message?.type === "lls-capture-start") {
    await startCapture(tabId, sender.url);
    return { ok: true };
  }

  if (message?.type === "lls-puzzle-sources") {
    syncPuzzleRoute(tabId, sender.url);
    debug("sources req enter", tabId);
    try {
      const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
      const response = await chrome.tabs.sendMessage(tabId, { type: "lls-bootstrap-sources" }, { frameId });
      debug("sources bootstrap", tabId, (response?.sources || []).length);
      for (const source of response?.sources || []) rememberPuzzleSource(tabId, source);
    } catch (error) {
      debug("sources bootstrap failed", tabId, String(error?.message || error));
      // Network-captured data remains available when the top frame has navigated.
    }
    const lastPageScan = pageScanTimes.get(tabId) || 0;
    if (Date.now() - lastPageScan >= 750) {
      pageScanTimes.set(tabId, Date.now());
      try {
        const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
        debug("sources scan begin", tabId);
        const results = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frameId] },
          world: "MAIN",
          func: capturePagePuzzleSource,
        });
        debug("sources scan done", tabId, (results || []).length);
        for (const result of results || []) {
          if (result?.result && !/blueprintGamePuzzle|pinpointGamePuzzle|crossClimbGamePuzzle|wendGamePuzzle|solutionWords|puzzleLetters|rungs/.test(result.result)) {
            debug("scan peek", tabId, String(result.result).slice(0, 220));
          }
          rememberPuzzleSource(tabId, result.result);
        }
      } catch (error) {
        debug("sources scan failed", tabId, String(error?.message || error));
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

  return { ok: false };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse, (error) => {
    debug("handler error", message?.type, String(error?.message || error));
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});

chrome.debugger.onDetach.addListener((source) => {
  if (Number.isInteger(source.tabId)) {
    attachedTabs.delete(source.tabId);
    attachPromises.delete(source.tabId);
    captureTabs.delete(source.tabId);
    clearTimer(captureTimers, source.tabId);
    pendingPuzzleResponses.delete(source.tabId);
  }
});

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  const tabId = source.tabId;
  if (!Number.isInteger(tabId)) return;
  // Full-session request recording plus query-id observation run on any
  // Capture puzzle data and native save contracts from game traffic.
  if (method === "Network.requestWillBeSent") {
    const req = params?.request || {};
    if (/^https:\/\/www\.linkedin\.com\//.test(req.url || "")
      && /gameStoredRecord|updateGameState/.test(req.postData || "")) {
      if (req.postData.includes("updateGameState")) {
        try {
          const body = JSON.parse(req.postData);
          if (body.requestId === "updateGameState") saveContracts.set(tabId, body);
        } catch {
          // Malformed requests are diagnostic evidence, never replay templates.
        }
      }
      const url = new URL(req.url);
      const queryId = url.searchParams.get("queryId");
      const endpoint = url.origin + url.pathname + (queryId ? `?queryId=${encodeURIComponent(queryId)}` : "");
      if (!pendingSaveResponses.has(tabId)) pendingSaveResponses.set(tabId, new Set());
      pendingSaveResponses.get(tabId).add(params.requestId);
      recordSessionRequest(tabId, {
        method: req.method, url: endpoint, requestId: params.requestId,
        postData: redactCapture(req.postData).slice(0, 30000),
      });
    }
    // The save mutation's query id is the only learned fact replays need;
    // everything else comes statelessly from the page's own embedded data.
    if (/\/voyager\/api\/graphql/.test(req.url || "") && req.postData?.includes("gameStoredRecord")) {
      const observed = req.url.match(/[?&]queryId=([^&]+)/)?.[1];
      if (observed && observed !== observedGameQueryId) {
        observedGameQueryId = observed;
        debug("game query id", observed);
      }
    }
  }

  if (method === "Network.webSocketFrameSent" || method === "Network.webSocketFrameReceived") {
    const payload = params.response?.payloadData || "";
    if (/gameStoredRecord|updateGameState|fsd_game/.test(payload)) {
      recordSessionRequest(tabId, { method, requestId: params.requestId,
        postData: redactCapture(payload).slice(0, 30000) });
    }
  }

  const saves = pendingSaveResponses.get(tabId);
  if (saves?.has(params.requestId)) {
    if (method === "Network.responseReceived") {
      recordSessionRequest(tabId, { method: "SAVE-RESPONSE", requestId: params.requestId,
        status: params.response?.status, postData: "" });
    }
    if (method === "Network.loadingFinished") {
      saves.delete(params.requestId);
      try {
        const response = await chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", { requestId: params.requestId });
        recordSessionRequest(tabId, { method: "SAVE-RESPONSE", requestId: params.requestId,
          postData: redactCapture(response.base64Encoded
            ? new TextDecoder().decode(Uint8Array.from(atob(response.body), (char) => char.charCodeAt(0)))
            : response.body).slice(0, 30000) });
      } catch {
        recordSessionRequest(tabId, { method: "SAVE-RESPONSE", requestId: params.requestId, postData: "<response body unavailable>" });
      }
    }
    if (method === "Network.loadingFailed") {
      saves.delete(params.requestId);
      recordSessionRequest(tabId, { method: "SAVE-RESPONSE", requestId: params.requestId, postData: params.errorText || "Network failure" });
    }
  }

  if (!captureTabs.has(tabId)) {
    // A restarted service worker drops its capture bookkeeping while the
    // debugger link and Network domain survive it. Receiving these events
    // again means capture was ours, so re-arm instead of losing the tab's
    // one-shot puzzle payloads.
    if (method !== "Network.responseReceived") return;
    captureTabs.add(tabId);
    armCaptureStop(tabId);
  }

  if (method === "Network.responseReceived") {
    const url = params?.response?.url || "";
    const mimeType = params?.response?.mimeType || "";
    // The puzzle payload's API path has moved before, so accept any LinkedIn
    // JSON response here; rememberPuzzleSource's content check does the gating.
    if (!/^https:\/\/www\.linkedin\.com\//.test(url) || !/json/i.test(mimeType)) return;
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
  saveContracts.delete(tabId);
  pendingSaveResponses.delete(tabId);
  puzzleRoutes.delete(tabId);
  pageScanTimes.delete(tabId);
  puzzleSources.delete(tabId);
  sessionCapture.delete(tabId);
  previousCapture.delete(tabId);
  chrome.storage.session?.remove(`${CAPTURE_LOG_PREFIX}${tabId}`).catch(() => {});
  chrome.storage.session?.remove(`${PREVIOUS_CAPTURE_PREFIX}${tabId}`).catch(() => {});
  persistSessionState();
  void forceDetach(tabId);
});

chrome.tabs?.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab?.url || "";
  if (changeInfo.status === "loading") {
    saveContracts.delete(tabId);
    puzzleSources.delete(tabId);
    pendingPuzzleResponses.delete(tabId);
    pageScanTimes.delete(tabId);
    rotateSessionCapture(tabId);
    persistSessionState();
  }
  if (!changeInfo.url && changeInfo.status !== "loading") return;
  if (/^https:\/\/www\.linkedin\.com\/games\//.test(url)) {
    syncPuzzleRoute(tabId, url);
    if (/^https:\/\/www\.linkedin\.com\/games\/(?:view\/)?(?:pinpoint|crossclimb|wend|queens|tango|zip|patches|mini-sudoku)(?:\/|[?#]|$)/.test(url)) {
      // Keep network capture attached for the game visit: the
      // one-shot puzzle response can arrive at any navigation on the route.
      void primeCapture(tabId, url).catch(() => {
        // React props and bootstrap scripts remain available as fallbacks.
      });
      return;
    }
    // The games hub needs no capture connection.
    stopCapture(tabId);
    return;
  }
  saveContracts.delete(tabId);
  pendingSaveResponses.delete(tabId);
  puzzleRoutes.delete(tabId);
  pageScanTimes.delete(tabId);
  puzzleSources.delete(tabId);
  persistSessionState();
  void forceDetach(tabId);
});
