(function initSolvers(root, factory) {
  const api = factory();
  root.LinkedInLogicSolvers = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSolvers() {
  "use strict";

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function sourceList(sources) {
    return (Array.isArray(sources) ? sources : [sources]).filter((source) => typeof source === "string");
  }

  function normalizeBootstrap(source) {
    let value = source
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&#61;/g, "=")
      .replace(/\\u0022/gi, '"')
      .replace(/\\u0027/gi, "'")
      .replace(/\\u003d/gi, "=");
    for (let pass = 0; pass < 3 && value.includes('\\"'); pass += 1) value = value.replace(/\\"/g, '"');
    return value;
  }

  function jsonValuesForKey(source, key) {
    const values = [];
    const needle = `"${key}"`;
    let offset = 0;
    while ((offset = source.indexOf(needle, offset)) >= 0) {
      let index = offset + needle.length;
      while (/\s/.test(source[index] || "")) index += 1;
      if (source[index] !== ":") {
        offset = index;
        continue;
      }
      index += 1;
      while (/\s/.test(source[index] || "")) index += 1;
      const opening = source[index];
      const closing = opening === "[" ? "]" : opening === "{" ? "}" : null;
      if (!closing) {
        offset = index;
        continue;
      }
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let end = index; end < source.length; end += 1) {
        const character = source[end];
        if (inString) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') inString = true;
        else if (character === opening) depth += 1;
        else if (character === closing) {
          depth -= 1;
          if (depth === 0) {
            try {
              values.push(JSON.parse(source.slice(index, end + 1)));
            } catch {
              // Keep scanning; pages can contain schema examples before live data.
            }
            offset = end + 1;
            break;
          }
        }
      }
      if (offset <= index) offset = index + 1;
    }
    return values;
  }

  function numberForKey(source, key) {
    const match = source.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
    return match ? Number(match[1]) : null;
  }

  function jsonStringsForKey(source, key) {
    const values = [];
    const needle = `"${key}"`;
    let offset = 0;
    while ((offset = source.indexOf(needle, offset)) >= 0) {
      let index = offset + needle.length;
      while (/\s/.test(source[index] || "")) index += 1;
      if (source[index] !== ":") {
        offset = index;
        continue;
      }
      index += 1;
      while (/\s/.test(source[index] || "")) index += 1;
      if (source[index] !== '"') {
        offset = index + 1;
        continue;
      }
      let escaped = false;
      for (let end = index + 1; end < source.length; end += 1) {
        const character = source[end];
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') {
          try {
            values.push(JSON.parse(source.slice(index, end + 1)));
          } catch {
            // Keep scanning; malformed bootstrap fragments are not live data.
          }
          offset = end + 1;
          break;
        }
      }
      if (offset <= index) offset = index + 1;
    }
    return values;
  }

  function pinpointStrings(value, depth = 0) {
    if (typeof value === "string") return value.trim() ? [value.trim()] : [];
    if (!value || depth > 4) return [];
    if (Array.isArray(value)) return value.flatMap((item) => pinpointStrings(item, depth + 1));
    if (typeof value !== "object") return [];
    const preferredKeys = ["answer", "category", "solution", "value", "label", "text"];
    return preferredKeys.flatMap((key) => pinpointStrings(value[key], depth + 1));
  }

  function parsePinpointSolutions(sources) {
    for (const raw of sourceList(sources)) {
      const source = normalizeBootstrap(raw);
      if (!/blueprintGamePuzzle|pinpointGamePuzzle|pinpoint/i.test(source)) continue;
      for (const value of jsonValuesForKey(source, "solutions")) {
        const solutions = pinpointStrings(value);
        if (solutions.length) return [...new Set(solutions)];
      }
      for (const key of ["solution", "answer", "category"]) {
        const direct = jsonStringsForKey(source, key).map((value) => value.trim()).filter(Boolean);
        if (direct.length) return [...new Set(direct)];
        for (const value of jsonValuesForKey(source, key)) {
          const solutions = pinpointStrings(value);
          if (solutions.length) return [...new Set(solutions)];
        }
      }
    }
    throw new Error("Pinpoint solutions were not found in LinkedIn's puzzle data.");
  }

  function parseCrossclimbRungs(sources) {
    for (const raw of sourceList(sources)) {
      const source = normalizeBootstrap(raw);
      for (const value of jsonValuesForKey(source, "rungs")) {
        if (!Array.isArray(value) || value.length < 3) continue;
        if (!value.every((rung) => typeof rung?.word === "string" && Number.isInteger(rung.solutionRungIndex))) continue;
        return value.map((rung) => ({
          clue: typeof rung.clue === "string" ? rung.clue : "",
          word: rung.word.toUpperCase(),
          solutionRungIndex: rung.solutionRungIndex,
        }));
      }
    }
    throw new Error("Crossclimb answers were not found in LinkedIn's puzzle data.");
  }

  function parseWendPuzzle(sources) {
    for (const raw of sourceList(sources)) {
      const source = normalizeBootstrap(raw);
      const letters = jsonValuesForKey(source, "puzzleLetters").find((value) => Array.isArray(value) && value.every((letter) => typeof letter === "string"));
      const words = jsonValuesForKey(source, "solutionWords").find((value) =>
        Array.isArray(value) && value.length && value.every((word) => Array.isArray(word?.sequencingIndex) && word.sequencingIndex.every(Number.isInteger)),
      );
      const rows = numberForKey(source, "gridRows");
      const cols = numberForKey(source, "gridCols");
      if (!letters || !words || !rows || !cols || letters.length !== rows * cols) continue;
      const paths = words.map((word) => word.sequencingIndex.slice());
      const used = paths.flat();
      assert(used.every((index) => index >= 0 && index < letters.length), "Wend solution contains an invalid cell index.");
      assert(new Set(used).size === used.length, "Wend solution paths overlap.");
      return { rows, cols, letters: letters.map((letter) => letter.toUpperCase()), paths };
    }
    throw new Error("Wend paths were not found in LinkedIn's puzzle data.");
  }

  function solveQueens({ size, regions }) {
    assert(Number.isInteger(size) && size > 0, "Queens board size is invalid.");
    assert(regions.length === size * size, "Queens region map is incomplete.");

    const columns = new Set();
    const usedRegions = new Set();
    const solution = Array(size).fill(-1);

    function search(row) {
      if (row === size) return true;
      const candidates = [];
      for (let col = 0; col < size; col += 1) {
        const region = regions[row * size + col];
        if (columns.has(col) || usedRegions.has(region)) continue;
        if (row > 0 && Math.abs(solution[row - 1] - col) <= 1) continue;
        candidates.push({ col, region });
      }

      candidates.sort((a, b) => {
        const aFuture = row + 1 < size && regions[(row + 1) * size + a.col] === a.region ? 1 : 0;
        const bFuture = row + 1 < size && regions[(row + 1) * size + b.col] === b.region ? 1 : 0;
        return aFuture - bFuture;
      });

      for (const { col, region } of candidates) {
        solution[row] = col;
        columns.add(col);
        usedRegions.add(region);
        if (search(row + 1)) return true;
        usedRegions.delete(region);
        columns.delete(col);
        solution[row] = -1;
      }
      return false;
    }

    assert(search(0), "Queens puzzle has no solution.");
    return solution.map((col, row) => row * size + col);
  }

  function solveTango({ size, givens, relations = [] }) {
    assert(size > 0 && size % 2 === 0, "Tango board size must be even.");
    const total = size * size;
    const half = size / 2;
    const relationMap = Array.from({ length: total }, () => []);
    for (const relation of relations) {
      assert(relation.a >= 0 && relation.a < total && relation.b >= 0 && relation.b < total, "Tango relation is invalid.");
      relationMap[relation.a].push({ other: relation.b, same: relation.same });
      relationMap[relation.b].push({ other: relation.a, same: relation.same });
    }

    function assign(grid, index, value) {
      if (grid[index] !== -1) return grid[index] === value;
      grid[index] = value;
      return true;
    }

    function validateLine(line) {
      let zeros = 0;
      let ones = 0;
      for (const value of line) {
        if (value === 0) zeros += 1;
        if (value === 1) ones += 1;
      }
      if (zeros > half || ones > half) return false;
      for (let i = 0; i + 2 < size; i += 1) {
        if (line[i] !== -1 && line[i] === line[i + 1] && line[i] === line[i + 2]) return false;
      }
      return true;
    }

    function propagate(grid) {
      let changed = true;
      while (changed) {
        changed = false;

        for (let index = 0; index < total; index += 1) {
          if (grid[index] === -1) continue;
          for (const relation of relationMap[index]) {
            const expected = relation.same ? grid[index] : 1 - grid[index];
            if (grid[relation.other] === -1) {
              grid[relation.other] = expected;
              changed = true;
            } else if (grid[relation.other] !== expected) {
              return false;
            }
          }
        }

        for (let axis = 0; axis < 2; axis += 1) {
          for (let lineIndex = 0; lineIndex < size; lineIndex += 1) {
            const indexes = Array.from({ length: size }, (_, offset) =>
              axis === 0 ? lineIndex * size + offset : offset * size + lineIndex,
            );
            const line = indexes.map((index) => grid[index]);
            if (!validateLine(line)) return false;
            const zeros = line.filter((value) => value === 0).length;
            const ones = line.filter((value) => value === 1).length;
            if (zeros === half || ones === half) {
              const fill = zeros === half ? 1 : 0;
              for (const index of indexes) {
                if (grid[index] === -1) {
                  grid[index] = fill;
                  changed = true;
                }
              }
            }
            for (let i = 0; i + 2 < size; i += 1) {
              const a = indexes[i];
              const b = indexes[i + 1];
              const c = indexes[i + 2];
              if (grid[a] !== -1 && grid[a] === grid[b] && grid[c] === -1) {
                grid[c] = 1 - grid[a];
                changed = true;
              }
              if (grid[b] !== -1 && grid[b] === grid[c] && grid[a] === -1) {
                grid[a] = 1 - grid[b];
                changed = true;
              }
              if (grid[a] !== -1 && grid[a] === grid[c] && grid[b] === -1) {
                grid[b] = 1 - grid[a];
                changed = true;
              }
            }
          }
        }
      }

      for (let row = 0; row < size; row += 1) {
        if (!validateLine(grid.slice(row * size, (row + 1) * size))) return false;
      }
      for (let col = 0; col < size; col += 1) {
        const line = Array.from({ length: size }, (_, row) => grid[row * size + col]);
        if (!validateLine(line)) return false;
      }
      return true;
    }

    function candidateCount(grid, index) {
      let count = 0;
      for (let value = 0; value <= 1; value += 1) {
        const next = grid.slice();
        next[index] = value;
        if (propagate(next)) count += 1;
      }
      return count;
    }

    function search(grid) {
      if (!propagate(grid)) return null;
      let chosen = -1;
      let best = 3;
      for (let index = 0; index < total; index += 1) {
        if (grid[index] !== -1) continue;
        const count = candidateCount(grid, index);
        if (count < best) {
          best = count;
          chosen = index;
          if (count <= 1) break;
        }
      }
      if (chosen === -1) return grid;
      if (best === 0) return null;
      for (let value = 0; value <= 1; value += 1) {
        const next = grid.slice();
        if (!assign(next, chosen, value)) continue;
        const solved = search(next);
        if (solved) return solved;
      }
      return null;
    }

    const grid = Array(total).fill(-1);
    for (const [indexText, value] of Object.entries(givens || {})) {
      const index = Number(indexText);
      assert((value === 0 || value === 1) && assign(grid, index, value), "Tango givens conflict.");
    }
    const result = search(grid);
    assert(result, "Tango puzzle has no solution.");
    return result;
  }

  function tangoClickDistance(current, target) {
    const cycle = [-1, 1, 0];
    assert(cycle.includes(current) && (target === 0 || target === 1), "Tango click state is invalid.");
    return (cycle.indexOf(target) - cycle.indexOf(current) + cycle.length) % cycle.length;
  }

  function solveSudoku({ size, givens, regions }) {
    assert(size > 0 && regions.length === size * size, "Sudoku board metadata is incomplete.");
    const total = size * size;
    const grid = Array(total).fill(0);
    const rowUsed = Array.from({ length: size }, () => new Set());
    const colUsed = Array.from({ length: size }, () => new Set());
    const regionIds = [...new Set(regions)];
    assert(regionIds.length === size, "Sudoku must contain one region per symbol.");
    const regionUsed = new Map(regionIds.map((region) => [region, new Set()]));

    for (const [indexText, value] of Object.entries(givens || {})) {
      const index = Number(indexText);
      const row = Math.floor(index / size);
      const col = index % size;
      const region = regions[index];
      assert(value >= 1 && value <= size, "Sudoku given is outside the symbol range.");
      assert(!rowUsed[row].has(value) && !colUsed[col].has(value) && !regionUsed.get(region).has(value), "Sudoku givens conflict.");
      grid[index] = value;
      rowUsed[row].add(value);
      colUsed[col].add(value);
      regionUsed.get(region).add(value);
    }

    function candidates(index) {
      const row = Math.floor(index / size);
      const col = index % size;
      const region = regions[index];
      const values = [];
      for (let value = 1; value <= size; value += 1) {
        if (!rowUsed[row].has(value) && !colUsed[col].has(value) && !regionUsed.get(region).has(value)) values.push(value);
      }
      return values;
    }

    function search() {
      let chosen = -1;
      let options = null;
      for (let index = 0; index < total; index += 1) {
        if (grid[index] !== 0) continue;
        const next = candidates(index);
        if (next.length === 0) return false;
        if (!options || next.length < options.length) {
          chosen = index;
          options = next;
          if (next.length === 1) break;
        }
      }
      if (chosen === -1) return true;
      const row = Math.floor(chosen / size);
      const col = chosen % size;
      const region = regions[chosen];
      for (const value of options) {
        grid[chosen] = value;
        rowUsed[row].add(value);
        colUsed[col].add(value);
        regionUsed.get(region).add(value);
        if (search()) return true;
        regionUsed.get(region).delete(value);
        colUsed[col].delete(value);
        rowUsed[row].delete(value);
        grid[chosen] = 0;
      }
      return false;
    }

    assert(search(), "Mini Sudoku puzzle has no solution.");
    return grid;
  }

  function solvePatches({ rows, cols, clues }) {
    assert(rows > 0 && cols > 0 && rows * cols <= 120, "Patches board size is unsupported.");
    assert(clues.length > 0, "Patches clues were not found.");
    const total = rows * cols;
    const fullMask = (1n << BigInt(total)) - 1n;
    const clueCells = new Set(clues.map((clue) => clue.index));

    function rectangleMask(r1, c1, r2, c2) {
      let mask = 0n;
      for (let row = r1; row <= r2; row += 1) {
        for (let col = c1; col <= c2; col += 1) mask |= 1n << BigInt(row * cols + col);
      }
      return mask;
    }

    const candidatesByClue = clues.map((clue, clueIndex) => {
      const clueRow = Math.floor(clue.index / cols);
      const clueCol = clue.index % cols;
      const candidates = [];
      for (let r1 = 0; r1 <= clueRow; r1 += 1) {
        for (let r2 = clueRow; r2 < rows; r2 += 1) {
          for (let c1 = 0; c1 <= clueCol; c1 += 1) {
            for (let c2 = clueCol; c2 < cols; c2 += 1) {
              const height = r2 - r1 + 1;
              const width = c2 - c1 + 1;
              const area = height * width;
              if (clue.area && area !== clue.area) continue;
              if (clue.shape === "square" && height !== width) continue;
              if (clue.shape === "tall" && height <= width) continue;
              if (clue.shape === "wide" && width <= height) continue;
              let containsOtherClue = false;
              for (const other of clueCells) {
                if (other === clue.index) continue;
                const row = Math.floor(other / cols);
                const col = other % cols;
                if (row >= r1 && row <= r2 && col >= c1 && col <= c2) {
                  containsOtherClue = true;
                  break;
                }
              }
              if (containsOtherClue) continue;
              candidates.push({ r1, c1, r2, c2, area, mask: rectangleMask(r1, c1, r2, c2) });
            }
          }
        }
      }
      candidates.sort((a, b) => b.area - a.area || a.r1 - b.r1 || a.c1 - b.c1);
      assert(candidates.length > 0, `Patches clue ${clueIndex + 1} has no legal rectangle.`);
      return candidates;
    });

    const assignment = Array(clues.length).fill(null);
    let solved = null;

    function search(usedMask, assignedCount) {
      if (assignedCount === clues.length) {
        if (usedMask === fullMask) solved = assignment.slice();
        return Boolean(solved);
      }

      let chosen = -1;
      let compatible = null;
      let coverage = usedMask;
      for (let clueIndex = 0; clueIndex < clues.length; clueIndex += 1) {
        if (assignment[clueIndex]) continue;
        const options = candidatesByClue[clueIndex].filter((candidate) => (candidate.mask & usedMask) === 0n);
        if (options.length === 0) return false;
        for (const option of options) coverage |= option.mask;
        if (!compatible || options.length < compatible.length) {
          chosen = clueIndex;
          compatible = options;
        }
      }
      if (coverage !== fullMask) return false;

      for (const candidate of compatible) {
        assignment[chosen] = candidate;
        if (search(usedMask | candidate.mask, assignedCount + 1)) return true;
        assignment[chosen] = null;
      }
      return false;
    }

    assert(search(0n, 0), "Patches puzzle has no exact-cover solution.");
    return solved.map(({ mask, area, ...rectangle }) => rectangle);
  }

  function solveZip({ rows, cols, clues, blockedEdges = [], timeoutMs = 12000 }) {
    const total = rows * cols;
    assert(total > 0 && total <= 100, "Zip board size is unsupported.");
    const checkpointNumbers = Object.keys(clues).map(Number).sort((a, b) => a - b);
    assert(checkpointNumbers.length >= 2 && checkpointNumbers[0] === 1, "Zip checkpoints are incomplete.");
    const maxCheckpoint = checkpointNumbers[checkpointNumbers.length - 1];
    for (let number = 1; number <= maxCheckpoint; number += 1) assert(Number.isInteger(clues[number]), `Zip checkpoint ${number} is missing.`);

    const checkpointAt = Array(total).fill(0);
    for (let number = 1; number <= maxCheckpoint; number += 1) checkpointAt[clues[number]] = number;
    const blocked = new Set(blockedEdges.map(([a, b]) => `${Math.min(a, b)}:${Math.max(a, b)}`));
    const neighbors = Array.from({ length: total }, (_, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      const result = [];
      const addNeighbor = (next) => {
        if (!blocked.has(`${Math.min(index, next)}:${Math.max(index, next)}`)) result.push(next);
      };
      if (row > 0) addNeighbor(index - cols);
      if (col + 1 < cols) addNeighbor(index + 1);
      if (row + 1 < rows) addNeighbor(index + cols);
      if (col > 0) addNeighbor(index - 1);
      return result;
    });
    const finalCell = clues[maxCheckpoint];
    const visited = new Uint8Array(total);
    const path = [clues[1]];
    visited[clues[1]] = 1;
    const deadline = Date.now() + timeoutMs;
    let nodes = 0;

    function manhattan(a, b) {
      return Math.abs(Math.floor(a / cols) - Math.floor(b / cols)) + Math.abs((a % cols) - (b % cols));
    }

    function checkpointLowerBound(current, nextCheckpoint) {
      let distance = 0;
      let from = current;
      for (let number = nextCheckpoint; number <= maxCheckpoint; number += 1) {
        distance += manhattan(from, clues[number]);
        from = clues[number];
      }
      return distance;
    }

    function remainingIsConnected(current, nextCheckpoint) {
      const remaining = total - path.length;
      if (remaining === 0) return current === finalCell;
      if ((remaining & 1) !== (manhattan(current, finalCell) & 1)) return false;
      if (checkpointLowerBound(current, nextCheckpoint) > remaining) return false;

      const seen = new Uint8Array(total);
      const queue = [current];
      seen[current] = 1;
      let seenUnvisited = 0;
      for (let head = 0; head < queue.length; head += 1) {
        const cell = queue[head];
        for (const next of neighbors[cell]) {
          if (seen[next] || visited[next]) continue;
          seen[next] = 1;
          seenUnvisited += 1;
          queue.push(next);
        }
      }
      if (seenUnvisited !== remaining) return false;

      for (let cell = 0; cell < total; cell += 1) {
        if (visited[cell]) continue;
        let degree = 0;
        for (const next of neighbors[cell]) {
          if (!visited[next] || next === current) degree += 1;
        }
        if (degree === 0) return false;
        if (degree === 1 && cell !== finalCell) return false;
      }

      const target = clues[nextCheckpoint];
      if (target !== undefined) {
        const allowed = new Uint8Array(total);
        const targetQueue = [current];
        allowed[current] = 1;
        for (let head = 0; head < targetQueue.length; head += 1) {
          const cell = targetQueue[head];
          for (const next of neighbors[cell]) {
            if (allowed[next] || visited[next]) continue;
            const checkpoint = checkpointAt[next];
            if (checkpoint && checkpoint > nextCheckpoint) continue;
            allowed[next] = 1;
            targetQueue.push(next);
          }
        }
        if (!allowed[target]) return false;
      }
      return true;
    }

    function onwardDegree(cell) {
      let degree = 0;
      for (const next of neighbors[cell]) if (!visited[next]) degree += 1;
      return degree;
    }

    function search(current, nextCheckpoint) {
      nodes += 1;
      if ((nodes & 4095) === 0 && Date.now() > deadline) throw new Error("Zip solver timed out on this board.");
      if (path.length === total) return current === finalCell && nextCheckpoint > maxCheckpoint;
      if (current === finalCell) return false;
      if (!remainingIsConnected(current, nextCheckpoint)) return false;

      const candidates = neighbors[current].filter((cell) => {
        if (visited[cell]) return false;
        const checkpoint = checkpointAt[cell];
        return checkpoint === 0 || checkpoint === nextCheckpoint;
      });
      candidates.sort((a, b) => {
        const aCheckpoint = checkpointAt[a] === nextCheckpoint ? -1 : 0;
        const bCheckpoint = checkpointAt[b] === nextCheckpoint ? -1 : 0;
        return onwardDegree(a) - onwardDegree(b) || aCheckpoint - bCheckpoint || manhattan(a, clues[nextCheckpoint]) - manhattan(b, clues[nextCheckpoint]);
      });

      for (const next of candidates) {
        visited[next] = 1;
        path.push(next);
        const followingCheckpoint = checkpointAt[next] === nextCheckpoint ? nextCheckpoint + 1 : nextCheckpoint;
        if (search(next, followingCheckpoint)) return true;
        path.pop();
        visited[next] = 0;
      }
      return false;
    }

    assert(search(clues[1], 2), "Zip puzzle has no Hamiltonian path.");
    return path.slice();
  }

  return {
    parsePinpointSolutions,
    parseCrossclimbRungs,
    parseWendPuzzle,
    solveQueens,
    solveTango,
    tangoClickDistance,
    solveSudoku,
    solvePatches,
    solveZip,
  };
});
