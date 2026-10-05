# Project Agent Instructions

## Completion workflow

- Treat an implementation task as unfinished until the requested behavior is implemented, validated in proportion to its risk, and the user's goal is genuinely accomplished.
- Once a task that changed project files is complete, stage only the files that belong to that task, create a concise commit describing the completed work, and push the current branch to `origin`.
- Never include unrelated user changes in the commit. If the working tree is mixed, stage explicit task files and preserve everything else.
- If validation fails, required work remains, or the push is blocked, do not claim completion. Keep the work intact and report the exact blocker.
- Skip automatic commit and push for read-only analysis, explanations, reviews, or diagnoses that do not change project files, and follow any explicit user instruction not to publish changes.


## Product direction

- The goal is request-based completion of every supported game, replacing fragile mouse, keyboard, and drag submission.
- Local solving may still compute the completed state, but a request-path test must never fall back to UI input.
- Keep game-specific protocol capture until each save contract is understood and verified; it is migration tooling, not unused diagnostics.
- Verify a request solve against an initially unsolved signed-in board and a reload that shows persisted completion. A 200 response or the extension's own success message is not sufficient.

## Browser regression checks

- Preserve the Node tests and headless-service smoke when extending coverage. `npm test` runs the Node suite; `npm ci --prefix e2e`, `npm --prefix e2e run install:browser`, and `npm run test:e2e` run the offline tester-army suite with the actual unpacked extension.
- Browser fixtures block outbound traffic and use disposable profiles. Do not turn a fixture pass into a claim about live authenticated boards; live acceptance follows the product-direction rule above.
