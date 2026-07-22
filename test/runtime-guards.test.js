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
  assert.match(background, /voyager\\\/api\\\/\|games\\\/api\\\//);
  assert.match(background, /for \(const kind of \["Props", "Fiber"\]\)/);
  assert.match(background, /onUpdated[\s\S]*?primeCapture\(tabId, changeInfo\.url\)/);
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
  assert.match(content, /mousePressed[\s\S]*?centers\.slice\(1\)[\s\S]*?mouseReleased/);
  assert.match(content, /solveWendGame[\s\S]*?path\.every\([\s\S]*?outerHTML/);
  assert.match(content, /attempt < 2[\s\S]*?Wend word \$\{pathIndex \+ 1\} did not commit after two gestures/);
});

test("early word-game responses survive initial content-script capture", () => {
  assert.match(background, /const previousDocument = captureDocuments\.get\(tabId\)/);
  assert.match(background, /if \(previousDocument && previousDocument !== documentId\)[\s\S]*?puzzleSources\.delete\(tabId\)/);
  assert.match(background, /else if \(!previousDocument\)[\s\S]*?Preserve that early response on first attach/);
});

test("signed-in games pace their final action and verify saves", () => {
  assert.match(content, /SIGNED_IN_COMPLETION_FLOORS_MS = \{[\s\S]*?pinpoint:[\s\S]*?wend:[\s\S]*?queens:[\s\S]*?tango:[\s\S]*?zip:[\s\S]*?"mini-sudoku":/);
  assert.match(content, /waitForSignedInCompletion\("pinpoint"\)/);
  assert.match(content, /waitForSignedInCompletion\("wend"\)/);
  assert.match(content, /waitForSignedInCompletion\("queens"\)/);
  assert.match(content, /waitForSignedInCompletion\("tango"\)/);
  assert.match(content, /waitForSignedInCompletion\("zip"\)/);
  assert.match(content, /pendingCells === 1[\s\S]*?waitForSignedInCompletion\("mini-sudoku"\)/);
  assert.match(content, /index === path\.length - 1[\s\S]*?waitForSignedInCompletion\("zip"\)/);
  assert.match(content, /solveFirstInputAt \|\| solveStartedAt/);
  assert.match(content, /issue saving your game/);
});

test("Tango maps LinkedIn's current Sun and Moon markup to its click cycle", () => {
  assert.match(content, /svg\[aria-label='Sun'\], \[data-testid='cell-zero'\][\s\S]*?return 1/);
  assert.match(content, /svg\[aria-label='Moon'\], \[data-testid='cell-one'\][\s\S]*?return 0/);
});
