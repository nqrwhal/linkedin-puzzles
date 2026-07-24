# LinkedIn Puzzle Solver

A local Chrome extension that recognizes LinkedIn's current logic and word games and adds a compact solver control on the right side of the page.

Supported games:

- Queens
- Tango
- Zip
- Mini Sudoku
- Patches
- Pinpoint
- Crossclimb
- Wend

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select this project folder.
5. Open any supported game under `https://www.linkedin.com/games/` and use the solver card on the right.

## Usage

1. Open a supported LinkedIn game while signed in.
2. Wait for the **Puzzle Solver** card to say the board is recognized.
3. Click **Solve puzzle** and keep the game tab open until the card says **Solved!**.

Chrome briefly shows a debugging banner for word games and while the extension sends trusted puzzle input. The initial word-game connection reads only LinkedIn's own puzzle response and disconnects within 15 seconds; solve input disconnects as soon as the solve finishes. If the solver card does not appear after updating the extension, reload both the extension on `chrome://extensions` and the game tab.

For incognito play, enable **Allow in Incognito** on the extension's Details page. The solver card supports LinkedIn's iframe-based incognito layout. For word games, the extension can read the puzzle object from LinkedIn's rendered page state when an incognito page does not expose the answer data in HTML or the network response.

To keep browsing during a solve, put the puzzle in a separate Chrome window and leave that window open; a tab group only organizes tabs and does not isolate foreground focus or background throttling. After pressing **Solve puzzle**, you can switch to your normal Chrome window. The solver uses tab-targeted trusted input and mutation-driven board checks so it does not depend on rapid timers in the unfocused puzzle window.

The extension does not make its own network requests, collect data, or send puzzle contents anywhere. It keeps only matching puzzle data from LinkedIn's current page in memory. Chrome's `debugger` permission is used to read that already-delivered response and create trusted mouse and keyboard input; capture has a 15-second timeout and solve input has a 30-second safety timeout.

## How it works

The extension reads the same accessibility labels and cell metadata that LinkedIn exposes to the page, solves the board locally, and performs the normal cell interactions:

- Queens: region-aware backtracking
- Tango: binary constraint propagation and search
- Zip: wall-aware ordered Hamiltonian-path search with connectivity pruning
- Mini Sudoku: current-grid detection and region-aware Sudoku search
- Patches: rectangle enumeration and exact cover
- Pinpoint: accepted category extraction from the page's bootstrap data
- Crossclimb: visible clue-to-row matching, ladder ordering, and final-pair entry
- Wend: exact answer paths from the page's delivered grid data

Input is paced where LinkedIn can safely consume it: Zip reads rendered wall geometry and connects the solved route one verified cell at a time; Wend dispatches the board's touch contract locally and confirms every letter cell locked; Patches uses compact trusted drag sequences with mutation-driven settling; and Crossclimb advances after React has rendered each letter or row move.

During a solve, the extension panel is removed from pointer hit testing so a physical cursor left over the Solve button cannot interrupt trusted Crossclimb drags. Board waits use mutation signals with a low-frequency fallback and lag-tolerant deadlines; Patches also verifies each rendered rectangle and retries once before continuing.

## Development

Run the pure solver tests with:

```bash
npm test
```

After editing a loaded unpacked extension, click its reload icon on `chrome://extensions`, then reload the puzzle page.
