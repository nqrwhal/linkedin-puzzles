(function startLinkedInPuzzleSolver() {
  "use strict";

  const solvers = globalThis.LinkedInLogicSolvers;
  if (window.top === window && document.querySelector("iframe[src*='/games/view/']")) return;
  if (!solvers || globalThis.__linkedinLogicSolverLoaded) return;
  globalThis.__linkedinLogicSolverLoaded = true;

  const GAME_NAMES = {
    pinpoint: "Pinpoint",
    crossclimb: "Crossclimb",
    wend: "Wend",
    queens: "Queens",
    tango: "Tango",
    zip: "Zip",
    "mini-sudoku": "Mini Sudoku",
    patches: "Patches",
  };

  let panel;
  let title;
  let status;
  let solveButton;
  let currentGame = null;
  let solving = false;
  let solveSession = null;
  let solveSuccessMessage = "Solved!";
  let lastUrl = location.href;
  let trustedInputActive = false;
  let solveStartedAt = 0;
  let solveFirstInputAt = 0;
  let captureGame = null;

  const DOM_POLL_FLOOR_MS = 40;
  const RENDER_SETTLE_TIMEOUT_MS = 1200;
  const PUZZLE_DATA_ATTEMPTS = 32;
  const PUZZLE_DATA_RETRY_MS = 250;
  // LinkedIn accepts saves at a two-to-three second pace: hold only the final
  // move of each solve until this floor passes and never slow input otherwise.
  const SOLVE_SAFE_FLOOR_MS = 2000;
  const SIGNED_IN_SAVE_SETTLE_MS = 800;
  const PUZZLE_SOURCE_PATTERN = /blueprintGamePuzzle|pinpointGamePuzzle|crossClimbGamePuzzle|wendGamePuzzle|"solutions"\s*:|"solution"\s*:|"answer"\s*:|solutionWords|puzzleLetters|rungs/;
  // requestAnimationFrame never fires in an occluded or background tab, so any
  // render settle must fall back to a timer instead of waiting on frames.
  const nextFrame = () => new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 120);
  });

  function assertStillSolving() {
    if (!solveSession || getGame() !== solveSession.game) {
      throw new Error("Solve cancelled because the puzzle page changed.");
    }
  }

  function dropSolveSessionIfStale() {
    if (solving && solveSession && getGame() !== solveSession.game) solveSession = null;
  }

  async function delay(ms) {
    const end = Date.now() + Math.max(0, ms);
    while (true) {
      if (solving) assertStillSolving();
      const remaining = end - Date.now();
      if (remaining <= 0) return;
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, remaining)));
    }
  }

  function isSignedInGamePage() {
    return window.top === window && /^\/games\/(?!view\/)/.test(location.pathname);
  }

  function saveErrorVisible() {
    return /issue saving your game|could(?:n[’']t| not) save your game/i.test(document.body?.textContent || "");
  }

  async function waitForSignedInCompletion() {
    if (!isSignedInGamePage()) return;
    const remaining = SOLVE_SAFE_FLOOR_MS - (Date.now() - (solveFirstInputAt || solveStartedAt));
    if (remaining > 0) await delay(remaining);
  }

  function markTrustedInput() {
    if (isSignedInGamePage() && !solveFirstInputAt) solveFirstInputAt = Date.now();
  }

  async function waitUntil(
    predicate,
    timeoutMs,
    intervalMs = DOM_POLL_FLOOR_MS,
    observeRoot = document.querySelector("main") || document.documentElement,
  ) {
    const test = () => {
      try {
        return Boolean(predicate());
      } catch {
        return false;
      }
    };
    if (solving) assertStillSolving();
    if (test()) return true;
    return new Promise((resolve, reject) => {
      let finished = false;
      let checkQueued = false;
      let observer;
      let poll;
      let timeout;
      const cleanup = () => {
        observer?.disconnect();
        clearInterval(poll);
        clearTimeout(timeout);
      };
      const finish = (value) => {
        if (finished) return;
        finished = true;
        cleanup();
        resolve(value);
      };
      const fail = (error) => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(error);
      };
      const check = () => {
        if (finished) return;
        try {
          if (solving) assertStillSolving();
          if (test()) finish(true);
        } catch (error) {
          fail(error);
        }
      };
      const scheduleCheck = () => {
        if (finished || checkQueued) return;
        checkQueued = true;
        queueMicrotask(() => {
          checkQueued = false;
          check();
        });
      };
      observer = new MutationObserver(scheduleCheck);
      observer.observe(observeRoot?.isConnected ? observeRoot : document.documentElement, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
      poll = setInterval(check, Math.max(DOM_POLL_FLOOR_MS, intervalMs));
      timeout = setTimeout(() => {
        if (finished) return;
        try {
          if (solving) assertStillSolving();
          finish(test());
        } catch (error) {
          fail(error);
        }
      }, timeoutMs);
    });
  }

  function acceptedSolutionVisible(includeSeeResults = true) {
    const pageText = document.body?.textContent || "";
    return !saveErrorVisible() && (/\/results\/?$/.test(location.pathname)
      || pageText.includes("Puzzle complete!")
      || pageText.includes("Correct guess")
      || (includeSeeResults && pageText.includes("See results"))
      || /You[’']re crushing it!/.test(pageText)
      || /Solved in \d+:[0-5]\d/.test(pageText));
  }

  async function waitForAcceptedSolution(timeoutMs = 5000, includeSeeResults = true) {
    const accepted = await waitUntil(() => acceptedSolutionVisible(includeSeeResults), timeoutMs, 50);
    if (!accepted) return false;
    // Signed-in pages can render their local completion state just before the
    // save request finishes. Give a late save error time to surface before the
    // extension reports success.
    if (isSignedInGamePage()
      && await waitUntil(saveErrorVisible, SIGNED_IN_SAVE_SETTLE_MS, 50, document.documentElement)) return false;
    return acceptedSolutionVisible(includeSeeResults);
  }

  function gameAreaText() {
    // Client-rendered SPA routes can mount the game outside <main> (or drop
    // <main> entirely), so fall back to the whole document's text.
    return document.querySelector("main")?.textContent || document.body?.textContent || "";
  }

  function gameControls(selector) {
    // Match the old main-scoped queries' semantics (dialogs included) while
    // keeping the solver's own panel out of the results.
    return [...document.querySelectorAll(selector)].filter((element) => !element.closest("#linkedin-logic-solver"));
  }

  async function waitForBoard(parse, timeoutMs = 3000) {
    let board = null;
    const found = await waitUntil(() => {
      board = parse();
      return true;
    }, timeoutMs);
    if (found && board) return board;
    // Surface the parser's specific "not visible yet" error on the final miss.
    return parse();
  }

  function getGame() {
    if (window.top === window && document.querySelector("iframe[src*='/games/view/']")) return null;
    const match = location.pathname.match(/^\/games\/(?:view\/)?(pinpoint|crossclimb|wend|queens|tango|zip|mini-sudoku|patches)(?:\/|$)/);
    return match ? match[1] : null;
  }

  function setStatus(message, state = "idle") {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
    chrome.runtime.sendMessage({ type: "lls-debug", text: message }).catch(() => {});
  }

  function createPanel() {
    if (panel?.isConnected) return;
    panel = document.createElement("aside");
    panel.id = "linkedin-logic-solver";
    panel.setAttribute("aria-label", "LinkedIn Puzzle Solver");
    const version = globalThis.chrome?.runtime?.getManifest?.().version || "";
    panel.innerHTML = `
      <div class="lls__shield"></div>
      <div class="lls__eyebrow">Puzzle Solver${version ? ` · ${version}` : ""}</div>
      <div class="lls__title">Detecting puzzle…</div>
      <button class="lls__solve" type="button">Solve puzzle</button>
      <div class="lls__status" role="status" aria-live="polite">Waiting for the board.</div>
    `;
    // The panel hangs off <html>, outside LinkedIn's React root, so events the
    // shield swallows cannot reach the page's handlers in any phase. Real
    // pointer activity aimed at a parked cursor's panel never leaks through.
    const shield = panel.querySelector(".lls__shield");
    for (const type of [
      "pointerdown", "pointermove", "pointerup", "pointercancel",
      "mousedown", "mousemove", "mouseup", "click", "dblclick",
      "mouseover", "mouseenter", "mouseleave", "mouseout",
      "dragstart", "drag", "drop", "wheel", "contextmenu",
    ]) {
      shield.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      }, { capture: true });
    }
    document.documentElement.appendChild(panel);
    title = panel.querySelector(".lls__title");
    status = panel.querySelector(".lls__status");
    solveButton = panel.querySelector(".lls__solve");
    solveButton.addEventListener("click", () => void solveCurrentGame());
  }

  function updatePanel() {
    createPanel();
    currentGame = getGame();
    if (!currentGame) {
      captureGame = null;
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    requestPuzzleCapture();
    title.textContent = GAME_NAMES[currentGame];
    solveButton.textContent = "Solve puzzle";
    solveButton.disabled = solving;
    // Leave a just-earned success message alone; later page mutations would
    // otherwise overwrite it with the idle line.
    if (!solving && status.dataset.state !== "success") setStatus("Board recognized. Ready to solve.");
  }

  function requestPuzzleCapture(force = false) {
    if (window.top !== window) return Promise.resolve();
    if (!["pinpoint", "crossclimb", "wend"].includes(currentGame)) {
      captureGame = null;
      return Promise.resolve();
    }
    if (!force && captureGame === currentGame) return Promise.resolve();
    captureGame = currentGame;
    return chrome.runtime.sendMessage({ type: "lls-capture-start" }).catch(() => {
      // Embedded and retained page data remain available when capture cannot attach.
    });
  }

  function squareSize(count, gameName) {
    const size = Math.sqrt(count);
    if (!Number.isInteger(size)) throw new Error(`${gameName} board is not square.`);
    return size;
  }

  function findIndexedCells() {
    return [...document.querySelectorAll("[data-cell-idx]")]
      .filter((element) => {
        if (element.closest("[role='dialog'], [aria-modal='true'], [aria-hidden='true']")) return false;
        return element.matches(".lotka-cell, .trail-cell")
          || element.getAttribute("role") === "button"
          || /^cell-\d+$/.test(element.getAttribute("data-testid") || "");
      })
      .sort((a, b) => Number(a.dataset.cellIdx) - Number(b.dataset.cellIdx));
  }

  function findCellByIndex(index) {
    return findIndexedCells().find((element) => Number(element.dataset.cellIdx) === index) || null;
  }

  async function beginTrustedInput() {
    assertStillSolving();
    if (!globalThis.chrome?.runtime?.id) throw new Error("The extension input service is unavailable. Reload this page.");
    const response = await chrome.runtime.sendMessage({ type: "lls-input-start" });
    if (!response?.ok) throw new Error(response?.error || "Chrome could not start puzzle input.");
    trustedInputActive = true;
  }

  async function endTrustedInput() {
    if (!trustedInputActive) return;
    trustedInputActive = false;
    try {
      await chrome.runtime.sendMessage({ type: "lls-input-stop" });
    } catch {
      // The page may navigate to results before the old content script replies.
    }
  }

  async function mouseSequence(steps, intervalMs = 0) {
    assertStillSolving();
    if (!steps.length) return;
    if (!trustedInputActive) throw new Error("Trusted mouse input is unavailable.");
    markTrustedInput();
    const safeInterval = Math.max(0, Math.min(100, Number(intervalMs) || 0));
    const response = await chrome.runtime.sendMessage({
      type: "lls-input-events",
      intervalMs: safeInterval,
      events: steps.map(({ eventType, point, buttons }) => ({
        eventType,
        x: point.x,
        y: point.y,
        button: eventType === "mousePressed" || eventType === "mouseReleased" ? "left" : "none",
        buttons,
        clickCount: eventType === "mousePressed" || eventType === "mouseReleased" ? 1 : 0,
      })),
    });
    if (!response?.ok) throw new Error(response?.error || "Chrome could not send puzzle input.");
  }

  function elementFullyInView(element) {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
  }

  async function clickElement(element) {
    assertStillSolving();
    // Scrolling under a parked physical cursor makes Chrome dispatch real
    // boundary events into the page; only scroll when the target needs it.
    if (!elementFullyInView(element)) element.scrollIntoView({ block: "nearest", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    await mouseSequence([
      { eventType: "mouseMoved", point, buttons: 0 },
      { eventType: "mousePressed", point, buttons: 1 },
      { eventType: "mouseReleased", point, buttons: 0 },
    ]);
  }

  async function insertText(text) {
    assertStillSolving();
    if (!trustedInputActive) throw new Error("Trusted keyboard input is unavailable.");
    markTrustedInput();
    const response = await chrome.runtime.sendMessage({ type: "lls-input-text", text });
    if (!response?.ok) throw new Error(response?.error || "Chrome could not type into the puzzle.");
  }

  async function pressKey(key, code, keyCode, modifiers = 0) {
    assertStillSolving();
    if (!trustedInputActive) throw new Error("Trusted keyboard input is unavailable.");
    markTrustedInput();
    const response = await chrome.runtime.sendMessage({ type: "lls-input-key", key, code, keyCode, modifiers });
    if (!response?.ok) throw new Error(response?.error || "Chrome could not press a puzzle key.");
  }

  async function pressKeys(keys, intervalMs = 20) {
    assertStillSolving();
    if (!trustedInputActive) throw new Error("Trusted keyboard input is unavailable.");
    markTrustedInput();
    const response = await chrome.runtime.sendMessage({
      type: "lls-input-keys",
      keys,
      intervalMs: Math.max(0, Math.min(100, Number(intervalMs) || 0)),
    });
    if (!response?.ok) throw new Error(response?.error || "Chrome could not press the puzzle keys.");
  }

  async function replaceInputText(element, text) {
    await clickElement(element);
    await pressKey("a", "KeyA", 65, /Mac|iPhone|iPad/.test(navigator.platform) ? 4 : 2);
    await pressKey("Backspace", "Backspace", 8);
    await insertText(text);
  }

  async function startGameIfNeeded() {
    // First visits and anonymous windows open on a launch screen ("Start
    // game", "Solve now", …) that can render late, uses either a button or a
    // link, and hides or previews the board; daily signed-in players never
    // see it. Wait for the gate, click through with trusted input, and wait
    // for it to leave.
    const isGateControl = (element) => {
      const label = `${element.textContent || ""} ${element.getAttribute("aria-label") || ""}`.trim();
      return /^(Start game|Start puzzle|Solve now|Play)$/i.test(label);
    };
    let gateControl = null;
    await waitUntil(() => {
      gateControl = gameControls("button, [role='button'], a[href]").find(isGateControl);
      return Boolean(gateControl);
    }, 4000);
    if (!gateControl) return;
    setStatus("Starting the game…", "working");
    await clickElement(gateControl);
    await waitUntil(() => gameControls("button, [role='button'], a[href]").filter(isGateControl).every((element) => !element.isConnected), 6000);
  }

  async function dismissTutorialDialog() {
    const dialog = [...document.querySelectorAll("[role='dialog'], [aria-modal='true']")].find((element) =>
      /how to play|tutorial/i.test(element.textContent || element.getAttribute("aria-label") || ""),
    );
    if (!dialog) return;
    const dismissButton = [...dialog.querySelectorAll("button")].find((button) => {
      const label = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`.trim();
      return /^(dismiss|close)\b/i.test(label);
    });
    if (!dismissButton) throw new Error("Close the game tutorial before solving.");
    await clickElement(dismissButton);
    if (!(await waitUntil(() => !dialog.isConnected, 750, 16))) {
      throw new Error("The game tutorial did not close.");
    }
  }

  function bootstrapSources() {
    const captured = globalThis.LinkedInPuzzleBootstrap?.captureVisible?.() || [];
    const live = [...document.querySelectorAll("code, script")]
      .map((element) => element.textContent || "")
      .filter((source) => source.length <= 4 * 1024 * 1024 && PUZZLE_SOURCE_PATTERN.test(source));
    return [...new Set([...captured, ...live])];
  }

  async function parsePuzzleData(parser) {
    let lastError;
    await requestPuzzleCapture(true);
    for (let attempt = 0; attempt < PUZZLE_DATA_ATTEMPTS; attempt += 1) {
      const localSources = bootstrapSources();
      try {
        return parser(localSources);
      } catch (error) {
        lastError = error;
      }
      let networkSources = [];
      try {
        const response = await chrome.runtime.sendMessage({ type: "lls-puzzle-sources" });
        networkSources = response?.sources || [];
      } catch {
        // Bootstrap sources still support pages that embed their puzzle data.
      }
      try {
        return parser([...new Set([...localSources, ...networkSources])]);
      } catch (error) {
        lastError = error;
      }
      chrome.runtime.sendMessage({
        type: "lls-debug",
        text: `parse attempt ${attempt + 1} failed: ${lastError.message} (local ${localSources.length}, network ${networkSources.length})`,
      }).catch(() => {});
      await delay(PUZZLE_DATA_RETRY_MS);
    }
    throw lastError;
  }

  async function requestGameTemplate() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "lls-game-template" });
      if (!response?.ok || !response.template) return null;
      return response.template;
    } catch {
      return null;
    }
  }

  function sessionCsrfToken(sources) {
    // LinkedIn's csrf-token header is the session's JSESSIONID cookie value,
    // which the page can read directly. Deriving it per page keeps a template
    // learned in one window (e.g. normal) valid in another (e.g. incognito)
    // and survives token rotation; the serialized bootstrap form is a
    // fallback for pages where the cookie is not reachable.
    const cookie = document.cookie.match(/JSESSIONID="?([^;"]+)/);
    if (cookie) return cookie[1];
    for (const source of sources) {
      const match = source.match(/JSESSIONID"?\s*[:=]\s*"?(ajax:\d+)/i);
      if (match) return match[1];
    }
    return null;
  }

  // LinkedIn numbers each game's puzzles in its own per-game series that the
  // page never displays, so the replay day is extrapolated from the day
  // captured with the save, counted in Pacific calendar days.
  function pacificDate(date = new Date()) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(date);
  }

  function pacificDaysBetween(fromDay, toDay) {
    const from = Date.parse(`${fromDay}T00:00:00Z`);
    const to = Date.parse(`${toDay}T00:00:00Z`);
    return Number.isFinite(from) && Number.isFinite(to) ? Math.round((to - from) / 86400000) : NaN;
  }

  // Replays LinkedIn's own game-save GraphQL call with the solved state. Any
  // failure returns false so the caller falls back to the UI solver, whose
  // behavior is exactly what produced the captured template.
  async function submitGameSave(gameStateUnion) {
    const template = await requestGameTemplate();
    const stateKey = Object.keys(gameStateUnion)[0];
    const entry = template?.saves?.[stateKey];
    if (!template?.queryId || !template?.member || !entry) return false;
    const elapsedDays = pacificDaysBetween(entry.on, pacificDate());
    if (!Number.isInteger(elapsedDays) || elapsedDays < 0) return false;
    const puzzleDay = entry.day + elapsedDays;
    const csrf = sessionCsrfToken(bootstrapSources()) || template.csrf;
    if (!csrf) return false;
    const elapsedSeconds = Math.max(2, Math.round((Date.now() - (solveStartedAt || Date.now())) / 1000));
    const body = {
      variables: {
        entity: {
          entity: {
            gameStoredRecord: {
              gamePlayState: "END_SOLVED",
              timeElapsed: elapsedSeconds,
              isFlawless: true,
              completionAttributes: { isHintFree: true, isMistakeFree: true },
              gameStateUnion,
            },
          },
          resourceKey: `urn:li:fsd_game:(${template.member},${entry.gameId},${puzzleDay})`,
        },
      },
      queryId: template.queryId,
      includeWebMetadata: true,
    };
    try {
      markTrustedInput();
      const response = await fetch(`https://www.linkedin.com/voyager/api/graphql?action=execute&queryId=${template.queryId}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "accept": "application/vnd.linkedin.normalized+json+2.1",
          "content-type": "application/json; charset=UTF-8",
          "csrf-token": csrf,
          "x-li-pem-metadata": "Voyager - Games=game-state-update-post",
          "x-restli-protocol-version": "2.0.0",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        chrome.runtime.sendMessage({ type: "lls-debug", text: `request solve rejected: HTTP ${response.status}` }).catch(() => {});
        return false;
      }
      // LinkedIn reports rejected mutations inside a 200 envelope.
      const payload = await response.json().catch(() => null);
      if (!payload || payload.errors?.length || payload.data?.errors?.length) {
        chrome.runtime.sendMessage({ type: "lls-debug", text: `request solve rejected: ${(payload?.errors || payload?.data?.errors || [])[0]?.message || "unknown error"}` }).catch(() => {});
        return false;
      }
      return true;
    } catch (error) {
      chrome.runtime.sendMessage({ type: "lls-debug", text: `request solve failed: ${error?.message || error}` }).catch(() => {});
      return false;
    }
  }

  async function solvePinpointGame() {
    // Solved-board revisits often ship no puzzle data at all; report the
    // completed state instead of a parse failure.
    if (/\/games\/pinpoint\/(?:results|view)/.test(location.pathname)
      || gameAreaText().includes("See results")
      || acceptedSolutionVisible()) {
      return;
    }
    const solutions = await parsePuzzleData(solvers.parsePinpointSolutions);
    setStatus("Submitting the category…", "working");
    if (await submitGameSave({ blueprintGameState: [solutions[0]] })) {
      solveSuccessMessage = "Solved with a single request.";
      setStatus(solveSuccessMessage, "success");
      return;
    }
    let input = null;
    await waitUntil(() => {
      input = document.querySelector("input[placeholder='Guess the category...'], input[aria-label='Guess the category...']");
      return Boolean(input) || gameAreaText().includes("See results");
    }, 3000);
    if (!input) {
      if (gameAreaText().includes("See results")) return;
      throw new Error("Pinpoint answer field is not visible yet.");
    }
    setStatus("Submitting the category…", "working");
    await replaceInputText(input, solutions[0]);
    const guessButton = gameControls("button").find((button) => (button.textContent || "").trim() === "Guess");
    if (guessButton) await clickElement(guessButton);
    else await pressKey("Enter", "Enter", 13);
    if (!(await waitForAcceptedSolution(4000))) throw new Error("LinkedIn did not accept the Pinpoint answer.");
  }

  function rowWord(row) {
    return row ? [...row.querySelectorAll("input")].map((input) => (input.value || "")[0] || "").join("").toUpperCase() : "";
  }

  function liveCrossclimbRow(row, rowNumber) {
    return rowNumber ? document.querySelector(`[aria-label^='Row ${rowNumber},']`) || row : row;
  }

  async function waitForCrossclimbLetter(row, rowNumber, index, expected, timeoutMs = RENDER_SETTLE_TIMEOUT_MS) {
    return waitUntil(() => {
      const liveRow = liveCrossclimbRow(row, rowNumber);
      const value = ((liveRow?.querySelectorAll("input")[index]?.value || "")[0] || "").toUpperCase();
      return value === expected;
    }, timeoutMs);
  }

  async function waitForCrossclimbRowWord(rowIndex, expected, timeoutMs = 1600) {
    return waitUntil(() => {
      const rows = [...document.querySelectorAll(".crossclimb__guess--middle")];
      return rowWord(rows[rowIndex]) === expected;
    }, timeoutMs, 20);
  }

  async function fillLetterRow(row, word) {
    const label = row.getAttribute("aria-label") || row.querySelector("input")?.getAttribute("aria-label") || "";
    const rowNumber = label.match(/row\s+(\d+)/i)?.[1];
    for (let index = 0; index < word.length; index += 1) {
      // Crossclimb replaces a row's inputs after every keystroke. Re-query the
      // live row so later letters never target detached React elements.
      const liveRow = liveCrossclimbRow(row, rowNumber);
      const inputs = [...(liveRow || row).querySelectorAll("input")];
      if (inputs.length !== word.length) throw new Error(`Crossclimb expected ${word.length} letter boxes.`);
      const current = ((inputs[index].value || "")[0] || "").toUpperCase();
      if (current === word[index]) continue;
      await clickElement(inputs[index]);
      if (current) {
        await pressKey("a", "KeyA", 65, /Mac|iPhone|iPad/.test(navigator.platform) ? 4 : 2);
        await pressKey("Backspace", "Backspace", 8);
      }
      await insertText(word[index]);
      if (!(await waitForCrossclimbLetter(row, rowNumber, index, word[index]))) {
        throw new Error(`Crossclimb did not render letter ${index + 1} in time.`);
      }
    }
  }

  async function dragRowBefore(row, target, movingDown) {
    solveButton?.blur();
    panel.dataset.dragging = "true";
    try {
      await delay(0);
      const handle = row.querySelector(".crossclimb__guess-dragger__left") || row;
      const start = handle.getBoundingClientRect();
      const destination = target.getBoundingClientRect();
      const from = { x: start.left + Math.min(17, start.width / 2), y: start.top + start.height / 2 };
      const to = {
        x: from.x,
        y: movingDown ? destination.bottom + 8 : destination.top - 18,
      };
      const steps = [
        { eventType: "mouseMoved", point: from, buttons: 0 },
        { eventType: "mousePressed", point: from, buttons: 1 },
      ];
      for (let step = 1; step <= 5; step += 1) {
        const point = { x: from.x, y: from.y + ((to.y - from.y) * step) / 5 };
        steps.push({ eventType: "mouseMoved", point, buttons: 1 });
      }
      steps.push({ eventType: "mouseReleased", point: to, buttons: 0 });
      await mouseSequence(steps, 12);
    } finally {
      delete panel.dataset.dragging;
    }
  }

  async function finishCrossclimb() {
    let resultsButton;
    await waitUntil(() => {
      if (acceptedSolutionVisible(false)) return true;
      resultsButton = gameControls("button").find(
        (button) => (button.textContent || "").trim() === "See results" && !button.disabled,
      );
      return Boolean(resultsButton);
    }, 4000, 50);
    if (acceptedSolutionVisible(false)) return true;
    if (!resultsButton) return false;
    await clickElement(resultsButton);
    return waitForAcceptedSolution(4000, false);
  }

  async function solveCrossclimbGame() {
    if (/\/games\/crossclimb\/results\/?$/.test(location.pathname) || acceptedSolutionVisible()) return;
    const rungs = await parsePuzzleData(solvers.parseCrossclimbRungs);
    setStatus("Answering the clues…", "working");
    const ordered = rungs.slice().sort((a, b) => a.solutionRungIndex - b.solutionRungIndex);
    const requestState = ordered.map((rung) => ({
      solutionRungIndex: rung.solutionRungIndex,
      clue: rung.clue,
      word: rung.word.toLowerCase(),
      guess: rung.word.toUpperCase().split("").join("&-*"),
    }));
    if (await submitGameSave({ crossClimbGameState: requestState })) {
      solveSuccessMessage = "Solved with a single request.";
      setStatus(solveSuccessMessage, "success");
      return;
    }
    const middleRungs = rungs.filter((rung) => rung.solutionRungIndex > 0 && rung.solutionRungIndex < ordered.length - 1);

    // Only the game's own letter rows count here; LinkedIn's global search
    // input would otherwise mask an already-completed board.
    const existingInputs = gameControls("input").filter((input) => input.closest("[aria-label^='Row']"));
    if (existingInputs.length && existingInputs.every((input) => input.disabled)) {
      if (await finishCrossclimb()) return;
      throw new Error("LinkedIn has completed Crossclimb but did not expose its results.");
    }
    let rows = await waitForBoard(() => {
      const found = [...document.querySelectorAll(".crossclimb__guess--middle")];
      if (!found.length) throw new Error("Crossclimb rows are not visible yet.");
      return found;
    });

    setStatus("Answering the clues…", "working");
    if (rows.length !== middleRungs.length) throw new Error("Crossclimb clue count does not match its puzzle data.");
    const usedClues = new Set();
    for (let index = 0; index < rows.length; index += 1) {
      rows = [...document.querySelectorAll(".crossclimb__guess--middle")];
      const row = rows[index];
      const input = row?.querySelector("input");
      if (!input) throw new Error("A Crossclimb clue row is missing its letter boxes.");
      await clickElement(input);
      let rung;
      await waitUntil(() => {
        const visibleText = gameAreaText().replace(/\s+/g, " ");
        rung = middleRungs
          .filter((candidate) => !usedClues.has(candidate.clue))
          .sort((a, b) => b.clue.length - a.clue.length)
          .find((candidate) => candidate.clue && visibleText.includes(candidate.clue.replace(/\s+/g, " ")));
        return Boolean(rung);
      }, RENDER_SETTLE_TIMEOUT_MS);
      if (!rung) throw new Error(`Crossclimb could not match the clue shown for row ${index + 2}.`);
      usedClues.add(rung.clue);
      await fillLetterRow(row, rung.word);
      await waitUntil(() => {
        const liveRow = liveCrossclimbRow(row, row.getAttribute("aria-label")?.match(/row\s+(\d+)/i)?.[1]);
        const inputs = [...(liveRow || row).querySelectorAll("input")];
        return inputs.length > 0 && inputs.every((letter) => letter.disabled);
      }, RENDER_SETTLE_TIMEOUT_MS);
    }

    setStatus("Ordering the word ladder…", "working");
    const desired = ordered.slice(1, -1).map((rung) => rung.word);
    for (let targetIndex = 0; targetIndex < desired.length; targetIndex += 1) {
      rows = [...document.querySelectorAll(".crossclimb__guess--middle")];
      if (rowWord(rows[targetIndex]) === desired[targetIndex]) continue;
      const sourceIndex = rows.findIndex((row) => rowWord(row) === desired[targetIndex]);
      if (sourceIndex < 0) throw new Error(`Crossclimb row ${desired[targetIndex]} is missing.`);
      await dragRowBefore(rows[sourceIndex], rows[targetIndex], sourceIndex < targetIndex);
      if (!(await waitForCrossclimbRowWord(targetIndex, desired[targetIndex]))) {
        rows = [...document.querySelectorAll(".crossclimb__guess--middle")];
        const retryIndex = rows.findIndex((row) => rowWord(row) === desired[targetIndex]);
        if (retryIndex < 0) throw new Error(`Crossclimb could not locate ${desired[targetIndex]} after dragging.`);
        await dragRowBefore(rows[retryIndex], rows[targetIndex], retryIndex < targetIndex);
        if (!(await waitForCrossclimbRowWord(targetIndex, desired[targetIndex]))) {
          throw new Error(`Crossclimb could not place ${desired[targetIndex]} after dragging.`);
        }
      }
    }

    let topRow;
    let bottomRow;
    await waitUntil(() => {
      topRow = document.querySelector("[aria-label^='Row 1,']");
      bottomRow = document.querySelector(`[aria-label^='Row ${ordered.length},']`);
      return Boolean(topRow?.querySelector("input:not([disabled])") && bottomRow?.querySelector("input:not([disabled])"));
    }, 3000, 25);
    if (!topRow || !bottomRow) throw new Error("Crossclimb did not unlock its final rows.");

    setStatus("Entering the final pair…", "working");
    await waitForSignedInCompletion();
    await fillLetterRow(topRow, ordered[0].word);
    await fillLetterRow(bottomRow, ordered[ordered.length - 1].word);
    if (!(await finishCrossclimb())) throw new Error("LinkedIn did not accept the Crossclimb ladder.");
  }

  function findWendGrid(puzzle) {
    const candidates = [...document.querySelectorAll("div")].filter((element) =>
      element.children.length === puzzle.rows * puzzle.cols
      && !element.closest("#linkedin-logic-solver, [role='dialog'], [aria-modal='true'], [aria-hidden='true']"),
    );
    for (const candidate of candidates) {
      const cells = [...candidate.children];
      const matches = cells.filter((cell, index) => (cell.textContent || "").trim().toUpperCase() === puzzle.letters[index]).length;
      if (matches >= puzzle.letters.filter(Boolean).length) return cells;
    }
    throw new Error("Wend letter grid is not visible yet.");
  }

  async function dragWendWord(elements, attempt) {
    if (typeof Touch !== "function" || typeof TouchEvent !== "function") {
      throw new Error("This Chrome version cannot create Wend touch events.");
    }
    const target = elements[0];
    const makeTouch = (element) => {
      const rect = element.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      return new Touch({
        identifier: 0,
        target,
        clientX,
        clientY,
        screenX: clientX,
        screenY: clientY,
        pageX: clientX + scrollX,
        pageY: clientY + scrollY,
        radiusX: 1,
        radiusY: 1,
        force: 1,
      });
    };
    const dispatch = (eventType, touches, changedTouches) => target.dispatchEvent(new TouchEvent(eventType, {
      bubbles: true,
      cancelable: true,
      composed: true,
      touches,
      targetTouches: touches,
      changedTouches,
    }));
    const intervalMs = [55, 75, 95][attempt] || 95;
    let touch = makeTouch(elements[0]);
    dispatch("touchstart", [touch], [touch]);
    for (const element of elements.slice(1)) {
      await delay(intervalMs);
      touch = makeTouch(element);
      dispatch("touchmove", [touch], [touch]);
    }
    const holds = attempt;
    for (let index = 0; index < holds; index += 1) {
      await delay(intervalMs);
      dispatch("touchmove", [touch], [touch]);
    }
    await delay([80, 100, 140][attempt] || 140);
    dispatch("touchend", [], [touch]);
  }

  async function solveWendGame() {
    const puzzle = await parsePuzzleData(solvers.parseWendPuzzle);
    if (/\/games\/wend\/results\/?$/.test(location.pathname) || document.querySelector("a[href*='/games/wend/results']")) return;
    setStatus("Weaving through the words…", "working");
    for (let pathIndex = 0; pathIndex < puzzle.paths.length; pathIndex += 1) {
      const path = puzzle.paths[pathIndex];
      const cells = await waitForBoard(() => findWendGrid(puzzle));
      const elements = path.map((index) => cells[index]);
      if (elements.some((element) => !element)) throw new Error("A Wend solution path leaves the grid.");
      const pathRendered = () => {
        if (acceptedSolutionVisible()) return true;
        const liveCells = findWendGrid(puzzle);
        return path.every((index) =>
          liveCells[index]?.getAttribute("data-cell-is-locked") === "true"
          || Boolean(liveCells[index]?.querySelector(`[data-testid='cell-${index}-selected']`)),
        );
      };
      if (pathIndex === puzzle.paths.length - 1) await waitForSignedInCompletion();
      let committed = pathRendered();
      for (let attempt = 0; attempt < 3 && !committed; attempt += 1) {
        if (attempt > 0) await delay(250);
        const liveCells = await waitForBoard(() => findWendGrid(puzzle), RENDER_SETTLE_TIMEOUT_MS);
        const liveElements = path.map((index) => liveCells[index]);
        if (liveElements.some((element) => !element)) throw new Error("A Wend solution path disappeared while solving.");
        await dragWendWord(liveElements, attempt);
        committed = await waitUntil(pathRendered, 1800, 50);
      }
      if (!committed) throw new Error(`Wend word ${pathIndex + 1} did not commit after three gestures.`);
      if (/\/results\/?$/.test(location.pathname)) return;
    }
    if (!(await waitForAcceptedSolution(8000)) && !document.querySelector("a[href*='/games/wend/results']")) {
      throw new Error("LinkedIn did not accept the Wend paths.");
    }
  }

  function parseQueensBoard() {
    const parsed = [];
    for (const element of document.querySelectorAll("button[aria-label], [role='button'][aria-label]")) {
      if (element.closest("[role='dialog'], [aria-modal='true'], [aria-hidden='true']")) continue;
      const label = element.getAttribute("aria-label") || "";
      const match = label.match(/^(Empty cell|Cross|Queen) of color (.+), row (\d+), column (\d+)$/i);
      if (!match) continue;
      parsed.push({
        element,
        state: match[1].toLowerCase().startsWith("empty") ? "empty" : match[1].toLowerCase(),
        region: match[2],
        row: Number(match[3]) - 1,
        col: Number(match[4]) - 1,
      });
    }
    if (!parsed.length) throw new Error("Queens cells are not visible yet.");
    const size = squareSize(parsed.length, "Queens");
    parsed.sort((a, b) => a.row - b.row || a.col - b.col);
    return { size, cells: parsed, regions: parsed.map((cell) => cell.region) };
  }

  async function waitForQueensChange(index, previous, timeoutMs = RENDER_SETTLE_TIMEOUT_MS) {
    let current;
    await waitUntil(() => {
      if (acceptedSolutionVisible()) {
        current = null;
        return true;
      }
      current = parseQueensBoard().cells[index];
      return !current || current.state !== previous;
    }, timeoutMs);
    return current;
  }

  async function solveQueensGame() {
    const board = await waitForBoard(parseQueensBoard);
    const queenIndexes = new Set(solvers.solveQueens(board));
    let pendingClicks = board.cells.reduce((total, cell, index) => {
      if (queenIndexes.has(index)) return total + (cell.state === "queen" ? 0 : cell.state === "cross" ? 1 : 2);
      return total + (cell.state === "queen" ? 1 : 0);
    }, 0);
    setStatus("Placing queens…", "working");
    queensCells: for (let index = 0; index < board.cells.length; index += 1) {
      if (/\/results\/?$/.test(location.pathname)) break;
      let cell = parseQueensBoard().cells[index];
      const wantsQueen = queenIndexes.has(index);
      if (wantsQueen) {
        const clicks = cell.state === "queen" ? 0 : cell.state === "cross" ? 1 : 2;
        for (let count = 0; count < clicks; count += 1) {
          const previous = cell.state;
          if (pendingClicks === 1) await waitForSignedInCompletion();
          await clickElement(cell.element);
          cell = await waitForQueensChange(index, previous);
          if (!cell && acceptedSolutionVisible()) break queensCells;
          if (!cell || cell.state === previous) throw new Error(`Queens cell ${index + 1} did not accept its value.`);
          pendingClicks = Math.max(0, pendingClicks - 1);
        }
      } else if (cell.state === "queen") {
        const previous = cell.state;
        if (pendingClicks === 1) await waitForSignedInCompletion();
        await clickElement(cell.element);
        cell = await waitForQueensChange(index, previous);
        if (!cell && acceptedSolutionVisible()) break;
        if (!cell || cell.state === previous) throw new Error(`Queens cell ${index + 1} did not clear.`);
        pendingClicks = Math.max(0, pendingClicks - 1);
      }
    }
    if (!(await waitForAcceptedSolution())) throw new Error("LinkedIn did not accept the Queens solution.");
  }

  function parseTangoBoard() {
    const cells = findIndexedCells();
    if (!cells.length) throw new Error("Tango cells are not visible yet.");
    const size = squareSize(cells.length, "Tango");
    const givens = {};
    const relations = [];
    const seenRelations = new Set();

    for (const element of cells) {
      const index = Number(element.dataset.cellIdx);
      const state = tangoValue(element);
      if (element.matches(":disabled, [aria-disabled='true']") && state !== -1) givens[index] = state;
      const cellRect = element.getBoundingClientRect();
      for (const marker of element.querySelectorAll("svg[aria-label='Equal'], svg[aria-label='Cross']")) {
        const markerRect = marker.getBoundingClientRect();
        const dx = markerRect.left + markerRect.width / 2 - (cellRect.left + cellRect.width / 2);
        const dy = markerRect.top + markerRect.height / 2 - (cellRect.top + cellRect.height / 2);
        const row = Math.floor(index / size);
        const col = index % size;
        let other;
        if (Math.abs(dx) > Math.abs(dy)) {
          const direction = dx < 0 ? -1 : 1;
          if (col + direction < 0 || col + direction >= size) continue;
          other = index + direction;
        } else {
          const direction = dy < 0 ? -1 : 1;
          if (row + direction < 0 || row + direction >= size) continue;
          other = index + direction * size;
        }
        const same = marker.getAttribute("aria-label") === "Equal";
        const key = `${Math.min(index, other)}:${Math.max(index, other)}:${same}`;
        if (!seenRelations.has(key)) {
          seenRelations.add(key);
          relations.push({ a: index, b: other, same });
        }
      }
    }
    return { size, cells, givens, relations };
  }

  function tangoValue(element) {
    // Current LinkedIn markup names Sun as cell-zero and Moon as cell-one,
    // while the game click cycle is Empty -> Sun -> Moon. Keep our internal
    // values aligned with that click cycle (Sun 1, Moon 0).
    if (element.querySelector("svg[aria-label='Sun'], [data-testid='cell-zero']")) return 1;
    if (element.querySelector("svg[aria-label='Moon'], [data-testid='cell-one']")) return 0;
    return -1;
  }

  async function waitForTangoChange(index, previous, timeoutMs = RENDER_SETTLE_TIMEOUT_MS) {
    let element;
    await waitUntil(() => {
      element = findCellByIndex(index);
      return !element || tangoValue(element) !== previous;
    }, timeoutMs);
    return element || findCellByIndex(index);
  }

  async function solveTangoGame() {
    const board = await waitForBoard(parseTangoBoard);
    const solution = solvers.solveTango(board);
    let pendingClicks = board.cells.reduce((total, element, index) => {
      if (element.matches(":disabled, [aria-disabled='true']")) return total;
      return total + solvers.tangoClickDistance(tangoValue(element), solution[index]);
    }, 0);
    setStatus("Filling suns and moons…", "working");
    for (let index = 0; index < board.cells.length; index += 1) {
      let element = findCellByIndex(index);
      if (!element || element.matches(":disabled, [aria-disabled='true']")) continue;
      const target = solution[index];
      let attempts = 0;
      while (element && tangoValue(element) !== target && attempts < 4) {
        const previous = tangoValue(element);
        const clicksRemaining = solvers.tangoClickDistance(previous, target);
        if (!clicksRemaining) break;
        if (pendingClicks === 1) await waitForSignedInCompletion();
        await clickElement(element);
        element = await waitForTangoChange(index, previous);
        pendingClicks = Math.max(0, pendingClicks - 1);
        attempts += 1;
      }
      if (!element) {
        if (await waitForAcceptedSolution(800)) return;
        throw new Error(`Tango cell ${index + 1} disappeared before it was set.`);
      }
      if (tangoValue(element) !== target) {
        throw new Error(`Tango cell ${index + 1} did not accept its value.`);
      }
    }
    if (!(await waitForAcceptedSolution())) throw new Error("LinkedIn did not accept the Tango solution.");
  }

  function sudokuRegions(cells, size) {
    const parent = Array.from({ length: cells.length }, (_, index) => index);
    const find = (index) => {
      while (parent[index] !== index) {
        parent[index] = parent[parent[index]];
        index = parent[index];
      }
      return index;
    };
    const join = (a, b) => {
      a = find(a);
      b = find(b);
      if (a !== b) parent[b] = a;
    };
    for (let index = 0; index < cells.length; index += 1) {
      const row = Math.floor(index / size);
      const col = index % size;
      const style = getComputedStyle(cells[index]);
      const rightStyle = col + 1 < size ? getComputedStyle(cells[index + 1]) : null;
      const bottomStyle = row + 1 < size ? getComputedStyle(cells[index + size]) : null;
      const wallRight = cells[index].classList.contains("sudoku-cell-wall-right")
        || cells[index + 1]?.classList.contains("sudoku-cell-wall-left")
        || parseFloat(style.borderRightWidth) > 1.5
        || parseFloat(rightStyle?.borderLeftWidth || "0") > 1.5;
      const wallBottom = cells[index].classList.contains("sudoku-cell-wall-bottom")
        || cells[index + size]?.classList.contains("sudoku-cell-wall-top")
        || parseFloat(style.borderBottomWidth) > 1.5
        || parseFloat(bottomStyle?.borderTopWidth || "0") > 1.5;
      if (col + 1 < size && !wallRight) join(index, index + 1);
      if (row + 1 < size && !wallBottom) join(index, index + size);
    }
    const labels = new Map();
    const regions = parent.map((_, index) => {
      const root = find(index);
      if (!labels.has(root)) labels.set(root, labels.size);
      return labels.get(root);
    });
    if (labels.size === size && [...labels.keys()].every((root) => regions.filter((region) => region === labels.get(root)).length === size)) {
      return regions;
    }
    // LinkedIn's current Mini Sudoku uses the standard 2x3 six-cell boxes,
    // even when its CSS no longer marks each wall on the cell itself.
    if (size === 6) return cells.map((_, index) => Math.floor(Math.floor(index / size) / 2) * 2 + Math.floor((index % size) / 3));
    return regions;
  }

  function findSudokuCells(size = 6) {
    const legacy = [...document.querySelectorAll(".sudoku-cell[data-cell-idx]")]
      .filter((cell) => !cell.closest("[role='dialog'], [aria-modal='true'], [aria-hidden='true']"))
      .sort((a, b) => Number(a.dataset.cellIdx) - Number(b.dataset.cellIdx));
    if (legacy.length) return legacy;

    const candidates = [];
    for (const container of document.querySelectorAll("div")) {
      if (container.closest("#linkedin-logic-solver, [role='dialog'], [aria-modal='true'], [aria-hidden='true']")) continue;
      const children = [...container.children];
      let cells = [];
      if (children.length === size * size) cells = children;
      else if (children.length === size && children.every((row) => row.children.length === size)) {
        cells = children.flatMap((row) => [...row.children]);
      }
      if (cells.length !== size * size) continue;
      const values = cells.map((cell) => (cell.textContent || "").trim());
      if (!values.every((value) => value === "" || /^[1-6]$/.test(value))) continue;
      const rects = cells.map((cell) => cell.getBoundingClientRect());
      if (rects.some((rect) => rect.width < 15 || rect.height < 15)) continue;
      const givenCount = values.filter(Boolean).length;
      if (givenCount < size) continue;
      const area = container.getBoundingClientRect().width * container.getBoundingClientRect().height;
      candidates.push({ cells, area });
    }
    candidates.sort((a, b) => a.area - b.area);
    return candidates[0]?.cells || [];
  }

  function parseSudokuBoard() {
    const cells = findSudokuCells();
    if (!cells.length) throw new Error("Mini Sudoku cells are not visible yet.");
    const size = squareSize(cells.length, "Mini Sudoku");
    const givens = {};
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      const value = Number((cell.textContent || "").trim());
      if (value) givens[index] = value;
    }
    return { size, cells, givens, regions: sudokuRegions(cells, size) };
  }

  async function waitForSudokuValue(index, expected, size, timeoutMs = RENDER_SETTLE_TIMEOUT_MS) {
    return waitUntil(() => {
      if (acceptedSolutionVisible()) return true;
      const cell = findSudokuCells(size)[index];
      return Number((cell?.textContent || "").trim()) === expected;
    }, timeoutMs);
  }

  async function solveSudokuGame() {
    const board = await waitForBoard(parseSudokuBoard);
    const solution = solvers.solveSudoku(board);
    setStatus("Entering digits…", "working");
    let pendingCells = board.cells.reduce((count, cell, index) =>
      count + (Number((cell.textContent || "").trim()) === solution[index] ? 0 : 1), 0);
    for (let index = 0; index < board.cells.length; index += 1) {
      const liveCells = findSudokuCells(board.size);
      const cell = liveCells[index];
      if (!cell) throw new Error("A Mini Sudoku cell disappeared while solving.");
      const current = Number((cell.textContent || "").trim());
      if (current === solution[index]) continue;
      const beforeSelection = elementVisualSignature(liveCells);
      await clickElement(cell);
      await waitForVisualChange(() => findSudokuCells(board.size), beforeSelection, 100);
      let numberButton = null;
      await waitUntil(() => {
        numberButton = document.querySelector(`button.sudoku-input-button[data-number='${solution[index]}']`)
          || gameControls("button").find((button) => (button.textContent || "").trim() === String(solution[index]));
        return Boolean(numberButton);
      }, RENDER_SETTLE_TIMEOUT_MS);
      if (!numberButton) throw new Error(`Mini Sudoku number button ${solution[index]} is missing.`);
      if (pendingCells === 1) await waitForSignedInCompletion();
      await clickElement(numberButton);
      if (!(await waitForSudokuValue(index, solution[index], board.size))) {
        throw new Error(`Mini Sudoku cell ${index + 1} did not accept its value.`);
      }
      pendingCells -= 1;
      if (acceptedSolutionVisible()) return;
    }
    if (!(await waitForAcceptedSolution())) throw new Error("LinkedIn did not accept the Mini Sudoku solution.");
  }

  function parsePatchesBoard() {
    const cells = [...document.querySelectorAll("[data-cell-idx][data-testid^='cell-'][aria-label]")]
      .filter((element) =>
        /^Row \d+, column \d+/i.test(element.getAttribute("aria-label") || "")
        && !element.closest("[role='dialog'], [aria-modal='true'], [aria-hidden='true']"),
      )
      .sort((a, b) => Number(a.dataset.cellIdx) - Number(b.dataset.cellIdx));
    if (!cells.length) throw new Error("Patches cells are not visible yet.");
    const size = squareSize(cells.length, "Patches");
    const clues = [];
    for (const cell of cells) {
      const label = cell.getAttribute("aria-label") || "";
      const clue = label.match(/, (square|tall rectangle|wide rectangle|freeform) clue(?:, (\d+) cells)?$/i);
      if (!clue) continue;
      clues.push({
        index: Number(cell.dataset.cellIdx),
        shape: clue[1].toLowerCase() === "freeform" ? "any" : clue[1].toLowerCase().replace(" rectangle", ""),
        area: clue[2] ? Number(clue[2]) : null,
      });
    }
    return { rows: size, cols: size, clues };
  }

  function elementVisualSignature(elements) {
    return elements.map((element) => element?.outerHTML || "").join("\n");
  }

  async function waitForVisualChange(getElements, previous, timeoutMs) {
    return waitUntil(() => {
      if (acceptedSolutionVisible()) return true;
      try {
        return elementVisualSignature(getElements()) !== previous;
      } catch {
        return false;
      }
    }, timeoutMs);
  }

  async function dragThrough(elements, { stepsPerCell = 1, stepDelay = 8, endHoldSteps = 0 } = {}) {
    const centers = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    const start = elements[0];
    const startRect = start.getBoundingClientRect();
    const nudge = Math.max(4, Math.min(8, Math.min(startRect.width, startRect.height) * 0.15));
    const pressPoint = { x: centers[0].x - nudge, y: centers[0].y - nudge };
    const thresholdPoint = { x: centers[0].x + nudge, y: centers[0].y + nudge };
    const steps = [
      { eventType: "mouseMoved", point: pressPoint, buttons: 0 },
      { eventType: "mousePressed", point: pressPoint, buttons: 1 },
    ];
    // LinkedIn's grid starts a drag from offsetX/offsetY, so deliberately
    // cross the drag threshold near the center of the same cell. Staying
    // away from its corners prevents an accidental neighboring-cell visit.
    steps.push(
      { eventType: "mouseMoved", point: thresholdPoint, buttons: 1 },
      { eventType: "mouseMoved", point: centers[0], buttons: 1 },
    );
    for (let index = 1; index < elements.length; index += 1) {
      const from = centers[index - 1];
      const to = centers[index];
      for (let step = 1; step <= stepsPerCell; step += 1) {
        const point = {
          x: from.x + ((to.x - from.x) * step) / stepsPerCell,
          y: from.y + ((to.y - from.y) * step) / stepsPerCell,
        };
        steps.push({ eventType: "mouseMoved", point, buttons: 1 });
      }
    }
    for (let step = 0; step < endHoldSteps; step += 1) {
      steps.push({ eventType: "mouseMoved", point: centers[centers.length - 1], buttons: 1 });
    }
    steps.push({ eventType: "mouseReleased", point: centers[centers.length - 1], buttons: 0 });
    await mouseSequence(steps, stepDelay);
  }

  async function solvePatchesGame() {
    const board = await waitForBoard(parsePatchesBoard);
    const rectangles = solvers.solvePatches(board);
    setStatus("Drawing patches…", "working");
    for (let clueIndex = 0; clueIndex < rectangles.length; clueIndex += 1) {
      const rectangle = rectangles[clueIndex];
      const clueCell = board.clues[clueIndex].index;
      const topLeft = rectangle.r1 * board.cols + rectangle.c1;
      const bottomRight = rectangle.r2 * board.cols + rectangle.c2;
      const findRectangleElements = () => [clueCell, topLeft, bottomRight].map((index) =>
        document.querySelector(`[data-testid='cell-${index}'][data-cell-idx]`),
      );
      let elements = findRectangleElements();
      if (elements.some((element) => !element)) throw new Error("A Patches rectangle cell is missing.");
      const getCells = () => [...document.querySelectorAll("[data-cell-idx][data-testid^='cell-'][aria-label]")];
      const before = elementVisualSignature(getCells());
      if (clueIndex === rectangles.length - 1) await waitForSignedInCompletion();
      await dragThrough(elements, { stepDelay: 5 });
      if (!(await waitForVisualChange(getCells, before, RENDER_SETTLE_TIMEOUT_MS))) {
        if (acceptedSolutionVisible()) break;
        elements = findRectangleElements();
        if (elements.some((element) => !element)) throw new Error("A Patches rectangle cell disappeared before retrying.");
        const retryBefore = elementVisualSignature(getCells());
        await dragThrough(elements, { stepDelay: 8 });
        if (!(await waitForVisualChange(getCells, retryBefore, RENDER_SETTLE_TIMEOUT_MS))) {
          if (acceptedSolutionVisible()) break;
          throw new Error(`Patches rectangle ${clueIndex + 1} did not render after retrying.`);
        }
      }
    }
    if (!(await waitForAcceptedSolution())) throw new Error("LinkedIn did not accept the Patches solution.");
  }

  function parseZipBoard() {
    const cells = findIndexedCells();
    if (!cells.length) throw new Error("Zip cells are not visible yet.");
    const size = squareSize(cells.length, "Zip");
    const clues = {};
    for (const cell of cells) {
      const value = Number((cell.querySelector("[data-cell-content], .trail-cell-content")?.textContent || cell.textContent || "").trim());
      if (value) clues[value] = Number(cell.dataset.cellIdx);
    }
    const blockedEdgeKeys = new Set();
    const addBlockedEdge = (first, second) => {
      if (!Number.isInteger(first) || !Number.isInteger(second)) return;
      if (first < 0 || second < 0 || first >= cells.length || second >= cells.length) return;
      const low = Math.min(first, second);
      const high = Math.max(first, second);
      blockedEdgeKeys.add(`${low}:${high}`);
    };

    // Current signed-in boards hash every wall class, but the rendered wall
    // remains a thick border on an overlay's ::after pseudo-element. Read that
    // geometry directly so class-name churn and partially drawn paths cannot
    // change the graph passed to the solver.
    for (const cell of cells) {
      const index = Number(cell.dataset.cellIdx);
      const row = Math.floor(index / size);
      const col = index % size;
      for (const overlay of cell.children) {
        const style = getComputedStyle(overlay, "::after");
        if (Number.parseFloat(style.borderRightWidth) > 2 && col + 1 < size) addBlockedEdge(index, index + 1);
        if (Number.parseFloat(style.borderLeftWidth) > 2 && col > 0) addBlockedEdge(index - 1, index);
        if (Number.parseFloat(style.borderBottomWidth) > 2 && row + 1 < size) addBlockedEdge(index, index + size);
        if (Number.parseFloat(style.borderTopWidth) > 2 && row > 0) addBlockedEdge(index - size, index);
      }
    }

    // Retain compatibility with older LinkedIn builds that used semantic classes.
    for (const wall of document.querySelectorAll(".trail-cell-wall")) {
      const owner = wall.closest("[data-cell-idx]");
      const index = Number(owner?.getAttribute("data-cell-idx"));
      if (!Number.isInteger(index) || index < 0 || index >= cells.length) continue;
      if (wall.classList.contains("trail-cell-wall--right")) addBlockedEdge(index, index + 1);
      if (wall.classList.contains("trail-cell-wall--down")) addBlockedEdge(index, index + size);
    }
    const blockedEdges = [...blockedEdgeKeys].map((edge) => edge.split(":").map(Number));
    return { rows: size, cols: size, clues, blockedEdges };
  }

  function isZipCellFilled(cell) {
    return Boolean(cell && (
      cell.classList.contains("trail-cell--filled")
      || cell.matches("[data-testid='filled-cell']")
      || cell.querySelector("[data-testid='filled-cell']")
    ));
  }

  async function solveZipGame() {
    if (acceptedSolutionVisible()) return;
    const board = await waitForBoard(parseZipBoard);
    setStatus("Finding the path…", "working");
    await nextFrame();
    const path = solvers.solveZip(board);
    setStatus("Connecting the path…", "working");
    for (let index = 0; index < path.length; index += 1) {
      if (index === path.length - 1) await waitForSignedInCompletion();
      const cell = findCellByIndex(path[index]);
      if (!cell) throw new Error(`Zip path cell ${index + 1} is missing.`);
      await clickElement(cell);
      const connected = await waitUntil(() =>
        acceptedSolutionVisible() || isZipCellFilled(findCellByIndex(path[index])),
      1800, 50);
      if (!connected) throw new Error(`Zip did not connect path cell ${index + 1}.`);
      if (acceptedSolutionVisible()) break;
    }
    if (!(await waitForAcceptedSolution(8000))) throw new Error("LinkedIn did not accept the Zip path.");
    solveSuccessMessage = "Solved with verified cell connections.";
  }

  const GAME_SOLVERS = {
    pinpoint: solvePinpointGame,
    crossclimb: solveCrossclimbGame,
    wend: solveWendGame,
    queens: solveQueensGame,
    tango: solveTangoGame,
    zip: solveZipGame,
    "mini-sudoku": solveSudokuGame,
    patches: solvePatchesGame,
  };

  async function solveCurrentGame() {
    if (solving) return;
    const game = getGame();
    if (!game || !GAME_SOLVERS[game]) {
      setStatus("This puzzle is not supported yet.", "error");
      return;
    }
    solving = true;
    solveSession = { game };
    solveStartedAt = Date.now();
    solveFirstInputAt = 0;
    solveButton.blur();
    solveButton.disabled = true;
    panel.dataset.solving = "true";
    try {
      solveSuccessMessage = "Solved!";
      setStatus("Reading the board…", "working");
      await nextFrame();
      await beginTrustedInput();
      await startGameIfNeeded();
      await dismissTutorialDialog();
      await GAME_SOLVERS[game]();
      assertStillSolving();
      setStatus(solveSuccessMessage, "success");
    } catch (error) {
      console.error("LinkedIn Puzzle Solver:", error);
      setStatus(error instanceof Error ? error.message : "Could not solve this board.", "error");
    } finally {
      await endTrustedInput();
      solving = false;
      solveSession = null;
      solveStartedAt = 0;
      solveFirstInputAt = 0;
      solveButton.disabled = false;
      delete panel.dataset.dragging;
      panel.dataset.solving = "false";
    }
  }

  createPanel();
  updatePanel();

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      updatePanel();
    } else if (!solving && getGame() !== currentGame) {
      updatePanel();
    }
    dropSolveSessionIfStale();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const navigationPoll = setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      updatePanel();
    }
    dropSolveSessionIfStale();
  }, 2000);
  addEventListener("pagehide", () => {
    observer.disconnect();
    clearInterval(navigationPoll);
  }, { once: true });
})();
