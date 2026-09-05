(function initParsers(root, factory) {
  const api = factory();
  root.LinkedInPuzzleParsers = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createParsers() {
  "use strict";

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function sourceList(sources) {
    return (Array.isArray(sources) ? sources : [sources]).filter((source) => typeof source === "string");
  }

  function normalizeBootstrap(source) {
    return source
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&#61;/g, "=")
      .replace(/\\u0022/gi, '"')
      .replace(/\\u0027/gi, "'")
      .replace(/\\u003d/gi, "=");
  }

  function bootstrapVariants(source) {
    const variants = [normalizeBootstrap(source)];
    let value = variants[0];
    // Some retained script values escape their entire JSON object, while live
    // bootstrap objects only escape quotes inside clue text. Always try the
    // valid outer JSON first so an inner phrase such as \"to refrigerate\"
    // remains parseable, then peel wrapper escaping only as a fallback.
    for (let pass = 0; pass < 3 && value.includes('\\"'); pass += 1) {
      value = value.replace(/\\"/g, '"');
      if (!variants.includes(value)) variants.push(value);
    }
    return variants;
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
      for (const source of bootstrapVariants(raw)) {
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
    }
    throw new Error("Pinpoint solutions were not found in LinkedIn's puzzle data.");
  }

  function parseCrossclimbRungs(sources) {
    for (const raw of sourceList(sources)) {
      for (const source of bootstrapVariants(raw)) {
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
    }
    throw new Error("Crossclimb answers were not found in LinkedIn's puzzle data.");
  }


  function parseSudokuPuzzle(sources) {
    for (const raw of sourceList(sources)) {
      for (const source of bootstrapVariants(raw)) {
        for (const puzzle of jsonValuesForKey(source, "miniSudokuGamePuzzle")) {
          if (Array.isArray(puzzle?.solution) && Array.isArray(puzzle.presetCellIdxes)) return puzzle;
        }
      }
    }
    throw new Error("Mini Sudoku solution was not found in LinkedIn's puzzle data.");
  }

  return { parsePinpointSolutions, parseCrossclimbRungs, parseSudokuPuzzle };
});
