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

The solver follows LinkedIn's in-page navigation, so moving between games from the games hub or a game's sidebar re-detects the new board and its puzzle data without reloading the tab. If a board is still mounting, solvers wait a few seconds for it before reporting that it is not visible.

Chrome shows a debugging banner while the extension reads word-game data or sends trusted puzzle input. Word-game pages keep that read connection open for the whole visit because LinkedIn delivers a puzzle's answers exactly once per navigation and never renders them into the page; it detaches on other pages. If the solver card does not appear after updating the extension, reload both the extension on `chrome://extensions` and the game tab — the card's eyebrow shows the running version so you can confirm the update loaded.

Games are also playable while signed out — an incognito window without a LinkedIn session gets fresh guest boards, and the solver clicks through each game's launch screen ("Start game", "Solve now") automatically. Every game except Wend solves as a guest: LinkedIn delivers Wend's answer paths only to signed-in sessions, so guest Wend boards have no solvable data and the solver says so. Guest completions stay client-side (LinkedIn does not save them), so single-request solves and save templates apply to signed-in sessions.

For incognito play, enable **Allow in Incognito** on the extension's Details page. A signed-in incognito window uses the same game layout as a normal window, so single-request solves work there too; the solver derives its request token from the current window's own session cookie, so a template learned in a normal window stays valid in incognito. For word games, the extension can read the puzzle object from LinkedIn's rendered page state when an incognito page does not expose the answer data in HTML or the network response.

To keep browsing during a solve, put the puzzle in a separate Chrome window and leave that window open; a tab group only organizes tabs and does not isolate foreground focus or background throttling. After pressing **Solve puzzle**, you can switch to your normal Chrome window. The solver uses tab-targeted trusted input and mutation-driven board checks so it does not depend on rapid timers or animation frames in the unfocused or occluded puzzle window. Solving also fails if DevTools is open on the puzzle tab, because Chrome allows only one debugger at a time.

The extension does not make its own network requests, collect data, or send puzzle contents anywhere. It keeps only matching puzzle data from LinkedIn's current page in memory and in Chrome's session storage for the background worker. Chrome's `debugger` permission is used to read that already-delivered response and create trusted mouse and keyboard input; capture stays attached on word-game tabs for up to fifteen minutes and solve input has a 30-second safety timeout.

## How it works

The extension reads the same accessibility labels and cell metadata that LinkedIn exposes to the page, solves the board locally, and performs the normal cell interactions:

- Queens: region-aware backtracking
- Tango: binary constraint propagation and search
- Zip: wall-aware ordered Hamiltonian-path search with connectivity pruning
- Mini Sudoku: current-grid detection and region-aware Sudoku search
- Patches: rectangle enumeration and exact cover
- Pinpoint: accepted category extraction from the page's bootstrap data, submitted by replaying LinkedIn's own single save request when its shape is known
- Crossclimb: visible clue-to-row matching, ladder ordering, and final-pair entry, with a single-request path when the save shape is known
- Wend: exact answer paths from the page's delivered grid data

When any LinkedIn game save flows through the tab's network capture — or through the request visibility that trusted-input sessions keep open for two seconds past the last input — the extension remembers the call's query id, CSRF token, and member key, and Pinpoint and Crossclimb then solve with one request each instead of driving the UI. The capture matches any GraphQL call carrying a game record, so logic-game saves teach the same template. The first solve in a fresh browser session falls back to the verified UI path (which also teaches the request shape), and any rejected or malformed request falls straight back to the UI solver, so a solve never depends on the private endpoint alone.

Word-game parsers preserve valid embedded JSON before peeling wrapper escaping, so quoted clue and answer text cannot corrupt otherwise complete puzzle data.

Input is paced where LinkedIn can safely consume it: Zip reads rendered wall geometry and connects the solved route one verified cell at a time; Wend dispatches the board's touch contract locally and confirms every letter cell locked, retrying each word with progressively slower gestures; Patches uses compact trusted drag sequences with mutation-driven settling; and Crossclimb advances after React has rendered each letter or row move. Every signed-in solve except Pinpoint holds only its final move until a two-second safety floor passes and then watches briefly for a late save rejection before reporting success; Pinpoint submits its single guess immediately, and all other input runs as fast as the board confirms it, so a solve finishes in about two to three seconds.

During a solve, the extension panel is removed from pointer hit testing and a transparent shield swallows any physical mouse activity aimed at it, so a cursor parked over the Solve button cannot interrupt trusted input or leak stray moves, hovers, and clicks into LinkedIn's handlers. Board waits use mutation signals with a low-frequency fallback and lag-tolerant deadlines; Patches also verifies each rendered rectangle and retries once before continuing.

## Development

Run the pure solver tests with:

```bash
npm test
```

After editing a loaded unpacked extension, click its reload icon on `chrome://extensions`, then reload the puzzle page.

### Releasing

CI builds the extension zip on every push, and publishing a release is tag-driven: bump the version in `manifest.json` and `package.json`, commit, then

```bash
git tag vX.Y.Z
git push origin main --tags
```

The Release workflow runs the tests, refuses a tag that does not match `manifest.json`'s version, builds `linkedin-puzzle-solver-X.Y.Z.zip`, and publishes the GitHub release with it.
