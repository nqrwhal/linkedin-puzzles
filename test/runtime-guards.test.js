const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const content = fs.readFileSync(path.join(root, "src/content.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/content.css"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "src/bootstrap.js"), "utf8");
const background = fs.readFileSync(path.join(root, "src/background.js"), "utf8");

test("solver panel cannot intercept trusted input while solving", () => {
  assert.match(styles, /data-solving="true"[\s\S]*?pointer-events:\s*none/);
  assert.match(content, /solving = true;[\s\S]*?solveButton\.blur\(\);/);
  assert.match(content, /panel\.dataset\.dragging = "true";[\s\S]*?finally \{\s*delete panel\.dataset\.dragging;/);
});

test("runtime waits avoid high-frequency polling and tolerate slow renders", () => {
  assert.match(content, /DOM_POLL_FLOOR_MS = 40/);
  assert.match(content, /RENDER_SETTLE_TIMEOUT_MS = 1200/);
  assert.doesNotMatch(content, /setInterval\([^)]*,\s*8\)/);
  assert.match(content, /Patches rectangle \$\{clueIndex \+ 1\} did not render after retrying/);
});

test("capture and debugger resources have explicit bounds and cleanup", () => {
  assert.match(bootstrap, /if \(!isWordGame\) return;/);
  assert.match(bootstrap, /MAX_TOTAL_SOURCE_CHARS = 12 \* 1024 \* 1024/);
  assert.match(bootstrap, /setTimeout\(\(\) => observer\.disconnect\(\), 30000\)/);
  assert.match(background, /attachPromises = new Map\(\)/);
  assert.match(background, /pageScanTimes = new Map\(\)[\s\S]*?Date\.now\(\) - lastPageScan >= 750/);
  assert.match(background, /previous && previous !== route[\s\S]*?puzzleSources\.delete\(tabId\)/);
  assert.match(background, /entries\.length > 6[\s\S]*?12 \* 1024 \* 1024/);
  assert.match(background, /!\/json\/i\.test\(mimeType\)/);
  assert.match(background, /for \(const kind of \["Props", "Fiber"\]\)/);
  assert.match(background, /onUpdated[\s\S]*?primeCapture\(tabId, url\)/);
  assert.match(content, /PUZZLE_DATA_ATTEMPTS = 32/);
});

test("Zip reads rendered wall geometry and verifies each connected cell", () => {
  assert.match(content, /getComputedStyle\(overlay, "::after"\)/);
  assert.match(content, /borderRightWidth[\s\S]*?borderLeftWidth[\s\S]*?borderBottomWidth[\s\S]*?borderTopWidth/);
  assert.match(content, /function isZipCellFilled\(cell\)[\s\S]*?trail-cell--filled[\s\S]*?data-testid='filled-cell'/);
  assert.match(content, /isZipCellFilled\(findCellByIndex\(path\[index\]\)\)/);
  assert.match(content, /for \(let index = 0; index < path\.length; index \+= 1\)[\s\S]*?await clickElement\(cell\)[\s\S]*?Zip did not connect path cell/);
  assert.doesNotMatch(content, /solveSignedInZip|verified arrow moves/);
});

