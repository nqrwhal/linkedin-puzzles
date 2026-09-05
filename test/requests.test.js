const test = require("node:test");
const assert = require("node:assert/strict");
const { queensSave, sduiResponse } = require("../src/requests.js");

const game = {
  gameUrn: { gameTypeId: "3", puzzleId: "-1337" },
  puzzle: { queensGamePuzzle: { gridSize: 7, solution: [
    { row: 0, col: 5 }, { row: 1, col: 2 }, { row: 2, col: 4 },
    { row: 3, col: 6 }, { row: 4, col: 0 }, { row: 5, col: 3 }, { row: 6, col: 1 },
  ] } },
};
function contract(puzzleId = "-1337") {
  const states = [
    { key: "gameBoardPuzzleId", value: { type: "bigint", value: puzzleId } },
    { key: "gameBoardHasWon", value: false },
    { key: "queensBoardStateBinding", value: Array(49).fill("EMPTY") },
    { key: "queensSolveOrderBinding", value: ["green"] },
    { key: "gameIsTutorialGameBinding", value: true },
  ];
  return { requestId: "updateGameState", states, requestedArguments: {
    payload: { gameTypeId: "3" }, states: structuredClone(states),
  } };
}
test("Queens request uses the delivered solution in both state arrays", () => {
  const original = contract();
  const result = queensSave(game, original);
  for (const states of [result.states, result.requestedArguments.states]) {
    const values = Object.fromEntries(states.map(({ key, value }) => [key, value]));
    assert.equal(values.gameBoardHasWon, true);
    assert.deepEqual(values.queensBoardStateBinding.flatMap((v, i) => v === "QUEEN" ? [i] : []), [5, 9, 18, 27, 28, 38, 43]);
    assert.equal(values.gameIsTutorialGameBinding, true);
    assert.deepEqual(values.queensSolveOrderBinding, ["green"]);
  }
  assert.equal(original.states[1].value, false);
});
test("Queens rejects stale contracts and incomplete delivered solutions", () => {
  assert.throws(() => queensSave(game, contract("858")), /another puzzle/);
  const wrongGame = contract();
  wrongGame.requestedArguments.payload.gameTypeId = "4";
  assert.throws(() => queensSave(game, wrongGame), /does not belong/);
  assert.throws(() => queensSave({ ...game, puzzle: { queensGamePuzzle: { gridSize: 7, solution: [] } } }, contract()), /incomplete/);
});
test("SDUI completion requires the server's results navigation action", () => {
  const response = (value) => '1:[]\n0:' + JSON.stringify({ response: value }) + '\n';
  assert.equal(sduiResponse(response({ errors: [], completionAction: { actions: [
    { value: { content: { url: { urlValue: { url: "/games/queens/results/" } } } } },
  ] } })), "/games/queens/results/");
  assert.throws(() => sduiResponse(response({ errors: [] })), /did not confirm/);
  assert.throws(() => sduiResponse(response({ errors: [{}] })), /rejected/);
  assert.throws(() => sduiResponse("invalid"), /unrecognized/);
});

test("Tango preserves millisecond elapsed time and converts delivered cell enums", () => {
  const { tangoSave } = require("../src/requests.js");
  const tango = { gameUrn: { gameTypeId: "5", puzzleId: "-99992" },
    puzzle: { lotkaGamePuzzle: { gridSize: 2, solution: ["LotkaCellValue_ZERO", "LotkaCellValue_ONE", "LotkaCellValue_ONE", "LotkaCellValue_ZERO"] } } };
  const template = contract("-99992");
  template.requestedArguments.payload.gameTypeId = "5";
  for (const states of [template.states, template.requestedArguments.states]) {
    states[2].key = "tangoBoardStateBinding";
    states.push({ key: "gameBoardTimeElapsed", value: { type: "bigint", value: "0" } });
  }
  const result = tangoSave(tango, template, 13895);
  for (const states of [result.states, result.requestedArguments.states]) {
    assert.equal(states.find(s => s.key === "gameBoardTimeElapsed").value.value, "13895");
    assert.deepEqual(states.find(s => s.key === "tangoBoardStateBinding").value, ["ZERO", "ONE", "ONE", "ZERO"]);
  }
});

test("Voyager only confirms the exact game resource returned by LinkedIn", () => {
  const { gameUrn, voyagerSave, voyagerResponse } = require("../src/requests.js");
  const urn = "urn:li:fsd_game:(member,1,-9999195)";
  assert.equal(gameUrn([urn], "1"), urn);
  assert.equal(gameUrn([urn], "2"), null);
  const body = voyagerSave("pinpoint", urn, "query", { blueprintGameState: ["Fruits"] }, 2000);
  assert.equal(body.variables.entity.resourceKey, urn);
  assert.throws(() => voyagerResponse({ data: {} }, urn), /did not confirm/);
  assert.throws(() => voyagerResponse({ data: { data: { updateIdentityDashGames: { resourceKey: "other" } } } }, urn));
  assert.doesNotThrow(() => voyagerResponse({ data: { data: { updateIdentityDashGames: { resourceKey: urn } } } }, urn));
});

test("Mini Sudoku omits givens and uses the delivered values", () => {
  const { sudokuState } = require("../src/requests.js");
  assert.deepEqual(sudokuState({ gridRowSize: 2, gridColSize: 2, solution: [1,2,2,1], presetCellIdxes: [0,3] }),
    { miniSudokuGameState: [{ cellIdx: 1, cellContentUnion: { cellValue: 2 } }, { cellIdx: 2, cellContentUnion: { cellValue: 2 } }] });
});
