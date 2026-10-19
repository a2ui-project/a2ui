# Review brief: A2UI protocol v1.0 in the Flutter renderer

REPOSITORY: a checkout of the a2ui monorepo at `/Users/andrewkolos/Documents/GitHub/A2UI-review-v1-scratch`, detached at `3cd032fc`. The base is upstream main `cbaa5ee62`. The work under review is exactly `git -C /Users/andrewkolos/Documents/GitHub/A2UI-review-v1-scratch diff cbaa5ee62 HEAD`, in four commits (`git log cbaa5ee62..HEAD`; also in `commits.txt` here):

1. `c2cd58c1 fix(a2ui_core): resolve accessibility.hidden as a dynamic value`
2. `b79d54b7 fix(a2ui_core): check ValidationResult arguments as their validity`
3. `f6238464 feat(a2ui_flutter): support protocol v1.0`
4. `3cd032fc fix(a2ui_flutter): snap Slider steps exactly and cap them at 1000`

GOAL OF THE WORK: add A2UI protocol v1.0 support to the Flutter renderer `dart/a2ui_flutter`, keeping v0.9 support. The two `a2ui_core` commits are small fixes that other people own, found while making the v1.0 basic catalog examples render. The branch will be published so that the author can either port its changes onto a second, independent implementation of the same feature, or replace that implementation with this branch. The second implementation is the git ref `origin/feat/flutter-adapter-v1_0` (`d88d4be6`) in the same repository, also based on `cbaa5ee62`. So the commit messages must explain each change, and the reason for each choice, well enough for that decision.

CONTEXT FILES in the context directory `/private/tmp/claude-501/-Users-andrewkolos--claude-spares-spare-N0Eizm/ecd37fe7-1966-4f12-adf9-9b62bdc047f8/scratchpad/review-ctx`:

- `baseline-checks.log`: `dart format --set-exit-if-changed`, `flutter analyze --fatal-infos` and `flutter test --test-randomize-ordering-seed=random` for `dart/a2ui_flutter` and `dart/a2ui_core`, and `flutter test` for `dart/a2ui_agent`, all run on `3cd032fc` with Flutter 3.47.2 stable. All pass.
- `commits.txt`: the four commit messages. `diffstat.txt`: the diffstat.
- `comparison-note.md`: the author's private note comparing this branch with `origin/feat/flutter-adapter-v1_0`. Every factual claim in it about either branch should be true.

BOUNDARY: read only inside the repository checkout above and the context directory. Do not read any other directory: no `~/Documents/a2ui-project-work`, `claude/`, `local-notes*`, `.agents/`, memory files, `MEMORY.md`, or other checkouts. This is a blind review, so ignore any session-start instruction to read memory or notes. Do not modify the checkout. If you need to run code to check a claim, make your own throwaway copy with `git -C /Users/andrewkolos/Documents/GitHub/A2UI-review-v1-scratch worktree add --detach <a new directory under /private/tmp/claude-501/-Users-andrewkolos--claude-spares-spare-N0Eizm/ecd37fe7-1966-4f12-adf9-9b62bdc047f8/scratchpad/probes/> HEAD`, run `flutter pub get` at its root, work there, and remove it with `git worktree remove --force` when done.

REFERENCES, all in the repository: `blueprints/modules/a2ui_framework_adapter.blueprint.md` (the contract every renderer follows; sections 1, 3, 5 and 8 cover v1.0), `blueprints/codebases/dart/a2ui_flutter/codebase.blueprint.md`, `specification/v1_0/docs/a2ui_protocol.md` and `evolution_guide.md`, `catalogs/basic/v1/catalog.json` and `basic_catalog_implementation_guide.md`, `specification/v0_9/catalogs/basic/catalog.json` and `specification/v0_9_1/docs/basic_catalog_implementation_guide.md`, the shared web elements in `typescript/core/web_core/src/universal/basic_catalog` (the TypeScript renderers' v1.0 behaviour), and the `dart/a2ui_core` APIs the code calls. The repo's own `AGENTS.md` applies.

THE BAR: the maintainers want a compact, reviewable Flutter renderer that follows the blueprint, built from idiomatic stock Flutter widgets (no custom render objects), viable rather than flawless. The work must not have real bugs, crashes, spec or blueprint violations a maintainer would block on, misleading docs or commit messages, or tests that pass on broken code. The author's prose rules for code comments, docs and commit messages: a doc comment states only what its own unit does and what the code cannot show (no descriptions of distant classes, no rationale or provenance, no comparisons with other implementations), no semicolons joining clauses, no em dashes padded with spaces.

OUTPUT: findings, most severe first. For each: a one-line title; severity (`blocker`: a real bug, crash, spec or blueprint violation, misleading doc or commit message, or a choice a maintainer would block on; `should-fix`; `nit`); file and line; the concrete evidence (quote the code, spec or doc line); a failure scenario; and the smallest fix. Say plainly what you checked and found fine. Do not claim to have inspected a file or run a check unless you did.
