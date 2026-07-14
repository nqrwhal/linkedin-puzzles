(function startLinkedInPuzzleSolver() {
  "use strict";

  const solvers = globalThis.LinkedInLogicSolvers;
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
  let solveSuccessMessage = "Solved!";
  let lastUrl = location.href;
  let trustedInputActive = false;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  async function waitUntil(predicate, timeoutMs, intervalMs = 8) {
    const test = () => {
      try {
        return Boolean(predicate());
      } catch {
        return false;
      }
    };
    if (test()) return true;
    return new Promise((resolve) => {
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        observer.disconnect();
        clearInterval(poll);
        clearTimeout(timeout);
        resolve(value);
      };
      const check = () => {
        if (test()) finish(true);
      };
      const observer = new MutationObserver(check);
      observer.observe(document.documentElement, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
      const poll = setInterval(check, intervalMs);
      const timeout = setTimeout(() => finish(test()), timeoutMs);
    });
  }

  function acceptedSolutionVisible(includeSeeResults = true) {
    const pageText = document.body?.innerText || document.body?.textContent || "";
    return /\/results\/?$/.test(location.pathname)
      || pageText.includes("Puzzle complete!")
      || pageText.includes("Correct guess")
      || (includeSeeResults && pageText.includes("See results"))
      || /You[’']re crushing it!/.test(pageText)
      || /Solved in \d+:[0-5]\d/.test(pageText);
  }

  async function waitForAcceptedSolution(timeoutMs = 5000, includeSeeResults = true) {
    return waitUntil(() => acceptedSolutionVisible(includeSeeResults), timeoutMs, 50);
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
  }

  function createPanel() {
    if (panel?.isConnected) return;
    panel = document.createElement("aside");
    panel.id = "linkedin-logic-solver";
    panel.setAttribute("aria-label", "LinkedIn Puzzle Solver");
    panel.innerHTML = `
      <div class="lls__eyebrow">Puzzle Solver</div>
      <div class="lls__title">Detecting puzzle…</div>
      <button class="lls__solve" type="button">Solve puzzle</button>
      <div class="lls__status" role="status" aria-live="polite">Waiting for the board.</div>
    `;
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
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    title.textContent = GAME_NAMES[currentGame];
    solveButton.textContent = "Solve puzzle";
    solveButton.disabled = solving;
    if (!solving) setStatus("Board recognized. Ready to solve.");
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
    if (!steps.length) return;
    if (!trustedInputActive) throw new Error("Trusted mouse input is unavailable.");
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

  async function clickElement(element) {
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    await mouseSequence([
      { eventType: "mouseMoved", point, buttons: 0 },
      { eventType: "mousePressed", point, buttons: 1 },
      { eventType: "mouseReleased", point, buttons: 0 },
    ]);
  }

  async function insertText(text) {
    if (!trustedInputActive) throw new Error("Trusted keyboard input is unavailable.");
    const response = await chrome.runtime.sendMessage({ type: "lls-input-text", text });
    if (!response?.ok) throw new Error(response?.error || "Chrome could not type into the puzzle.");
  }

  async function pressKey(key, code, keyCode, modifiers = 0) {
    if (!trustedInputActive) throw new Error("Trusted keyboard input is unavailable.");
    const response = await chrome.runtime.sendMessage({ type: "lls-input-key", key, code, keyCode, modifiers });
    if (!response?.ok) throw new Error(response?.error || "Chrome could not press a puzzle key.");
  }

  async function pressKeys(keys, intervalMs = 20) {
    if (!trustedInputActive) throw new Error("Trusted keyboard input is unavailable.");
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
    const live = [...document.querySelectorAll("code, script")].map((element) => element.textContent || "");
    return [...new Set([...captured, ...live])];
  }

  async function parsePuzzleData(parser) {
    let lastError;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let networkSources = [];
      try {
        const response = await chrome.runtime.sendMessage({ type: "lls-puzzle-sources" });
        networkSources = response?.sources || [];
      } catch {
        // Bootstrap sources still support pages that embed their puzzle data.
      }
      try {
        return parser([...new Set([...bootstrapSources(), ...networkSources])]);
      } catch (error) {
        lastError = error;
      }
      await delay(80);
    }
    throw lastError;
  }

  async function solvePinpointGame() {
    const solutions = await parsePuzzleData(solvers.parsePinpointSolutions);
    if (/\/games\/pinpoint\/results\/?$/.test(location.pathname)) return;
    const input = document.querySelector("input[placeholder='Guess the category...'], input[aria-label='Guess the category...']");
    if (!input) {
      if ((document.querySelector("main")?.textContent || "").includes("See results")) return;
      throw new Error("Pinpoint answer field is not visible yet.");
    }
    setStatus("Submitting the category…", "working");
    await replaceInputText(input, solutions[0]);
    const guessButton = [...document.querySelectorAll("main button")].find((button) => (button.textContent || "").trim() === "Guess");
    if (guessButton) await clickElement(guessButton);
    else await pressKey("Enter", "Enter", 13);
    if (!(await waitForAcceptedSolution(4000))) throw new Error("LinkedIn did not accept the Pinpoint answer.");
  }

  function rowWord(row) {
    return row ? [...row.querySelectorAll("input")].map((input) => (input.value || "")[0] || "").join("").toUpperCase() : "";
  }

  function liveCrossclimbRow(row, rowNumber) {
    return rowNumber ? document.querySelector(`main [aria-label^='Row ${rowNumber},']`) || row : row;
  }

  async function waitForCrossclimbLetter(row, rowNumber, index, expected, timeoutMs = 240) {
    return waitUntil(() => {
      const liveRow = liveCrossclimbRow(row, rowNumber);
      const value = ((liveRow?.querySelectorAll("input")[index]?.value || "")[0] || "").toUpperCase();
      return value === expected;
    }, timeoutMs);
  }

  async function waitForCrossclimbRowWord(rowIndex, expected, timeoutMs = 360) {
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
  }

  async function finishCrossclimb() {
    let resultsButton;
    await waitUntil(() => {
      if (acceptedSolutionVisible(false)) return true;
      resultsButton = [...document.querySelectorAll("main button")].find(
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
    if (/\/games\/crossclimb\/results\/?$/.test(location.pathname)) return;
    const rungs = await parsePuzzleData(solvers.parseCrossclimbRungs);
    const ordered = rungs.slice().sort((a, b) => a.solutionRungIndex - b.solutionRungIndex);
    const middleRungs = rungs.filter((rung) => rung.solutionRungIndex > 0 && rung.solutionRungIndex < ordered.length - 1);

    const existingInputs = [...document.querySelectorAll("main input")];
    if (existingInputs.length && existingInputs.every((input) => input.disabled)) {
      if (await finishCrossclimb()) return;
      throw new Error("LinkedIn has completed Crossclimb but did not expose its results.");
    }
    let rows = [...document.querySelectorAll(".crossclimb__guess--middle")];
    if (!rows.length) {
      throw new Error("Crossclimb rows are not visible yet.");
    }

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
        const visibleText = (document.querySelector("main")?.innerText || "").replace(/\s+/g, " ");
        rung = middleRungs
          .filter((candidate) => !usedClues.has(candidate.clue))
          .sort((a, b) => b.clue.length - a.clue.length)
          .find((candidate) => candidate.clue && visibleText.includes(candidate.clue.replace(/\s+/g, " ")));
        return Boolean(rung);
      }, 300);
      if (!rung) throw new Error(`Crossclimb could not match the clue shown for row ${index + 2}.`);
      usedClues.add(rung.clue);
      await fillLetterRow(row, rung.word);
      await waitUntil(() => {
        const liveRow = liveCrossclimbRow(row, row.getAttribute("aria-label")?.match(/row\s+(\d+)/i)?.[1]);
        const inputs = [...(liveRow || row).querySelectorAll("input")];
        return inputs.length > 0 && inputs.every((letter) => letter.disabled);
      }, 500, 20);
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
      topRow = document.querySelector("main [aria-label^='Row 1,']");
      bottomRow = document.querySelector(`main [aria-label^='Row ${ordered.length},']`);
      return Boolean(topRow?.querySelector("input:not([disabled])") && bottomRow?.querySelector("input:not([disabled])"));
    }, 3000, 25);
    if (!topRow || !bottomRow) throw new Error("Crossclimb did not unlock its final rows.");

    setStatus("Entering the final pair…", "working");
    await fillLetterRow(topRow, ordered[0].word);
    await fillLetterRow(bottomRow, ordered[ordered.length - 1].word);
    if (!(await finishCrossclimb())) throw new Error("LinkedIn did not accept the Crossclimb ladder.");
  }

  function findWendGrid(puzzle) {
    const candidates = [...document.querySelectorAll("main div")].filter((element) =>
      element.children.length === puzzle.rows * puzzle.cols
      && !element.closest("[role='dialog'], [aria-modal='true'], [aria-hidden='true']"),
    );
    for (const candidate of candidates) {
      const cells = [...candidate.children];
      const matches = cells.filter((cell, index) => (cell.textContent || "").trim().toUpperCase() === puzzle.letters[index]).length;
      if (matches >= puzzle.letters.filter(Boolean).length) return cells;
    }
    throw new Error("Wend letter grid is not visible yet.");
  }

  async function solveWendGame() {
    const puzzle = await parsePuzzleData(solvers.parseWendPuzzle);
    if (/\/games\/wend\/results\/?$/.test(location.pathname) || document.querySelector("a[href*='/games/wend/results']")) return;
    setStatus("Weaving through the words…", "working");
    for (const path of puzzle.paths) {
      const cells = findWendGrid(puzzle);
      const elements = path.map((index) => cells[index]);
      if (elements.some((element) => !element)) throw new Error("A Wend solution path leaves the grid.");
      const before = elementVisualSignature(cells);
      await dragThrough(elements, { stepsPerCell: 2, stepDelay: 5 });
      await waitForVisualChange(() => findWendGrid(puzzle), before, 180);
      if (/\/results\/?$/.test(location.pathname)) return;
    }
    if (!(await waitForAcceptedSolution(4000)) && !document.querySelector("a[href*='/games/wend/results']")) {
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

  async function waitForQueensChange(index, previous, timeoutMs = 180) {
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
    const board = parseQueensBoard();
    const queenIndexes = new Set(solvers.solveQueens(board));
    setStatus("Placing queens…", "working");
    for (let index = 0; index < board.cells.length; index += 1) {
      if (/\/results\/?$/.test(location.pathname)) return;
      let cell = parseQueensBoard().cells[index];
      const wantsQueen = queenIndexes.has(index);
      if (wantsQueen) {
        const clicks = cell.state === "queen" ? 0 : cell.state === "cross" ? 1 : 2;
        for (let count = 0; count < clicks; count += 1) {
          const previous = cell.state;
          await clickElement(cell.element);
          cell = await waitForQueensChange(index, previous);
          if (!cell && acceptedSolutionVisible()) return;
          if (!cell || cell.state === previous) throw new Error(`Queens cell ${index + 1} did not accept its value.`);
        }
      } else if (cell.state === "queen") {
        const previous = cell.state;
        await clickElement(cell.element);
        cell = await waitForQueensChange(index, previous);
        if (!cell && acceptedSolutionVisible()) return;
        if (!cell || cell.state === previous) throw new Error(`Queens cell ${index + 1} did not clear.`);
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
    if (element.querySelector("[data-testid='cell-zero'], svg[aria-label='Moon']")) return 0;
    if (element.querySelector("[data-testid='cell-one'], svg[aria-label='Sun']")) return 1;
    return -1;
  }

  async function waitForTangoChange(index, previous, timeoutMs = 180) {
    let element;
    await waitUntil(() => {
      element = findCellByIndex(index);
      return !element || tangoValue(element) !== previous;
    }, timeoutMs);
    return element || findCellByIndex(index);
  }

  async function solveTangoGame() {
    const board = parseTangoBoard();
    const solution = solvers.solveTango(board);
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
        await clickElement(element);
        element = await waitForTangoChange(index, previous);
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
    for (const container of document.querySelectorAll("main div")) {
      if (container.closest("[role='dialog'], [aria-modal='true'], [aria-hidden='true']")) continue;
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

  async function waitForSudokuValue(index, expected, size, timeoutMs = 180) {
    return waitUntil(() => {
      if (acceptedSolutionVisible()) return true;
      const cell = findSudokuCells(size)[index];
      return Number((cell?.textContent || "").trim()) === expected;
    }, timeoutMs);
  }

  async function solveSudokuGame() {
    const board = parseSudokuBoard();
    const solution = solvers.solveSudoku(board);
    setStatus("Entering digits…", "working");
    for (let index = 0; index < board.cells.length; index += 1) {
      const liveCells = findSudokuCells(board.size);
      const cell = liveCells[index];
      if (!cell) throw new Error("A Mini Sudoku cell disappeared while solving.");
      const current = Number((cell.textContent || "").trim());
      if (current === solution[index]) continue;
      const beforeSelection = elementVisualSignature(liveCells);
      await clickElement(cell);
      await waitForVisualChange(() => findSudokuCells(board.size), beforeSelection, 100);
      const numberButton = document.querySelector(`button.sudoku-input-button[data-number='${solution[index]}']`)
        || [...document.querySelectorAll("main button")].find((button) => (button.textContent || "").trim() === String(solution[index]));
      if (!numberButton) throw new Error(`Mini Sudoku number button ${solution[index]} is missing.`);
      await clickElement(numberButton);
      if (!(await waitForSudokuValue(index, solution[index], board.size))) {
        throw new Error(`Mini Sudoku cell ${index + 1} did not accept its value.`);
      }
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

  async function dragThrough(elements, { stepsPerCell = 1, stepDelay = 8 } = {}) {
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
    steps.push({ eventType: "mouseReleased", point: centers[centers.length - 1], buttons: 0 });
    await mouseSequence(steps, stepDelay);
  }

  async function solvePatchesGame() {
    const board = parsePatchesBoard();
    const rectangles = solvers.solvePatches(board);
    setStatus("Drawing patches…", "working");
    for (let clueIndex = 0; clueIndex < rectangles.length; clueIndex += 1) {
      const rectangle = rectangles[clueIndex];
      const clueCell = board.clues[clueIndex].index;
      const topLeft = rectangle.r1 * board.cols + rectangle.c1;
      const bottomRight = rectangle.r2 * board.cols + rectangle.c2;
      const elements = [clueCell, topLeft, bottomRight].map((index) =>
        document.querySelector(`[data-testid='cell-${index}'][data-cell-idx]`),
      );
      if (elements.some((element) => !element)) throw new Error("A Patches rectangle cell is missing.");
      const getCells = () => [...document.querySelectorAll("[data-cell-idx][data-testid^='cell-'][aria-label]")];
      const before = elementVisualSignature(getCells());
      await dragThrough(elements, { stepDelay: 5 });
      await waitForVisualChange(getCells, before, 100);
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
    const addBlockedEdge = (index, direction) => {
      const row = Math.floor(index / size);
      const col = index % size;
      if (direction === "right" && col + 1 < size) blockedEdgeKeys.add(`${index}:${index + 1}`);
      if (direction === "down" && row + 1 < size) blockedEdgeKeys.add(`${index}:${index + size}`);
    };

    // LinkedIn hashes the wall class names in current builds. Each cell still renders
    // its grid background first, its optional clue second, and overlay pieces afterward.
    // Every wall is represented by matching same-family overlays on its two neighboring
    // cells, so pair groups whose indexes differ by one column or one row.
    const overlayGroups = new Map();
    for (const cell of cells) {
      const index = Number(cell.dataset.cellIdx);
      const hasClue = Object.values(clues).includes(index);
      const overlays = cell.classList.contains("trail-cell")
        ? [...cell.children].filter((child) => !child.matches(".trail-cell-border, .trail-cell-content"))
        : [...cell.children].slice(hasClue ? 2 : 1);
      for (const overlay of overlays) {
        const signature = overlay.className;
        if (!signature) continue;
        if (!overlayGroups.has(signature)) {
          overlayGroups.set(signature, { family: overlay.classList[0], indexes: [] });
        }
        overlayGroups.get(signature).indexes.push(index);
      }
    }
    const families = new Map();
    for (const group of overlayGroups.values()) {
      if (!families.has(group.family)) families.set(group.family, []);
      families.get(group.family).push(group.indexes);
    }
    let inferredEdges = new Set();
    for (const groups of families.values()) {
      const familyEdges = new Set();
      for (const owners of groups) {
        for (const neighbors of groups) {
          if (owners === neighbors || owners.length !== neighbors.length) continue;
          const neighborSet = new Set(neighbors);
          for (const offset of [1, size]) {
            const matches = owners.every((index) => {
              if (offset === 1 && index % size === size - 1) return false;
              return neighborSet.has(index + offset);
            });
            if (!matches) continue;
            for (const index of owners) familyEdges.add(`${index}:${index + offset}`);
          }
        }
      }
      if (familyEdges.size > inferredEdges.size) inferredEdges = familyEdges;
    }
    for (const edge of inferredEdges) blockedEdgeKeys.add(edge);

    // Retain compatibility with older LinkedIn builds that used semantic classes.
    for (const wall of document.querySelectorAll(".trail-cell-wall")) {
      const owner = wall.closest("[data-cell-idx]");
      const index = Number(owner?.getAttribute("data-cell-idx"));
      if (!Number.isInteger(index) || index < 0 || index >= cells.length) continue;
      if (wall.classList.contains("trail-cell-wall--right")) addBlockedEdge(index, "right");
      if (wall.classList.contains("trail-cell-wall--down")) addBlockedEdge(index, "down");
    }
    const blockedEdges = [...blockedEdgeKeys].map((edge) => edge.split(":").map(Number));
    return { rows: size, cols: size, clues, blockedEdges };
  }

  async function solveZipGame() {
    const board = parseZipBoard();
    setStatus("Finding the path…", "working");
    await nextFrame();
    const path = solvers.solveZip(board);
    setStatus("Drawing the path…", "working");
    const elements = path.map((index) => findCellByIndex(index));
    if (elements.some((element) => !element)) throw new Error("A Zip path cell is missing.");

    // Zip accepts a pointer move at each cell center. One continuous drag uses
    // about half as many trusted protocol events as keydown + keyup per cell.
    await dragThrough(elements, { stepsPerCell: 1, stepDelay: 3 });
    if (await waitForAcceptedSolution(1500)) {
      solveSuccessMessage = "Solved by drag!";
      return;
    }

    // A layout change or dropped pointer move can leave a partial path. Clicking
    // checkpoint 1 truncates it back to the start before the proven key fallback.
    setStatus("Retrying Zip with arrow keys…", "working");
    const start = findCellByIndex(path[0]);
    if (!start) {
      if (acceptedSolutionVisible()) return;
      throw new Error("The Zip start cell disappeared after drawing the path.");
    }
    const before = elementVisualSignature(findIndexedCells());
    await clickElement(start);
    await waitForVisualChange(findIndexedCells, before, 120);
    const directions = {
      [-board.cols]: ["ArrowUp", "ArrowUp", 38],
      [board.cols]: ["ArrowDown", "ArrowDown", 40],
      [-1]: ["ArrowLeft", "ArrowLeft", 37],
      [1]: ["ArrowRight", "ArrowRight", 39],
    };
    const keySequence = [];
    for (let index = 1; index < path.length; index += 1) {
      const direction = directions[path[index] - path[index - 1]];
      if (!direction) throw new Error("The Zip route contains non-adjacent cells.");
      keySequence.push({ key: direction[0], code: direction[1], keyCode: direction[2] });
    }
    await pressKeys(keySequence, 12);
    if (!(await waitForAcceptedSolution())) throw new Error("LinkedIn did not accept the Zip path.");
    solveSuccessMessage = "Solved by arrow fallback.";
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
    solveButton.disabled = true;
    panel.dataset.solving = "true";
    try {
      solveSuccessMessage = "Solved!";
      setStatus("Reading the board…", "working");
      await nextFrame();
      await beginTrustedInput();
      await dismissTutorialDialog();
      await GAME_SOLVERS[game]();
      setStatus(solveSuccessMessage, "success");
    } catch (error) {
      console.error("LinkedIn Puzzle Solver:", error);
      setStatus(error instanceof Error ? error.message : "Could not solve this board.", "error");
    } finally {
      await endTrustedInput();
      solving = false;
      solveButton.disabled = false;
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
    } else if (currentGame && status?.textContent === "Waiting for the board.") {
      setStatus("Board recognized. Ready to solve.");
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      updatePanel();
    }
  }, 750);
})();
