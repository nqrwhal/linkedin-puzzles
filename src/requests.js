(function (root) {
  "use strict";

  function queensSave(game, template, elapsedMs) {
    const puzzle = game?.puzzle?.queensGamePuzzle;
    const identity = game?.gameUrn;
    if (!puzzle || identity?.gameTypeId !== "3") throw new Error("Queens puzzle data is unavailable.");
    const size = puzzle.gridSize;
    const solution = puzzle.solution;
    if (!Number.isInteger(size) || size < 1 || !Array.isArray(solution) || solution.length !== size
      || solution.some(({ row, col }) => !Number.isInteger(row) || !Number.isInteger(col)
        || row < 0 || row >= size || col < 0 || col >= size)) {
      throw new Error("Queens delivered an incomplete solution.");
    }
    const board = Array(size * size).fill("EMPTY");
    for (const { row, col } of solution) board[row * size + col] = "QUEEN";
    return completedSave(game, template, "queensBoardStateBinding", board, elapsedMs);
  }

  function tangoSave(game, template, elapsedMs) {
    const puzzle = game?.puzzle?.lotkaGamePuzzle;
    if (game?.gameUrn?.gameTypeId !== "5" || !puzzle || !Number.isInteger(puzzle.gridSize)
      || puzzle.solution?.length !== puzzle.gridSize ** 2
      || puzzle.solution.some((value) => !["LotkaCellValue_ZERO", "LotkaCellValue_ONE"].includes(value))) {
      throw new Error("Tango delivered an incomplete solution.");
    }
    return completedSave(game, template, "tangoBoardStateBinding",
      puzzle.solution.map((value) => value.replace("LotkaCellValue_", "")), elapsedMs);
  }

  function zipSave(game, template, elapsedMs) {
    const puzzle = game?.puzzle?.trailGamePuzzle;
    const total = puzzle?.gridSize ** 2;
    if (game?.gameUrn?.gameTypeId !== "6" || !Number.isInteger(total) || total < 1
      || puzzle.solution?.length !== total || new Set(puzzle.solution).size !== total
      || puzzle.solution.some((cell) => !Number.isInteger(cell) || cell < 0 || cell >= total)) {
      throw new Error("Zip delivered an incomplete solution.");
    }
    return completedSave(game, template, "zipGamePathBinding", puzzle.solution.map(String), elapsedMs);
  }

  function patchesSave(game, template, elapsedMs) {
    const puzzle = game?.puzzle?.patchesGamePuzzle;
    const total = puzzle?.gridRows * puzzle?.gridCols;
    const cells = puzzle?.solution?.flatMap((region) => region.cellIdxes);
    if (game?.gameUrn?.gameTypeId !== "8" || !Number.isInteger(total) || total < 1
      || !cells || cells.length !== total || new Set(cells).size !== total
      || cells.some((cell) => !Number.isInteger(cell) || cell < 0 || cell >= total)) {
      throw new Error("Patches delivered an incomplete solution.");
    }
    return completedSave(game, template, "patchesBoardStateBinding",
      puzzle.solution.map((region) => region.cellIdxes.join("_")), elapsedMs);
  }

  function wendSave(game, template, elapsedMs) {
    const puzzle = game?.puzzle?.wendGamePuzzle;
    const paths = puzzle?.solutionWords?.map((word) => word.sequencingIndex);
    const cells = paths?.flat();
    const letters = puzzle?.puzzleLetters;
    if (game?.gameUrn?.gameTypeId !== "4" || !letters || !cells
      || cells.length !== letters.filter(Boolean).length || new Set(cells).size !== cells.length
      || cells.some((cell) => !Number.isInteger(cell) || !letters[cell])) {
      throw new Error("Wend delivered an incomplete solution.");
    }
    return completedSave(game, template, "wendBoardStateBinding",
      paths.map((path) => path.join("_")), elapsedMs);
  }

  function completedSave(game, template, boardKey, board, elapsedMs) {
    const body = JSON.parse(JSON.stringify(template));
    if (body.requestId !== "updateGameState"
      || body.requestedArguments?.payload?.gameTypeId !== game.gameUrn.gameTypeId) {
      throw new Error("Captured request does not belong to this game.");
    }
    for (const states of [body.states, body.requestedArguments.states]) {
      if (!Array.isArray(states)) throw new Error("Captured request has no state bindings.");
      const values = new Map(states.map((entry) => [entry.key, entry]));
      if (String(values.get("gameBoardPuzzleId")?.value?.value) !== String(game.gameUrn.puzzleId)) {
        throw new Error("Captured request belongs to another puzzle.");
      }
      if (!values.has("gameBoardHasWon") || !values.has(boardKey)) {
        throw new Error("Captured request is missing board state.");
      }
      values.get("gameBoardHasWon").value = true;
      values.get(boardKey).value = board.slice();
      // SDUI uses milliseconds, unlike the Voyager save's seconds.
      if (Number.isFinite(elapsedMs)) {
        const time = values.get("gameBoardTimeElapsed");
        if (!time?.value || time.value.type !== "bigint") throw new Error("Missing elapsed-time binding.");
        time.value.value = String(Math.max(Number(time.value.value) || 0, Math.round(elapsedMs)));
      }
    }
    return body;
  }

  function sduiResponse(text) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("0:")) continue;
      const payload = JSON.parse(line.slice(2));
      if (!payload.response || !Array.isArray(payload.response.errors)) break;
      if (payload.response.errors.length) throw new Error("LinkedIn rejected the game save.");
      const actions = payload.response.completionAction?.actions || [];
      const resultsPath = actions.map((action) => action.value?.content?.url?.urlValue?.url)
        .find((url) => /^\/games\/[a-z-]+\/results\/?$/.test(url));
      if (!resultsPath) throw new Error("LinkedIn did not confirm game completion.");
      return resultsPath;
    }
    throw new Error("LinkedIn returned an unrecognized save response.");
  }


  function gameUrn(sources, gameId) {
    for (const source of sources) {
      for (const match of source.matchAll(/urn:li:fsd_game:\([^)]+,\d+,-?\d+\)/g)) {
        if (gameId && match[0].includes(`,${gameId},`)) return match[0];
      }
    }
    return null;
  }

  function crossclimbState(rungs) {
    const ordered = rungs.slice().sort((a, b) => a.solutionRungIndex - b.solutionRungIndex);
    if (ordered.length < 3 || ordered.some((rung, index) => rung.solutionRungIndex !== index || !rung.word)) {
      throw new Error("Crossclimb delivered an incomplete ladder.");
    }
    return { crossClimbGameState: ordered.map((rung) => ({
      solutionRungIndex: rung.solutionRungIndex, clue: rung.clue,
      word: rung.word.toLowerCase(), guess: rung.word.toUpperCase().split("").join("&-*"),
    })) };
  }

  function sudokuState(puzzle) {
    const size = puzzle.gridRowSize;
    if (!Number.isInteger(size) || puzzle.gridColSize !== size
      || puzzle.solution?.length !== size * size || !Array.isArray(puzzle.presetCellIdxes)
      || puzzle.solution.some((value) => !Number.isInteger(value) || value < 1 || value > size)) {
      throw new Error("Mini Sudoku delivered an incomplete solution.");
    }
    return { miniSudokuGameState: puzzle.solution.flatMap((value, index) =>
      puzzle.presetCellIdxes.includes(index) ? [] : [{ cellIdx: index, cellContentUnion: { cellValue: value } }]) };
  }

  function voyagerSave(game, urn, queryId, state, elapsedMs) {
    const ids = { pinpoint: "1", crossclimb: "2", "mini-sudoku": "7" };
    if (!ids[game] || gameUrn([urn], ids[game]) !== urn || !queryId) throw new Error("Invalid game save identity.");
    const record = { gamePlayState: "END_SOLVED", gameStateUnion: state,
      completionAttributes: { isMistakeFree: true } };
    if (game !== "pinpoint") Object.assign(record, {
      timeElapsed: Math.max(2, Math.round(elapsedMs / 1000)), isFlawless: true,
      completionAttributes: { isHintFree: true, isMistakeFree: true },
    });
    return { variables: { entity: { entity: { gameStoredRecord: record }, resourceKey: urn } },
      queryId, includeWebMetadata: true };
  }

  function voyagerResponse(payload, urn) {
    if (payload?.errors?.length || payload?.data?.errors?.length
      || payload?.data?.data?.errors?.length
      || payload?.data?.data?.updateIdentityDashGames?.resourceKey !== urn) {
      throw new Error("LinkedIn did not confirm this game's save.");
    }
  }

  const api = { queensSave, tangoSave, zipSave, patchesSave, wendSave, sduiResponse, gameUrn, crossclimbState, sudokuState, voyagerSave, voyagerResponse };
  root.LinkedInGameRequests = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
