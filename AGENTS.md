# Project Agent Instructions

## Completion workflow

- Treat an implementation task as unfinished until the requested behavior is implemented, validated in proportion to its risk, and the user's goal is genuinely accomplished.
- Once a task that changed project files is complete, stage only the files that belong to that task, create a concise commit describing the completed work, and push the current branch to `origin`.
- Never include unrelated user changes in the commit. If the working tree is mixed, stage explicit task files and preserve everything else.
- If validation fails, required work remains, or the push is blocked, do not claim completion. Keep the work intact and report the exact blocker.
- Skip automatic commit and push for read-only analysis, explanations, reviews, or diagnoses that do not change project files, and follow any explicit user instruction not to publish changes.
