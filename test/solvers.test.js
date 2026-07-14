const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parsePinpointSolutions,
  parseCrossclimbRungs,
  parseWendPuzzle,
  solveQueens,
  solveTango,
  tangoClickDistance,
  solveSudoku,
  solvePatches,
  solveZip,
} = require("../src/solvers.js");

test("Pinpoint extracts accepted categories from HTML-encoded bootstrap data", () => {
  const source = `{&quot;gamePuzzle&quot;:{&quot;blueprintGamePuzzle&quot;:{&quot;solutions&quot;:[&quot;Biological taxonomy (ways to classify living things)&quot;,&quot;taxonomy&quot;],&quot;clues&quot;:[&quot;Class&quot;,&quot;Order&quot;]}}}`;
  assert.deepEqual(parsePinpointSolutions(source), ["Biological taxonomy (ways to classify living things)", "taxonomy"]);
});

test("Crossclimb extracts clue answers and their ladder indexes", () => {
  const source = `{&quot;crossClimbGamePuzzle&quot;:{&quot;rungs&quot;:[{&quot;solutionRungIndex&quot;:3,&quot;clue&quot;:&quot;Country&quot;,&quot;word&quot;:&quot;WALES&quot;},{&quot;solutionRungIndex&quot;:1,&quot;clue&quot;:&quot;Unsure&quot;,&quot;word&quot;:&quot;WAVER&quot;},{&quot;solutionRungIndex&quot;:2,&quot;clue&quot;:&quot;Ocean&quot;,&quot;word&quot;:&quot;WAVES&quot;}]}}`;
  assert.deepEqual(parseCrossclimbRungs(source), [
    { clue: "Country", word: "WALES", solutionRungIndex: 3 },
    { clue: "Unsure", word: "WAVER", solutionRungIndex: 1 },
    { clue: "Ocean", word: "WAVES", solutionRungIndex: 2 },
  ]);
});

test("Wend extracts escaped grid letters and exact non-overlapping paths", () => {
  const source = String.raw`{\"puzzle\":{\"$case\":\"wendGamePuzzle\",\"wendGamePuzzle\":{\"puzzleLetters\":[\"C\",\"A\",\"T\",\"D\",\"O\",\"G\"],\"solutionWords\":[{\"sequencingIndex\":[0,1,2]},{\"sequencingIndex\":[3,4,5]}],\"gridRows\":2,\"gridCols\":3}}}`;
  assert.deepEqual(parseWendPuzzle(source), {
    rows: 2,
    cols: 3,
    letters: ["C", "A", "T", "D", "O", "G"],
    paths: [[0, 1, 2], [3, 4, 5]],
  });
});

test("Wend preserves today's blocked 5x5 cells and every delivered word path", () => {
  const source = String.raw`{\"wendGamePuzzle\":{\"puzzleLetters\":[\"N\",\"T\",\"\",\"O\",\"V\",\"A\",\"E\",\"R\",\"N\",\"A\",\"L\",\"\",\"\",\"\",\"L\",\"C\",\"I\",\"U\",\"I\",\"C\",\"Y\",\"\",\"Q\",\"\",\"K\"],\"solutionWords\":[{\"sequencingIndex\":[16,15,20]},{\"sequencingIndex\":[3,4,9,14]},{\"sequencingIndex\":[22,17,18,19,24]},{\"sequencingIndex\":[10,5,0,1,6,7,8]}],\"gridRows\":5,\"gridCols\":5}}`;
  assert.deepEqual(parseWendPuzzle(source), {
    rows: 5,
    cols: 5,
    letters: ["N", "T", "", "O", "V", "A", "E", "R", "N", "A", "L", "", "", "", "L", "C", "I", "U", "I", "C", "Y", "", "Q", "", "K"],
    paths: [[16, 15, 20], [3, 4, 9, 14], [22, 17, 18, 19, 24], [10, 5, 0, 1, 6, 7, 8]],
  });
});

