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
  let lastUrl = location.href;
  let trustedInputActive = false;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  async function waitForAcceptedSolution(timeoutMs = 2500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const mainText = document.querySelector("main")?.textContent || "";
      if (/\/results\/?$/.test(location.pathname) || mainText.includes("Puzzle complete!") || mainText.includes("See results")) return true;
      await delay(100);
    }
    return false;
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
    solveButton.disabled = solving;
    if (!solving) setStatus("Board recognized. Ready to solve.");
  }

  function squareSize(count, gameName) {
    const size = Math.sqrt(count);
    if (!Number.isInteger(size)) throw new Error(`${gameName} board is not square.`);
    return size;
  }

  async function beginTrustedInput() {
    if (!globalThis.chrome?.runtime?.id) return;
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

  async function mouseStep(element, eventType, point, buttons) {
    if (trustedInputActive) {
      const response = await chrome.runtime.sendMessage({
        type: "lls-input-event",
        eventType,
        x: point.x,
        y: point.y,
        button: eventType === "mousePressed" || eventType === "mouseReleased" ? "left" : "none",
        buttons,
        clickCount: eventType === "mousePressed" || eventType === "mouseReleased" ? 1 : 0,
      });
      if (!response?.ok) throw new Error(response?.error || "Chrome could not send puzzle input.");
      return;
    }

    const domType = eventType === "mousePressed" ? "mousedown" : eventType === "mouseReleased" ? "mouseup" : "mousemove";
    element.dispatchEvent(new MouseEvent(domType, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: point.x,
      clientY: point.y,
      screenX: point.x,
      screenY: point.y,
      buttons,
      button: domType === "mousedown" ? 0 : -1,
      view: window,
    }));
  }

  async function clickElement(element) {
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    await mouseStep(element, "mouseMoved", point, 0);
    await mouseStep(element, "mousePressed", point, 1);
    await mouseStep(element, "mouseReleased", point, 0);
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

  async function replaceInputText(element, text, characterByCharacter = false) {
    await clickElement(element);
    await pressKey("a", "KeyA", 65, /Mac|iPhone|iPad/.test(navigator.platform) ? 4 : 2);
    await pressKey("Backspace", "Backspace", 8);
    if (characterByCharacter) {
      for (const character of text) {
        await insertText(character);
        await delay(24);
      }
    } else {
      await insertText(text);
    }
  }

  function bootstrapSources() {
    const captured = globalThis.LinkedInPuzzleBootstrap?.captureVisible?.() || [];
    const live = [...document.querySelectorAll("code, script")].map((element) => element.textContent || "");
    return [...new Set([...captured, ...live])];
  }

  async function solvePinpointGame() {
    const solutions = solvers.parsePinpointSolutions(bootstrapSources());
    if (/\/games\/pinpoint\/results\/?$/.test(location.pathname)) return;
    const input = document.querySelector("input[placeholder='Guess the category...'], input[aria-label='Guess the category...']");
    if (!input) {
      if ((document.querySelector("main")?.textContent || "").includes("See results")) return;
      throw new Error("Pinpoint answer field is not visible yet.");
    }
    setStatus("Submitting the category…", "working");
    await replaceInputText(input, solutions[0]);
    await pressKey("Enter", "Enter", 13);
    if (!(await waitForAcceptedSolution(4000))) throw new Error("LinkedIn did not accept the Pinpoint answer.");
  }

  function rowWord(row) {
    return [...row.querySelectorAll("input")].map((input) => (input.value || "")[0] || "").join("").toUpperCase();
  }

  async function fillLetterRow(row, word) {
    const inputs = [...row.querySelectorAll("input")];
    if (inputs.length !== word.length) throw new Error(`Crossclimb expected ${word.length} letter boxes.`);
    for (let index = 0; index < inputs.length; index += 1) {
      if (((inputs[index].value || "")[0] || "").toUpperCase() === word[index]) continue;
      await replaceInputText(inputs[index], word[index]);
      await delay(22);
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
    await mouseStep(handle, "mouseMoved", from, 0);
    await mouseStep(handle, "mousePressed", from, 1);
    for (let step = 1; step <= 5; step += 1) {
      const point = { x: from.x, y: from.y + ((to.y - from.y) * step) / 5 };
      await mouseStep(handle, "mouseMoved", point, 1);
      await delay(24);
    }
    await mouseStep(target, "mouseReleased", to, 0);
    await delay(320);
  }

  async function solveCrossclimbGame() {
    if (/\/games\/crossclimb\/results\/?$/.test(location.pathname)) return;
    const rungs = solvers.parseCrossclimbRungs(bootstrapSources());
    const ordered = rungs.slice().sort((a, b) => a.solutionRungIndex - b.solutionRungIndex);
    const middleInClueOrder = rungs.filter((rung) => rung.solutionRungIndex > 0 && rung.solutionRungIndex < ordered.length - 1);

    const existingInputs = [...document.querySelectorAll("main input")];
    if (existingInputs.length && existingInputs.every((input) => input.disabled)) return;
    let rows = [...document.querySelectorAll(".crossclimb__guess--middle")];
    if (!rows.length) {
      throw new Error("Crossclimb rows are not visible yet.");
    }

    setStatus("Answering the clues…", "working");
    if (rows.length !== middleInClueOrder.length) throw new Error("Crossclimb clue count does not match its puzzle data.");
    for (let index = 0; index < rows.length; index += 1) {
      await fillLetterRow(rows[index], middleInClueOrder[index].word);
      await delay(120);
    }

    setStatus("Ordering the word ladder…", "working");
    const desired = ordered.slice(1, -1).map((rung) => rung.word);
    for (let targetIndex = 0; targetIndex < desired.length; targetIndex += 1) {
      rows = [...document.querySelectorAll(".crossclimb__guess--middle")];
      if (rowWord(rows[targetIndex]) === desired[targetIndex]) continue;
      const sourceIndex = rows.findIndex((row) => rowWord(row) === desired[targetIndex]);
      if (sourceIndex < 0) throw new Error(`Crossclimb row ${desired[targetIndex]} is missing.`);
      await dragRowBefore(rows[sourceIndex], rows[targetIndex], sourceIndex < targetIndex);
      rows = [...document.querySelectorAll(".crossclimb__guess--middle")];
      if (rowWord(rows[targetIndex]) !== desired[targetIndex]) {
        const retryIndex = rows.findIndex((row) => rowWord(row) === desired[targetIndex]);
        if (retryIndex < 0) throw new Error(`Crossclimb could not locate ${desired[targetIndex]} after dragging.`);
        await dragRowBefore(rows[retryIndex], rows[targetIndex], retryIndex < targetIndex);
      }
    }

    const deadline = Date.now() + 3000;
    let topRow;
    let bottomRow;
    while (Date.now() < deadline) {
      topRow = document.querySelector("main [aria-label^='Row 1,']");
      bottomRow = document.querySelector(`main [aria-label^='Row ${ordered.length},']`);
      if (topRow?.querySelector("input:not([disabled])") && bottomRow?.querySelector("input:not([disabled])")) break;
      await delay(100);
    }
    if (!topRow || !bottomRow) throw new Error("Crossclimb did not unlock its final rows.");

    setStatus("Entering the final pair…", "working");
    await fillLetterRow(topRow, ordered[0].word);
    await delay(180);
    await fillLetterRow(bottomRow, ordered[ordered.length - 1].word);
    await delay(500);
    const inputs = [...document.querySelectorAll("main input")];
    if (!/\/results\/?$/.test(location.pathname) && (!inputs.length || !inputs.every((input) => input.disabled))) {
      throw new Error("LinkedIn did not accept the Crossclimb ladder.");
    }
  }

  function findWendGrid(puzzle) {
    const candidates = [...document.querySelectorAll("main div")].filter((element) => element.children.length === puzzle.rows * puzzle.cols);
    for (const candidate of candidates) {
      const cells = [...candidate.children];
      const matches = cells.filter((cell, index) => (cell.textContent || "").trim().toUpperCase() === puzzle.letters[index]).length;
      if (matches >= puzzle.letters.filter(Boolean).length) return cells;
    }
    throw new Error("Wend letter grid is not visible yet.");
  }

  async function solveWendGame() {
    const puzzle = solvers.parseWendPuzzle(bootstrapSources());
    if (/\/games\/wend\/results\/?$/.test(location.pathname) || document.querySelector("a[href*='/games/wend/results']")) return;
    const cells = findWendGrid(puzzle);
    setStatus("Weaving through the words…", "working");
    for (const path of puzzle.paths) {
      const elements = path.map((index) => cells[index]);
      if (elements.some((element) => !element)) throw new Error("A Wend solution path leaves the grid.");
      await dragThrough(elements);
      if (/\/results\/?$/.test(location.pathname)) return;
    }
    if (!(await waitForAcceptedSolution(4000)) && !document.querySelector("a[href*='/games/wend/results']")) {
      throw new Error("LinkedIn did not accept the Wend paths.");
    }
  }

  function parseQueensBoard() {
    const parsed = [];
    for (const element of document.querySelectorAll("button[aria-label], [role='button'][aria-label]")) {
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
          await clickElement(cell.element);
          await delay(30);
          cell = parseQueensBoard().cells[index];
        }
      } else if (cell.state === "queen") {
        await clickElement(cell.element);
        await delay(30);
      }
    }
  }

  function parseTangoBoard() {
    const cells = [...document.querySelectorAll("[data-cell-idx][data-testid^='cell-']")]
      .filter((element) => element.querySelector("[data-testid='cell-zero'], [data-testid='cell-one']") || element.getAttribute("role") === "button")
      .sort((a, b) => Number(a.dataset.cellIdx) - Number(b.dataset.cellIdx));
    if (!cells.length) throw new Error("Tango cells are not visible yet.");
    const size = squareSize(cells.length, "Tango");
    const givens = {};
    const relations = [];

    for (const element of cells) {
      const index = Number(element.dataset.cellIdx);
      const state = element.querySelector("[data-testid='cell-zero']") ? 0 : element.querySelector("[data-testid='cell-one']") ? 1 : -1;
      if (element.getAttribute("aria-disabled") === "true" && state !== -1) givens[index] = state;
      const cellRect = element.getBoundingClientRect();
      for (const marker of element.querySelectorAll("svg[aria-label='Equal'], svg[aria-label='Cross']")) {
        const markerRect = marker.getBoundingClientRect();
        const dx = markerRect.left + markerRect.width / 2 - (cellRect.left + cellRect.width / 2);
        const dy = markerRect.top + markerRect.height / 2 - (cellRect.top + cellRect.height / 2);
        const other = Math.abs(dx) > Math.abs(dy) ? index + 1 : index + size;
        if (other >= 0 && other < cells.length) relations.push({ a: index, b: other, same: marker.getAttribute("aria-label") === "Equal" });
      }
    }
    return { size, cells, givens, relations };
  }

  function tangoState(element) {
    if (element.querySelector("[data-testid='cell-zero']")) return 1;
    if (element.querySelector("[data-testid='cell-one']")) return 2;
    return 0;
  }

  async function solveTangoGame() {
    const board = parseTangoBoard();
    const solution = solvers.solveTango(board);
    setStatus("Filling suns and moons…", "working");
    for (let index = 0; index < board.cells.length; index += 1) {
      let element = document.querySelector(`[data-testid='cell-${index}'][data-cell-idx]`);
      if (!element || element.getAttribute("aria-disabled") === "true") continue;
      const target = solution[index] === 0 ? 1 : 2;
      let clicks = (target - tangoState(element) + 3) % 3;
      while (clicks > 0) {
        await clickElement(element);
        await delay(35);
        element = document.querySelector(`[data-testid='cell-${index}'][data-cell-idx]`);
        clicks -= 1;
      }
    }
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
      if (col + 1 < size && !cells[index].classList.contains("sudoku-cell-wall-right") && !cells[index + 1].classList.contains("sudoku-cell-wall-left")) join(index, index + 1);
      if (row + 1 < size && !cells[index].classList.contains("sudoku-cell-wall-bottom") && !cells[index + size].classList.contains("sudoku-cell-wall-top")) join(index, index + size);
    }
    const labels = new Map();
    return parent.map((_, index) => {
      const root = find(index);
      if (!labels.has(root)) labels.set(root, labels.size);
      return labels.get(root);
    });
  }

  function parseSudokuBoard() {
    const cells = [...document.querySelectorAll(".sudoku-cell[data-cell-idx]")].sort((a, b) => Number(a.dataset.cellIdx) - Number(b.dataset.cellIdx));
    if (!cells.length) throw new Error("Mini Sudoku cells are not visible yet.");
    const size = squareSize(cells.length, "Mini Sudoku");
    const givens = {};
    for (const cell of cells) {
      if (!cell.classList.contains("sudoku-cell-prefilled")) continue;
      const value = Number((cell.textContent || "").trim());
      if (value) givens[Number(cell.dataset.cellIdx)] = value;
    }
    return { size, cells, givens, regions: sudokuRegions(cells, size) };
  }

  async function solveSudokuGame() {
    const board = parseSudokuBoard();
    const solution = solvers.solveSudoku(board);
    setStatus("Entering digits…", "working");
    for (let index = 0; index < board.cells.length; index += 1) {
      let cell = document.querySelector(`.sudoku-cell[data-cell-idx='${index}']`);
      if (!cell || cell.classList.contains("sudoku-cell-prefilled")) continue;
      const current = Number((cell.querySelector(".sudoku-cell-content")?.textContent || "").trim());
      if (current === solution[index]) continue;
      await clickElement(cell);
      await delay(25);
      const numberButton = document.querySelector(`button.sudoku-input-button[data-number='${solution[index]}']`);
      if (!numberButton) throw new Error(`Mini Sudoku number button ${solution[index]} is missing.`);
      await clickElement(numberButton);
      await delay(30);
    }
  }

  function parsePatchesBoard() {
    const cells = [...document.querySelectorAll("[data-cell-idx][data-testid^='cell-'][aria-label]")]
      .filter((element) => /^Row \d+, column \d+/i.test(element.getAttribute("aria-label") || ""))
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
    return { rows: size, cols: size, cells, clues };
  }

  async function dragThrough(elements) {
    const centers = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    const start = elements[0];
    const startRect = start.getBoundingClientRect();
    const pressPoint = { x: startRect.left + 5, y: startRect.top + 5 };
    const thresholdPoint = { x: startRect.right - 5, y: startRect.bottom - 5 };
    await mouseStep(start, "mouseMoved", pressPoint, 0);
    await mouseStep(start, "mousePressed", pressPoint, 1);
    await delay(14);
    // LinkedIn's grid starts a drag from offsetX/offsetY, so deliberately
    // cross the drag threshold while keeping the same cell as the target.
    await mouseStep(start, "mouseMoved", thresholdPoint, 1);
    await delay(14);
    for (let index = 1; index < elements.length; index += 1) {
      await mouseStep(elements[index], "mouseMoved", centers[index], 1);
      await delay(16);
    }
    const end = elements[elements.length - 1];
    await mouseStep(end, "mouseReleased", centers[centers.length - 1], 0);
    await delay(180);
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
      await dragThrough(elements);
    }
    if (!(await waitForAcceptedSolution())) throw new Error("LinkedIn did not accept the Patches solution.");
  }

  function parseZipBoard() {
    const cells = [...document.querySelectorAll("[data-cell-idx][data-testid^='cell-']")]
      .filter((element) => /^cell-\d+$/.test(element.getAttribute("data-testid") || ""))
      .sort((a, b) => Number(a.dataset.cellIdx) - Number(b.dataset.cellIdx));
    if (!cells.length) throw new Error("Zip cells are not visible yet.");
    const size = squareSize(cells.length, "Zip");
    const clues = {};
    for (const cell of cells) {
      const value = Number((cell.querySelector("[data-cell-content]")?.textContent || "").trim());
      if (value) clues[value] = Number(cell.dataset.cellIdx);
    }
    return { rows: size, cols: size, cells, clues };
  }

  async function solveZipGame() {
    const board = parseZipBoard();
    setStatus("Finding the path…", "working");
    await nextFrame();
    const path = solvers.solveZip(board);
    setStatus("Drawing the path…", "working");
    const elements = path.map((index) => document.querySelector(`[data-testid='cell-${index}'][data-cell-idx]`));
    if (elements.some((element) => !element)) throw new Error("A Zip path cell is missing.");
    await dragThrough(elements);
    if (!(await waitForAcceptedSolution())) throw new Error("LinkedIn did not accept the Zip path.");
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
      setStatus("Reading the board…", "working");
      await nextFrame();
      await beginTrustedInput();
      await GAME_SOLVERS[game]();
      setStatus("Solved!", "success");
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