test("Wend uses bounded word gestures and verifies every path cell", () => {
  assert.match(content, /async function dragWendWord\(elements, attempt\)/);
  assert.match(content, /new Touch\([\s\S]*?new TouchEvent\(eventType[\s\S]*?dispatch\("touchend"/);
  assert.match(content, /for \(const element of elements\.slice\(1\)\)[\s\S]*?dispatch\("touchmove"/);
  assert.match(content, /solveWendGame[\s\S]*?path\.every\([\s\S]*?data-cell-is-locked/);
  assert.match(content, /let committed = pathRendered\(\)/);
  assert.match(content, /attempt < 3[\s\S]*?Wend word \$\{pathIndex \+ 1\} did not commit after three gestures/);
  assert.match(content, /waitForBoard\(\(\) => findWendGrid\(puzzle\), RENDER_SETTLE_TIMEOUT_MS\)/);
});

test("Wend touch input stays page-local instead of depending on the service worker", () => {
  assert.doesNotMatch(content, /lls-input-touch-events/);
  assert.doesNotMatch(background, /Input\.dispatchTouchEvent|lls-input-touch-events/);
});

test("word-game sources clear before navigation and survive content-script startup", () => {
  assert.match(background, /changeInfo\.status === "loading"[\s\S]*?puzzleSources\.delete\(tabId\)/);
  assert.match(background, /async function startCapture\(tabId, url\)[\s\S]*?await primeCapture/);
  assert.doesNotMatch(background, /captureDocuments/);
  assert.doesNotMatch(background, /async function startCapture[\s\S]{0,500}?puzzleSources\.delete/);
});

test("signed-in solves hold only their final move to a two-second floor", () => {
  assert.match(content, /SOLVE_SAFE_FLOOR_MS = 2000/);
  assert.match(content, /async function waitForSignedInCompletion\(\)[\s\S]*?SOLVE_SAFE_FLOOR_MS - \(Date\.now\(\) - \(solveFirstInputAt \|\| solveStartedAt\)\)/);
  assert.doesNotMatch(content, /SIGNED_IN_COMPLETION_FLOORS_MS|SIGNED_IN_ACTION_SETTLE_MS|settleSignedInAction/);
  const floors = content.match(/waitForSignedInCompletion\(\)/g) || [];
  assert.ok(floors.length >= 8, `expected one floor per final action, found ${floors.length}`);
  assert.doesNotMatch(content, /replaceInputText\(input, solutions\[0\]\);[\s\S]{0,120}waitForSignedInCompletion/);
  assert.match(content, /pendingClicks === 1[\s\S]*?await waitForSignedInCompletion\(\)/);
  assert.match(content, /pendingCells === 1[\s\S]*?await waitForSignedInCompletion\(\)/);
  assert.match(content, /index === path\.length - 1[\s\S]*?await waitForSignedInCompletion\(\)/);
  assert.match(content, /clueIndex === rectangles\.length - 1[\s\S]*?await waitForSignedInCompletion\(\)/);
  assert.match(content, /SIGNED_IN_SAVE_SETTLE_MS = 800[\s\S]*?waitUntil\(saveErrorVisible, SIGNED_IN_SAVE_SETTLE_MS/);
  assert.match(content, /solveFirstInputAt \|\| solveStartedAt/);
  assert.match(content, /issue saving your game/);
});

test("a parked cursor over the panel cannot leak input into the page", () => {
  assert.match(styles, /\.lls__shield[\s\S]*?pointer-events:\s*auto/);
  assert.match(styles, /\[data-solving="true"\] \.lls__shield[\s\S]*?display:\s*block/);
  assert.match(styles, /\[data-dragging="true"\] \.lls__shield/);
  assert.match(content, /lls__shield/);
  assert.match(content, /event\.preventDefault\(\);\s*\n\s*event\.stopImmediatePropagation\(\);/);
  assert.match(content, /"pointerdown", "pointermove", "pointerup"/);
  assert.match(content, /function elementFullyInView\(element\)/);
  assert.match(content, /if \(!elementFullyInView\(element\)\) element\.scrollIntoView/);
});

test("word-game capture persists for the whole visit and survives worker restarts", () => {
  assert.match(background, /CAPTURE_LEASE_MS = 15 \* 60 \* 1000/);
  assert.match(background, /function stopCapture\(tabId\)/);
  assert.match(background, /stopCapture\(tabId\);\s*\n\s*return;/);
  assert.match(background, /chrome\.storage\.session\?\.get\("llsPuzzleState"\)/);
  assert.match(background, /function persistSessionState/);
  assert.match(background, /await loadSessionState\(\);/);
  assert.match(background, /already attached/i);
  assert.match(background, /Another debugger such as DevTools/);
  assert.match(background, /MAX_PERSISTED_SOURCE_CHARS = 6 \* 1024 \* 1024/);
  assert.match(background, /method !== "Network\.responseReceived"\) return;\s*\n\s*captureTabs\.add\(tabId\)/);
});

test("solves keep working in occluded and background tabs", () => {
  assert.match(content, /requestAnimationFrame\(\(\) => requestAnimationFrame\(finish\)\);\s*\n\s*setTimeout\(finish, 120\)/);
  assert.doesNotMatch(content, /const nextFrame = \(\) => new Promise\(\(resolve\) => requestAnimationFrame/);
});

test("single-request solves are stateless replays of the page's own save call", () => {
  assert.match(background, /DEFAULT_GAME_QUERY_ID = "voyagerIdentityDashGames\.[0-9a-f]+"/);
  assert.match(background, /observedGameQueryId/);
  assert.match(background, /message\?\.type === "lls-game-query-id"/);
  assert.match(background, /return \{ ok: true, queryId: observedGameQueryId \|\| DEFAULT_GAME_QUERY_ID \};/);
  assert.doesNotMatch(background, /gameTemplate|TEMPLATE_STORAGE_KEY|pacificDate|storage\.local/);
  assert.match(content, /function gameUrnFromSources\(sources, gameId\)/);
  assert.match(content, /GAME_IDS = \{ pinpoint: "1", crossclimb: "2", "mini-sudoku": "7" \}/);
  assert.match(content, /gameUrnFromSources\(sources, GAME_IDS\[currentGame\]\)/);
  assert.match(content, /if \(!gameUrn\) return false;/);
  assert.match(content, /match\[0\]\.includes\(`,\$\{gameId\},`\)/);
  assert.match(content, /async function requestGameQueryId\(\)/);
  assert.match(content, /const gameUrn = gameUrnFromSources\(sources, GAME_IDS\[currentGame\]\);/);
  assert.match(content, /const csrf = sessionCsrfToken\(sources\);/);
  assert.match(content, /const queryId = await requestGameQueryId\(\);/);
  assert.match(content, /if \(!gameUrn \|\| !csrf \|\| !queryId\) return false;/);
  assert.match(content, /resourceKey: gameUrn,/);
  assert.match(content, /gamePlayState: "END_SOLVED"/);
  assert.doesNotMatch(content, /pacificDate|pacificDaysBetween|KNOWN_GAME_IDS|requestGameTemplate/);
  assert.match(content, /payload\.errors\?\.length \|\| payload\.data\?\.errors\?\.length/);
  assert.match(content, /Math\.max\(2, Math\.round\(\(Date\.now\(\) - \(solveStartedAt \|\| Date\.now\(\)\)\) \/ 1000\)\)/);
  assert.match(content, /if \(await submitGameSave\(\{ blueprintGameState[\s\S]*?return;\s*\n\s*\}[\s\S]*?replaceInputText\(input, solutions\[0\]\)/);
  assert.match(content, /if \(await submitGameSave\(\{ crossClimbGameState[\s\S]*?return;\s*\n\s*\}[\s\S]*?fillLetterRow/);
});

test("anonymous first-visit launch gates are clicked through", () => {
  assert.match(content, /async function startGameIfNeeded\(\)/);
  assert.match(content, /\^\(Start game\|Start puzzle\|Solve now\|Play\)\$\/i/);
  assert.match(content, /gameControls\("button, \[role='button'\], a\[href\]"\)\.find\(isGateControl\)/);
  assert.match(content, /aria-label"\) \|\| ""/);
  assert.match(content, /await startGameIfNeeded\(\);/);
});

test("completed boards and slow pads do not derail solves", () => {
  assert.match(content, /gameControls\("input"\)\.filter\(\(input\) => input\.closest\("\[aria-label\^='Row'\]"\)\)/);
  assert.match(content, /let numberButton = null;[\s\S]*?await waitUntil\(\(\) => \{\s*numberButton =/);
});

test("board and puzzle-data detection do not depend on a server-rendered main element", () => {
  assert.doesNotMatch(content, /querySelectorAll\("main (?:div|button|input)"\)/);
  assert.doesNotMatch(content, /querySelector\(`main /);
  assert.match(content, /function gameAreaText\(\)[\s\S]*?document\.body\?\.textContent/);
  assert.match(content, /async function waitForBoard\(/);
  assert.match(content, /waitForBoard\(parseQueensBoard\)/);
  assert.match(content, /waitForBoard\(parseTangoBoard\)/);
  assert.match(content, /waitForBoard\(parseSudokuBoard\)/);
  assert.match(content, /waitForBoard\(parseZipBoard\)/);
  assert.match(content, /waitForBoard\(parsePatchesBoard\)/);
  assert.match(content, /waitForBoard\(\(\) => findWendGrid\(puzzle\)\)/);
  assert.match(content, /#linkedin-logic-solver, \[role='dialog'\], \[aria-modal='true'\], \[aria-hidden='true'\]/);
  assert.match(content, /gameControls\("button"\)\.find/);
  assert.match(content, /gameControls\("input"\)/);
  assert.match(background, /document\.body\.querySelectorAll\("\*"\)/);
  assert.match(background, /MAX_SCAN_ELEMENTS = 4000/);
  assert.match(background, /MAX_INSPECTED = 40000/);
});

test("solves abort when the puzzle page leaves the active game", () => {
  assert.match(content, /let solveSession = null/);
  assert.match(content, /function assertStillSolving\([\s\S]*?Solve cancelled because the puzzle page changed/);
  assert.match(content, /solveSession = \{ game \}/);
  assert.match(content, /function dropSolveSessionIfStale/);
  assert.match(content, /async function mouseSequence[\s\S]*?assertStillSolving\(\)/);
  assert.match(content, /async function delay[\s\S]*?if \(solving\) assertStillSolving\(\)/);
  assert.doesNotMatch(content, /Waiting for the board\."\)/);
});

test("Tango maps LinkedIn's current Sun and Moon markup to its click cycle", () => {
  assert.match(content, /svg\[aria-label='Sun'\], \[data-testid='cell-zero'\][\s\S]*?return 1/);
  assert.match(content, /svg\[aria-label='Moon'\], \[data-testid='cell-one'\][\s\S]*?return 0/);
});
