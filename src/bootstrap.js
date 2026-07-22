(function captureLinkedInPuzzleBootstrap() {
  "use strict";

  if (globalThis.LinkedInPuzzleBootstrap) return;

  const isWordGame = /^\/games\/(?:view\/)?(?:pinpoint|crossclimb|wend)(?:\/|$)/.test(location.pathname);
  if (!isWordGame) return;

  const needsNetworkCapture = /^\/games\/(?:pinpoint|crossclimb|wend)(?:\/|$)/.test(location.pathname);
  if (window.top === window && needsNetworkCapture) {
    chrome.runtime.sendMessage({ type: "lls-capture-start" }).catch(() => {
      // Puzzle solving can still use bootstrap data if early capture is unavailable.
    });
  }

  const sources = [];
  const seen = new Set();
  const MAX_SOURCE_CHARS = 4 * 1024 * 1024;
  const MAX_TOTAL_SOURCE_CHARS = 12 * 1024 * 1024;
  const markers = [
    "blueprintGamePuzzle",
    "pinpointGamePuzzle",
    "crossClimbGamePuzzle",
    "wendGamePuzzle",
    '"solutions"',
    '"solution"',
    '"answer"',
    "solutionWords",
    "puzzleLetters",
    "rungs",
  ];

  function remember(text) {
    if (typeof text !== "string" || text.length > MAX_SOURCE_CHARS || !markers.some((marker) => text.includes(marker))) return;
    if (seen.has(text)) return;
    seen.add(text);
    sources.push(text);
    if (window.top === window) {
      chrome.runtime.sendMessage({ type: "lls-puzzle-source", text }).catch(() => {
        // The current frame can still parse its own retained source.
      });
    }
    while (sources.length > 10 || sources.reduce((total, source) => total + source.length, 0) > MAX_TOTAL_SOURCE_CHARS) {
      const removed = sources.shift();
      seen.delete(removed);
    }
  }

  function inspect(node) {
    if (node instanceof Text && node.parentElement?.matches("script, code")) {
      remember(node.parentElement.textContent || "");
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.matches("script, code")) remember(node.textContent || "");
    for (const element of node.querySelectorAll?.("script, code") || []) remember(element.textContent || "");
  }

  globalThis.LinkedInPuzzleBootstrap = {
    sources,
    captureVisible() {
      for (const element of document.querySelectorAll("script, code")) remember(element.textContent || "");
      return sources.slice();
    },
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "lls-bootstrap-sources") return;
    sendResponse({ sources: globalThis.LinkedInPuzzleBootstrap.captureVisible() });
  });

  const observer = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) inspect(node);
  });
  observer.observe(document, { childList: true, subtree: true });
  const observerStop = setTimeout(() => observer.disconnect(), 30000);
  for (const element of document.querySelectorAll("script, code")) inspect(element);
  document.addEventListener("DOMContentLoaded", () => globalThis.LinkedInPuzzleBootstrap.captureVisible(), { once: true });
  addEventListener("pagehide", () => {
    clearTimeout(observerStop);
    observer.disconnect();
  }, { once: true });
})();
