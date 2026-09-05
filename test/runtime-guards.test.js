const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const content = fs.readFileSync(require.resolve("../src/content.js"), "utf8");
const background = fs.readFileSync(require.resolve("../src/background.js"), "utf8");

test("request runtime contains no synthetic input or UI fallback", () => {
  assert.doesNotMatch(content + background, /Input\.dispatch|Input\.insertText|lls-input-|dispatchEvent|new TouchEvent/);
  assert.match(content, /location\.reload\(\)/);
  assert.match(content, /Verified after reload/);
  assert.match(content, /AbortSignal\.timeout\(15000\)/);
});
test("all request modules are loaded by the extension manifest", () => {
  const manifest = require("../manifest.json");
  const scripts = manifest.content_scripts.flatMap(entry => entry.js);
  for (const name of ["src/parsers.js", "src/requests.js", "src/content.js"]) assert.ok(scripts.includes(name));
  for (const script of scripts) assert.ok(fs.existsSync(require("node:path").join(__dirname, "..", script)));
});
