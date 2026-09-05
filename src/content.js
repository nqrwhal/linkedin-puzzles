(function startLinkedInPuzzleRequests() {
  "use strict";
  if (globalThis.__linkedinRequestSolverLoaded) return;
  globalThis.__linkedinRequestSolverLoaded = true;
  if (window.top === window && document.querySelector("iframe[src*='/games/view/']")) return;

  const parsers = globalThis.LinkedInPuzzleParsers;
  const requests = globalThis.LinkedInGameRequests;
  const games = { pinpoint: "Pinpoint", crossclimb: "Crossclimb", queens: "Queens", tango: "Tango",
    zip: "Zip", patches: "Patches", wend: "Wend", "mini-sudoku": "Mini Sudoku" };
  const voyagerIds = { pinpoint: "1", crossclimb: "2", "mini-sudoku": "7" };
  const pendingKey = "llsPendingRequest";
  let panel, status, solveButton;
  let solving = false;
  let currentUrl = location.href;

  function currentGame() {
    return location.pathname.match(/^\/games\/(?:view\/)?([^/]+)/)?.[1];
  }

  function completed() {
    return /\/results\/?$/.test(location.pathname)
      || [...document.querySelectorAll("a,button")].some((el) =>
        !el.closest("#linkedin-logic-solver") && (el.textContent || "").trim() === "See results");
  }

  function setStatus(text, state = "idle") {
    status.textContent = text;
    status.dataset.state = state;
  }

  async function message(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...extra });
    if (!response?.ok) throw new Error(response?.error || "The extension could not read this game's data.");
    return response;
  }

  function assertPage(url) {
    if (location.href !== url) throw new Error("Request cancelled because the puzzle page changed.");
  }

  async function delay(ms, url) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    assertPage(url);
  }

  function localSources() {
    const retained = globalThis.LinkedInPuzzleBootstrap?.captureVisible?.() || [];
    const live = [...document.querySelectorAll("script,code")].map((el) => el.textContent || "")
      .filter((text) => text.length <= 4 * 1024 * 1024);
    return [...new Set([...retained, ...live])];
  }

  async function prepareVoyager(game, url) {
    let lastError;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      assertPage(url);
      const sources = localSources();
      if (attempt > 0) sources.push(...(await message("lls-puzzle-sources")).sources);
      try {
        const state = game === "pinpoint"
          ? { blueprintGameState: [parsers.parsePinpointSolutions(sources)[0]] }
          : game === "crossclimb"
            ? requests.crossclimbState(parsers.parseCrossclimbRungs(sources))
            : requests.sudokuState(parsers.parseSudokuPuzzle(sources));
        const urn = requests.gameUrn(sources, voyagerIds[game]);
        if (!urn) throw new Error("LinkedIn has not supplied this game's save identifier.");
        return { state, urn };
      } catch (error) {
        lastError = error;
      }
      await delay(250, url);
    }
    throw lastError;
  }

  function csrfToken() {
    const token = document.cookie.match(/JSESSIONID="?([^;"]+)/)?.[1];
    if (!token) throw new Error("Sign in to LinkedIn to save a completed game.");
    return token;
  }

  async function sendSave(endpoint, body, headers, url) {
    assertPage(url);
    const response = await fetch(endpoint, {
      method: "POST", credentials: "include", headers: { ...headers, "csrf-token": csrfToken() },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    assertPage(url);
    if (!response.ok) throw new Error(`LinkedIn rejected the save: HTTP ${response.status}.`);
    return response;
  }

  async function submitVoyager(game, url, startedAt) {
    const { state, urn } = await prepareVoyager(game, url);
    const { queryId } = await message("lls-game-query-id");
    if (!queryId) throw new Error("LinkedIn's save-query identifier is unavailable.");
    if (game !== "pinpoint") await delay(Math.max(0, 2000 - (Date.now() - startedAt)), url);
    const body = requests.voyagerSave(game, urn, queryId, state, Date.now() - startedAt);
    const response = await sendSave(
      `https://www.linkedin.com/voyager/api/graphql?action=execute&queryId=${encodeURIComponent(queryId)}`,
      body, { accept: "application/vnd.linkedin.normalized+json+2.1",
        "content-type": "application/json; charset=UTF-8",
        "x-li-pem-metadata": "Voyager - Games=game-state-update-post",
        "x-restli-protocol-version": "2.0.0" }, url);
    requests.voyagerResponse(await response.json(), urn);
  }

  async function submitSdui(game, url, startedAt) {
    let context;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      context = await message("lls-request-context");
      assertPage(url);
      if (context.game && context.template) break;
      await delay(250, url);
    }
    if (!context?.game || !context?.template) {
      throw new Error("LinkedIn's puzzle or initial save contract is unavailable. Open the board and retry.");
    }
    await delay(Math.max(0, 2000 - (Date.now() - startedAt)), url);
    const body = requests[game + "Save"](context.game, context.template, Date.now() - startedAt);
    const response = await sendSave("https://www.linkedin.com/flagship-web/rsc-action/actions/server-request",
      body, { "Content-Type": "application/json", "x-li-rsc-stream": "true" }, url);
    const path = requests.sduiResponse(await response.text());
    if (path !== `/games/${game}/results/`) throw new Error("Save response belongs to another game.");
  }

  async function solve() {
    if (solving) return;
    if (completed()) { setStatus("This game is already completed.", "success"); return; }
    const game = currentGame();
    if (!games[game]) return;
    const url = location.href;
    const startedAt = Date.now();
    solving = true;
    solveButton.disabled = true;
    try {
      csrfToken();
      setStatus("Reading LinkedIn's solution…", "working");
      await message("lls-capture-start");
      if (voyagerIds[game]) await submitVoyager(game, url, startedAt);
      else await submitSdui(game, url, startedAt);
      assertPage(url);
      sessionStorage.setItem(pendingKey, JSON.stringify({ game, path: location.pathname, savedAt: Date.now() }));
      setStatus("Save accepted. Reloading to verify…", "working");
      location.reload();
    } catch (error) {
      setStatus(error.message || String(error), "error");
    } finally {
      solving = false;
      solveButton.disabled = false;
    }
  }

  async function verifyPending() {
    let pending;
    try { pending = JSON.parse(sessionStorage.getItem(pendingKey)); } catch { /* Ignore malformed page storage. */ }
    if (!pending) return;
    sessionStorage.removeItem(pendingKey);
    if (pending.game !== currentGame() || pending.path !== location.pathname
      || Date.now() - pending.savedAt > 120000) return;
    const url = location.href;
    solving = true;
    solveButton.disabled = true;
    setStatus("Verifying the saved board…", "working");
    try {
      for (let attempt = 0; attempt < 48; attempt += 1) {
        if (completed()) { setStatus("Solved by request. Verified after reload.", "success"); return; }
        await delay(250, url);
      }
      throw new Error("Save was not confirmed after reload. No UI fallback was attempted.");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      solving = false;
      solveButton.disabled = false;
    }
  }

  function updatePanel() {
    const game = currentGame();
    panel.hidden = !games[game];
    panel.querySelector(".lls__title").textContent = games[game] || "Puzzle Solver";
    if (!solving) setStatus(completed() ? "This game is already completed." : "Ready to solve by request.");
    if (games[game]) void message("lls-capture-start").catch(() => {});
  }

  panel = document.createElement("aside");
  panel.id = "linkedin-logic-solver";
  panel.setAttribute("aria-label", "LinkedIn Puzzle Solver");
  panel.innerHTML = `
    <div class="lls__eyebrow">Puzzle Solver · ${chrome.runtime.getManifest().version}</div>
    <div class="lls__title"></div>
    <button class="lls__solve" type="button">Solve by request</button>
    <div class="lls__status" role="status" aria-live="polite"></div>
    <details class="lls__diagnostics"><summary>Game capture</summary><button type="button">Refresh capture</button><pre></pre></details>`;
  document.documentElement.appendChild(panel);
  status = panel.querySelector(".lls__status");
  solveButton = panel.querySelector(".lls__solve");
  solveButton.addEventListener("click", () => void solve());
  panel.querySelector(".lls__diagnostics button").addEventListener("click", async () => {
    const report = panel.querySelector("pre");
    try { report.textContent = JSON.stringify((await message("lls-debug-requests", { all: true })).requests, null, 2); }
    catch (error) { report.textContent = error.message; }
  });
  updatePanel();
  void verifyPending();
  const navigation = setInterval(() => {
    if (location.href === currentUrl) return;
    currentUrl = location.href;
    updatePanel();
  }, 1000);
  addEventListener("pagehide", () => clearInterval(navigation), { once: true });
})();
