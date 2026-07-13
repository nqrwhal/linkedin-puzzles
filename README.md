# LinkedIn Puzzle Solver

A local Chrome extension that recognizes LinkedIn's current logic and word games and adds a compact **Solve puzzle** control on the right side of the page.

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

Chrome briefly shows a debugging banner while the extension sends trusted puzzle input. The extension disconnects as soon as the solve finishes. If the solver card does not appear after updating the extension, reload both the extension on `chrome://extensions` and the game tab.

The extension does not make its own network requests, collect data, or send puzzle contents anywhere. It reads the puzzle data already delivered in LinkedIn's page and requests Chrome's `debugger` permission solely to create trusted mouse and keyboard input while a solve is running. The debugging session attaches when you press **Solve puzzle**, detaches immediately afterward, and has a 30-second safety timeout.

## How it works

The extension reads the same accessibility labels and cell metadata that LinkedIn exposes to the page, solves the board locally, and performs the normal cell interactions:

- Queens: region-aware backtracking
- Tango: binary constraint propagation and search
- Zip: ordered Hamiltonian-path search with connectivity pruning
- Mini Sudoku: irregular-region Sudoku search
- Patches: rectangle enumeration and exact cover
- Pinpoint: accepted category extraction from the page's bootstrap data
- Crossclimb: clue-answer extraction, ladder ordering, and final-pair entry
- Wend: exact answer paths from the page's delivered grid data

## Development

Run the pure solver tests with:

```bash
npm test
```

After editing a loaded unpacked extension, click its reload icon on `chrome://extensions`, then reload the puzzle page.
