# a2ui_flutter v1.0: from-scratch build compared with feat/flutter-adapter-v1_0

Created 2026-10-19. Last updated 2026-10-19.

Two independent implementations of protocol v1.0 in `dart/a2ui_flutter`, both on main `cbaa5ee62` with v0.9 kept:

- **From scratch:** local branch `feat/flutter-adapter-v1_0-from-scratch` (head `c3927de6`), not pushed. It is in the clone `~/Documents/a2ui-project-work/a2ui-v1-from-scratch`, checked out in the worktree `~/Documents/GitHub/A2UI-flutter-v1-series`. Twelve commits, one per change, each passing format, analyze and tests on its own, with messages written so the work machine can port or skip each one. Its tree equals `a35eeb1c`, the head of the working branch `v1-from-scratch`, which holds the same work as an unsplit history.
- **Work machine:** upstream branch `feat/flutter-adapter-v1_0` at `d88d4be6`, no PR.

The series was rebuilt four times as the reviews corrected its code and messages. The earlier cuts were deleted on 2026-10-19 at Andrew's request, and the final one took the plain branch name.

## The series

| #   | Commit                                                             | Ports onto d88d4be6                                          |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| 1   | `fix(a2ui_core)`: bind `accessibility.hidden`                      | As is, except a CHANGELOG conflict                           |
| 2   | `fix(a2ui_core)`: validation results in function arguments         | Supersedes `c01675eb` (see below)                            |
| 3   | `refactor!`: move the v0.9 catalog to `v0_9/basic_catalog.dart`    | By hand. A cherry-pick moves the other branch's v1.0 library |
| 4   | `feat!`: the v1.0 catalog at `basic_catalog.dart`, harness, README | Conflicts in most files                                      |
| 5   | `fix`: `validationRegexp` only on the v0.9 TextField               | Small conflict in text_field.dart                            |
| 6   | `feat`: TextField `placeholder`                                    | Port the floating label and the test                         |
| 7   | `feat`: Slider `steps`                                             | Port the differences (no cap, exact snapping)                |
| 8   | `feat`: Video `posterUrl`                                          | Port the differences                                         |
| 9   | `feat`: Text without common Markdown markers                       | Replace the other branch's fallback                          |
| 10  | `feat`: warning and info hints                                     | Mostly additive                                              |
| 11  | `fix`: `asBoolean` reads a validation result                       | As is after 10                                               |
| 12  | `feat`: `accessibility.live` and `hidden` in NodeView              | As is after 1 and 11                                         |

Checks at the head: a2ui_flutter 378 tests, a2ui_core 1810, a2ui_agent 1022, analyze, format, prettier and blueprint validation all clean. All 43 v1.0 and 44 v0.9 basic catalog examples render.

## Where the branches differ

| Area                               | From scratch                                                                                                                             | feat/flutter-adapter-v1_0                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| v0.9 entry point                   | `v0_9/basic_catalog.dart`: `basicCatalog()` and `BasicComponents`, beside the version-agnostic `a2ui_flutter.dart`                       | `v0_9.dart`: the whole runtime plus the v0.9 catalog, the blueprint's "compatibility alias" wording                    |
| v1.0 `BasicComponents`             | Yes, with the v1.0 schemas                                                                                                               | None                                                                                                                   |
| `validationRegexp` on v1.0         | Ignored                                                                                                                                  | Still enforced: "Invalid format" on a v1.0 TextField that carries it                                                   |
| Placeholder                        | Visible: the label floats while a placeholder is set                                                                                     | Invisible until focus, because TextField requires `label`                                                              |
| Slider `steps`                     | Any count, `min + range * k / steps`, v0.9 path unchanged                                                                                | Capped at 1000                                                                                                         |
| Video poster                       | Stays hidden after a play, gives way to failure, falls back to the video when it fails to load                                           | Recomputed each frame, so a pause at 0:00 brings it back                                                               |
| Text Markdown                      | Linear patterns, code spans and escapes kept, `# C#` kept, heading and caption variants stripped too                                     | Quadratic on adversarial text, variants shown raw                                                                      |
| Check severities                   | `validationResults`, hints on every input but Button                                                                                     | Not done                                                                                                               |
| `asBoolean` of a validation result | Its validity                                                                                                                             | Null                                                                                                                   |
| `accessibility.live`, `hidden`     | NodeView, plus the core binding fix                                                                                                      | Not done                                                                                                               |
| Core argument check                | v1.0 catalogs only, any object with a boolean `valid`, falls back to the arguments with none replaced, v1.0 `grouping` read by validity  | `ValidationResult` instances only, on every version, so a v1.0 result object from the data model still fails the check |
| README host snippet                | `a2uiRendererDataModel`, capabilities, `outboundListener`, version-routed `processMessages`, `processor.dispose()`, both-versions wiring | v0.9 key `a2uiClientDataModel`, no `outboundListener`                                                                  |
| Codebase blueprint                 | Pinned to the v1.0 module blueprint, deviations recorded                                                                                 | Unchanged and stale                                                                                                    |

## Reviews

Two blind rounds, each one Astra (Codex `gpt-6-astra`, medium) plus a panel of Opus 5.5 reviewers at high effort, with every finding put to two skeptics and a completeness critic. Reports are in `cold-reads-2026-10-19-flutter-v1/`.

- Round 1, the code at `3cd032fc`: Astra 14 findings (13 confirmed), Opus 95 (91 confirmed, much overlap). Fixed in `92ff8a47` and `89bc59df`.
- Round 2, the first series `a465dc4a`: Astra 8, Opus 87 (64 confirmed), mostly message precision, plus the core argument check (spec allows extra properties on a result, object-typed arguments, v0.9). Fixed in `5b9891fb` and in the v2 messages.
- Round 3, the v2 series `e2514ce2`: Astra 4, Opus 23 (11 confirmed). The Slider live-region sentence, the unrecorded theme deviation, v1.0 `grouping`, and a Button remount on a hint tooltip, which led to dropping the Button hint. Fixed in `3d5c5704` and in the v3 messages.
- Round 4, a closing check of v3 `8c25c42a`: one message claim (commit 11 on the v0.9 `and`, `or` and `not`) and wording nits. Fixed in `a35eeb1c` and in the v4 messages.
- Round 5, a check of the v3-to-v4 edits: both new README claims held under probes, and one commit 12 sentence (a CheckBox's check message is announced) and a commit 9 scope nit were fixed in the v5 messages. The review loop stopped there, since the last fixes used wording a skeptic had checked with a probe.

## Open in both

- Blueprint section 8's "Theme ignored" row contradicts core: a v1.0 `createSurface` carrying `theme` fails with `VALIDATION_FAILED`.
- An explicit `accessibility.label` does not replace the label a Material control takes from its own text. On Button, CheckBox and Slider the attributes land on a parent node, and on TextField and Text the label is joined.
- `formatDate` ignores TR35 quoted literals, so 16_workout-summary and 30_live-invitation-builder show `PMt` for "at". This is a core bug, shared by web_core.
- The core fixes are ride-alongs in `a2ui_core` code that Andrew does not own. A PR body for either branch lists them.