test("Queens places one queen per row, column, and region without touching", () => {
  const size = 4;
  const regions = Array.from({ length: size * size }, (_, index) => index % size);
  const result = solveQueens({ size, regions });
  assert.equal(result.length, size);
  assert.equal(new Set(result.map((index) => index % size)).size, size);
  assert.equal(new Set(result.map((index) => regions[index])).size, size);
  for (let row = 1; row < size; row += 1) {
    assert.ok(Math.abs((result[row] % size) - (result[row - 1] % size)) > 1);
  }
});

test("Tango satisfies row, column, adjacency, and sign constraints", () => {
  const size = 6;
  const relations = [
    { a: 0, b: 1, same: true },
    { a: 1, b: 7, same: true },
    { a: 3, b: 4, same: false },
    { a: 4, b: 5, same: false },
    { a: 4, b: 10, same: false },
    { a: 6, b: 7, same: false },
    { a: 22, b: 28, same: true },
    { a: 25, b: 31, same: false },
    { a: 27, b: 28, same: false },
    { a: 28, b: 34, same: false },
    { a: 30, b: 31, same: false },
    { a: 31, b: 32, same: true },
  ];
  const grid = solveTango({ size, givens: { 19: 1 }, relations });
  const lines = [];
  for (let row = 0; row < size; row += 1) lines.push(grid.slice(row * size, (row + 1) * size));
  for (let col = 0; col < size; col += 1) lines.push(Array.from({ length: size }, (_, row) => grid[row * size + col]));
  for (const line of lines) {
    assert.equal(line.filter((value) => value === 0).length, size / 2);
    assert.equal(line.filter((value) => value === 1).length, size / 2);
    for (let i = 0; i + 2 < size; i += 1) assert.ok(!(line[i] === line[i + 1] && line[i] === line[i + 2]));
  }
  for (const relation of relations) assert.equal(grid[relation.a] === grid[relation.b], relation.same);
});

test("Tango clicks follow LinkedIn's Empty to Sun to Moon cycle", () => {
  assert.equal(tangoClickDistance(-1, 1), 1);
  assert.equal(tangoClickDistance(-1, 0), 2);
  assert.equal(tangoClickDistance(1, 0), 1);
  assert.equal(tangoClickDistance(0, 1), 2);
  assert.equal(tangoClickDistance(1, 1), 0);
});

test("Mini Sudoku solves an irregular-region-compatible Latin grid", () => {
  const size = 4;
  const regions = [0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 3, 3, 2, 2, 3, 3];
  const grid = solveSudoku({ size, regions, givens: { 0: 1, 3: 4, 5: 4, 6: 1, 9: 1, 10: 4, 12: 4, 15: 1 } });
  const expected = new Set([1, 2, 3, 4]);
  for (let row = 0; row < size; row += 1) assert.deepEqual(new Set(grid.slice(row * size, (row + 1) * size)), expected);
  for (let col = 0; col < size; col += 1) assert.deepEqual(new Set(Array.from({ length: size }, (_, row) => grid[row * size + col])), expected);
  for (let region = 0; region < size; region += 1) assert.deepEqual(new Set(grid.filter((_, index) => regions[index] === region)), expected);
});

test("Mini Sudoku solves today's 6x6 Cobweb board", () => {
  const size = 6;
  const regions = Array.from({ length: 36 }, (_, index) => Math.floor(Math.floor(index / size) / 2) * 2 + Math.floor((index % size) / 3));
  const givens = { 1: 6, 4: 4, 6: 5, 8: 3, 9: 2, 11: 6, 13: 2, 16: 3, 19: 1, 22: 2, 24: 4, 26: 2, 27: 1, 29: 3, 31: 3, 34: 5 };
  const grid = solveSudoku({ size, regions, givens });
  const expected = new Set([1, 2, 3, 4, 5, 6]);
  for (let row = 0; row < size; row += 1) assert.deepEqual(new Set(grid.slice(row * size, (row + 1) * size)), expected);
  for (let col = 0; col < size; col += 1) assert.deepEqual(new Set(Array.from({ length: size }, (_, row) => grid[row * size + col])), expected);
});

