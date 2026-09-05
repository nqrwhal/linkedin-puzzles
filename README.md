# LinkedIn Puzzle Solver

A local Chrome extension that reads LinkedIn's delivered puzzle solutions and submits completed game states by request. It supports Pinpoint, Crossclimb, Mini Sudoku, Queens, Tango, Zip, Patches, and Wend. It never falls back to clicking cells, typing answers, or dragging paths.

## Install and use

1. Open chrome://extensions, enable Developer mode, and load this folder with **Load unpacked**.
2. Sign in to LinkedIn and open the game board.
3. Click **Solve by request**. The extension submits the save, reloads the page, and checks for LinkedIn's completed-board controls before reporting success.

After an update, reload the extension and the game tab. The panel shows the running version. Guest boards have no member save record, so request completion requires a signed-in session. Incognito works when the extension is enabled there and LinkedIn is signed in.

## Request paths

Pinpoint, Crossclimb, and Mini Sudoku use Voyager's game-save mutation with the exact game URN supplied by the page, including negative tutorial puzzle ids. A successful response must identify that same resource.

Queens, Tango, Zip, Patches, and Wend use the page's SDUI updateGameState contract. The extension captures the current document's native save, reads its delivered solution from React props, and changes the completion and board-state bindings. It preserves the remaining contract fields and uses milliseconds for SDUI elapsed time. Missing contracts or data stop the solve; no input fallback is attempted.

The debugger permission reads game traffic, and scripting reads page-owned puzzle objects. No mouse or keyboard input is dispatched. Capture is bounded to fifteen minutes and released when leaving game pages. The extension only sends saves to LinkedIn.

**Game capture** exposes local diagnostic records. Request headers are not logged; token fields and game-URN member components are redacted. Captures may still contain game-specific account identifiers, so review them before sharing. Captured replay contracts remain in memory for the current document and are cleared on navigation.

## Validation status

During development, request prototypes completed initially unsolved boards for all eight games on a fresh signed-in account, and reloading each board showed LinkedIn's completed state. Several were onboarding/tutorial puzzles. Those protocol tests do not substitute for testing the integrated extension or regular daily boards.

On September 5, 2026, the installed v0.7.0 extension passed the same end-to-end check for all eight games in signed-in Chrome. Each board started unsolved; clicking **Solve by request** submitted the save and automatically reloaded the page. Every reloaded board showed LinkedIn's **See results** control, and the extension reported verified completion. No board clicks, answer typing, or path dragging were used in these integrated tests. Mini Sudoku was daily puzzle #390; this account also received onboarding boards, so this does not establish coverage of every daily puzzle variant.

The same day's follow-up on an established account verified the current live boards. v0.7.1 saved Tango, Zip, Patches, Wend, Mini Sudoku #390, and Crossclimb #858 at **0:02**, with completion confirmed after reload. Pinpoint #858 completed in one request; it scores guesses rather than time. Queens completed under v0.7.0 at 0:14, exposing an elapsed-time bug: SDUI saves retained time already accumulated on the board. v0.7.1 uses the request solve's elapsed time instead. Queens' completed daily board was not retested from an unsolved state after that fix. Observed click-through-reload checks took roughly 3.4–3.6 seconds for several timed games, so a two-second recorded score is not a guarantee of a two-second browser round trip.

## Development

Run `npm test` for parser, request-contract, response-validation, and runtime checks. After editing the unpacked extension, reload it in Chrome and reload the game.

CI builds the extension zip on pushes. For a release, bump manifest.json and package.json together, commit, and push a matching vX.Y.Z tag. The release workflow checks the version and tests before publishing.
