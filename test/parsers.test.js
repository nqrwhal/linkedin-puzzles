const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parsePinpointSolutions,
  parseCrossclimbRungs,
} = require("../src/parsers.js");

test("Pinpoint extracts accepted categories from HTML-encoded bootstrap data", () => {
  const source = `{&quot;gamePuzzle&quot;:{&quot;blueprintGamePuzzle&quot;:{&quot;solutions&quot;:[&quot;Biological taxonomy (ways to classify living things)&quot;,&quot;taxonomy&quot;],&quot;clues&quot;:[&quot;Class&quot;,&quot;Order&quot;]}}}`;
  assert.deepEqual(parsePinpointSolutions(source), ["Biological taxonomy (ways to classify living things)", "taxonomy"]);
});

test("Pinpoint accepts the current singular and structured solution payloads", () => {
  const singular = `{"pinpointGamePuzzle":{"solution":"Things associated with doom"}}`;
  const structured = `{"pinpointGamePuzzle":{"solutions":[{"text":"Musical intervals"},{"value":"Intervals"}]}}`;
  const quoted = String.raw`{"pinpointGamePuzzle":{"solution":"Things described as \"golden\""}}`;
  assert.deepEqual(parsePinpointSolutions(singular), ["Things associated with doom"]);
  assert.deepEqual(parsePinpointSolutions(structured), ["Musical intervals", "Intervals"]);
  assert.deepEqual(parsePinpointSolutions(quoted), ['Things described as "golden"']);
});

test("Crossclimb extracts clue answers and their ladder indexes", () => {
  const source = `{&quot;crossClimbGamePuzzle&quot;:{&quot;rungs&quot;:[{&quot;solutionRungIndex&quot;:3,&quot;clue&quot;:&quot;Country&quot;,&quot;word&quot;:&quot;WALES&quot;},{&quot;solutionRungIndex&quot;:1,&quot;clue&quot;:&quot;Unsure&quot;,&quot;word&quot;:&quot;WAVER&quot;},{&quot;solutionRungIndex&quot;:2,&quot;clue&quot;:&quot;Ocean&quot;,&quot;word&quot;:&quot;WAVES&quot;}]}}`;
  assert.deepEqual(parseCrossclimbRungs(source), [
    { clue: "Country", word: "WALES", solutionRungIndex: 3 },
    { clue: "Unsure", word: "WAVER", solutionRungIndex: 1 },
    { clue: "Ocean", word: "WAVES", solutionRungIndex: 2 },
  ]);
});

test("Crossclimb preserves escaped quotes inside the current live clue payload", () => {
  const source = String.raw`{"crossClimbGamePuzzle":{"rungs":[{"solutionRungIndex":0,"clue":"The top + bottom rows = A phrase meaning \"to refrigerate.\"","word":"KEEP"},{"solutionRungIndex":1,"clue":"Very interested","word":"KEEN"},{"solutionRungIndex":2,"clue":"A teenager","word":"TEEN"}]}}`;
  assert.deepEqual(parseCrossclimbRungs(source), [
    { clue: 'The top + bottom rows = A phrase meaning "to refrigerate."', word: "KEEP", solutionRungIndex: 0 },
    { clue: "Very interested", word: "KEEN", solutionRungIndex: 1 },
    { clue: "A teenager", word: "TEEN", solutionRungIndex: 2 },
  ]);
});

