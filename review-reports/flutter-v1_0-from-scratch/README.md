# Review reports for feat/flutter-adapter-v1_0-from-scratch

Created 2026-10-19. Last updated 2026-10-19.

This directory is not part of the feature. It travels with the branch so the reports can be read elsewhere, and it is not meant to be merged.

The branch adds A2UI protocol v1.0 to `dart/a2ui_flutter`, keeping v0.9, in the 12 commits on top of main `cbaa5ee62`. A separate commit adds this directory on top. Each of the 12 commits passes `dart format`, `flutter analyze --fatal-infos` and `flutter test` on its own. Each commit message explains its change and the reason for each choice, so the commits can be ported one at a time onto `feat/flutter-adapter-v1_0`, the other v1.0 implementation, or can replace it.

## Contents

- `comparison.md`: how this branch differs from `feat/flutter-adapter-v1_0` (`d88d4be6`), with a table of how each commit ports onto it. It was written on the machine that built the branch, so its local paths refer to that machine.
- `round1-code/` to `round5-final-v4/`: five blind review rounds. Each has the brief the reviewers got. `astra-medium.md` is a Codex `gpt-6-astra` review. The `opus-*.json` files are an Opus 5.5 panel's findings, each with the votes of two skeptics who tried to refute it and a `status` of `confirmed`, `refuted` or `disputed`. The `*summary.txt` files condense them.
  1. `round1-code`: the code, before the commits were split.
  2. `round2-series`: the first split into commits.
  3. `round3-series-v2`: the second split.
  4. `round4-close-v3`: a closing check of the third split.
  5. `round5-final-v4`: a check of the edits in the fourth split.

The confirmed problems were fixed, and the known limits are recorded in the commit messages, the README and the codebase blueprint. A few confirmed nits were left as they are, such as Slider snapping on ranges near the largest double. The hashes the rounds review belong to earlier cuts of the series that were never published. Only the final cut is on this branch, and its code is identical to the fourth split's.