test("Patches exactly covers the live 8x8 clue layout", () => {
  const clues = [
    { index: 2, shape: "any", area: 6 },
    { index: 8, shape: "any", area: 4 },
    { index: 15, shape: "any", area: 12 },
    { index: 20, shape: "tall", area: 4 },
    { index: 25, shape: "wide", area: null },
    { index: 38, shape: "wide", area: null },
    { index: 43, shape: "tall", area: 6 },
    { index: 48, shape: "any", area: 8 },
    { index: 55, shape: "any", area: 8 },
    { index: 61, shape: "any", area: 6 },
  ];
  const rectangles = solvePatches({ rows: 8, cols: 8, clues });
  const covered = new Set();
  assert.equal(rectangles.length, clues.length);
  rectangles.forEach((rectangle, clueIndex) => {
    const clue = clues[clueIndex];
    const clueRow = Math.floor(clue.index / 8);
    const clueCol = clue.index % 8;
    assert.ok(clueRow >= rectangle.r1 && clueRow <= rectangle.r2 && clueCol >= rectangle.c1 && clueCol <= rectangle.c2);
    for (let row = rectangle.r1; row <= rectangle.r2; row += 1) {
      for (let col = rectangle.c1; col <= rectangle.c2; col += 1) {
        const index = row * 8 + col;
        assert.ok(!covered.has(index));
        covered.add(index);
      }
    }
  });
  assert.equal(covered.size, 64);
});

test("Zip finds a Hamiltonian path through the live ordered clues", () => {
  const clues = { 1: 56, 2: 41, 3: 60, 4: 46, 5: 53, 6: 13, 7: 22, 8: 7, 9: 3, 10: 10, 11: 17, 12: 50 };
  const path = solveZip({ rows: 8, cols: 8, clues, timeoutMs: 20000 });
  assert.equal(path.length, 64);
  assert.equal(new Set(path).size, 64);
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    assert.equal(Math.abs(Math.floor(a / 8) - Math.floor(b / 8)) + Math.abs((a % 8) - (b % 8)), 1);
  }
  let previousPosition = -1;
  for (let number = 1; number <= 12; number += 1) {
    const position = path.indexOf(clues[number]);
    assert.ok(position > previousPosition);
    previousPosition = position;
  }
});

test("Zip solves today's 7x7 route without dropping a checkpoint", () => {
  const clues = { 1: 28, 2: 0, 3: 20, 4: 48, 5: 36, 6: 12 };
  const path = solveZip({ rows: 7, cols: 7, clues, timeoutMs: 20000 });
  assert.equal(path.length, 49);
  assert.equal(new Set(path).size, 49);
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    assert.equal(Math.abs(Math.floor(previous / 7) - Math.floor(current / 7)) + Math.abs((previous % 7) - (current % 7)), 1);
  }
  let previousPosition = -1;
  for (let number = 1; number <= 6; number += 1) {
    const position = path.indexOf(clues[number]);
    assert.ok(position > previousPosition);
    previousPosition = position;
  }
});

test("Zip honors walls on today's 6x6 route", () => {
  const clues = { 1: 13, 2: 2, 3: 0, 4: 14, 5: 22, 6: 35, 7: 33, 8: 21 };
  const blockedEdges = [
    [2, 3], [8, 9],
    [10, 11], [16, 17],
    [13, 14], [13, 19], [18, 19], [24, 25],
    [16, 22], [21, 22],
    [26, 27], [32, 33],
  ];
  const expected = [
    13, 7, 8, 2, 1, 0, 6, 12, 18, 24, 30, 31,
    32, 26, 25, 19, 20, 14, 15, 16, 10, 9, 3, 4,
    5, 11, 17, 23, 22, 28, 29, 35, 34, 33, 27, 21,
  ];
  const path = solveZip({ rows: 6, cols: 6, clues, blockedEdges, timeoutMs: 20000 });
  assert.deepEqual(path, expected);
});
