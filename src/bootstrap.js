(function captureLinkedInPuzzleBootstrap() {
  "use strict";

  if (globalThis.LinkedInPuzzleBootstrap) return;

  const sources = [];
  const seen = new Set();
  const markers = [
    "blueprintGamePuzzle",
    "crossClimbGamePuzzle",
    "wendGamePuzzle",
    "solutionWords",
    "puzzleLetters",
  ];

  function remember(text) {
    if (typeof text !== "string" || !markers.some((marker) => text.includes(marker))) return;
    if (seen.has(text)) return;
    seen.add(text);
    sources.push(text);
    while (sources.length > 24) {
      const removed = sources.shift();
      seen.delete(removed);
    }
  }

  function inspect(node) {
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

  const observer = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) inspect(node);
  });
  observer.observe(document, { childList: true, subtree: true });
  for (const element of document.querySelectorAll("script, code")) inspect(element);
})();
