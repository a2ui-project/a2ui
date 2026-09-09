# Draft responses — PR #2538

Scratch file for the review replies. Not meant to be committed.

---

## 1. gemini-code-assist — `blueprints/modules/a2ui_core.blueprint.md:512`

> The blueprint matrix refers to 'A2uiValidator.parseMessages()' for envelope validation, but the static method added in the Dart implementation is named 'parseMessagesFor' (and 'parseMessages' is kept as an instance method). Consider aligning the blueprint or documenting this language-specific naming difference to avoid confusion.

**Draft reply:**

Fixed by aligning the implementation with the blueprint rather than the other way round.

The two names existed because Dart does not allow a static and an instance member to share a name, and the class had both an instance `parseMessages` (which closed over the validator's `protocolVersion`) and a catalog-free static. The instance one is gone now — parsing reads no catalog, so it does not need a validator — leaving a single static `parseMessages(payload, {required protocolVersion})`, which is what the blueprint says.

---

## 2. nan-yu — `blueprints/modules/a2ui_core.blueprint.md:472`

> FYI, I'm going to update the a2ui_core blueprint with the following changes:
>
> - Validation Entry Point: `MessageProcessor.processMessages` becomes the primary entry point for message validation.
> - PayloadValidator: `A2uiValidator` will be renamed to `PayloadValidator`, scoped to validate a single component, a single function, and theme against its corresponding catalog.
>   This cleanly justifies making the validator single-catalog: multi-catalog dispatch happens at the processor level, while PayloadValidator only ever evaluates a single component against its own catalog.

**Draft reply:**

Written into this PR, blueprint and Dart together, so the two do not drift while the change is in flight. Rewrite it as you see fit — this is the shape I read out of your two comments:

**`PayloadValidator`** (renamed from `A2uiValidator`) holds one catalog and checks one item against it: `validateComponent`, `validateFunction`, `validateTheme`. No payload-level entry point, and it no longer rejects a payload for naming another catalog — it cannot know which catalog an item belongs to, so that is not its decision to make. `parseMessages` is static, because envelopes read no catalog.

**`MessageProcessor`** holds every supported catalog and does the routing. It resolves the catalog per item, in the order: the item's own `catalogId` (v1.0's override), the surface's default from `createSurface`, then the sole supported catalog. `A2uiCatalogError` when none of those settles it — skipping would report a payload valid that nothing had looked at. Two entry points: `processMessages` applies a payload and checks each message against the surface it joins, and `validatePayload` checks a payload on its own with nothing applied and no surface required.

The blueprint's "Catalog Scope" section and the validation matrix are rewritten around that, with a new **Function Arguments** row for `validateFunction`.

Three things worth your eye:

1. **`validatePayload` is a second entry point, not a replacement for `processMessages`.** `processMessages` needs the surfaces to exist, and a fair number of payloads are checked before that is true: the whole `conformance/core/validator.yaml` suite is standalone payloads, several of which are incremental with no `createSurface`, and an agent checking its own output has no surface state either. So "the processor is the entry point for validation" is satisfied, but through two methods rather than one.
2. **`validateFunction` has no caller yet in Dart.** Function-call arguments are currently checked through the component schema, which reaches the catalog's functions via `anyFunction` in `common_types.json` — the `a call to a function the catalog does not declare` test in `validator_basic_catalog_test.dart` passes that way. `validateFunction` is implemented and tested as a per-item entry point because you named it, but nothing routes to it. Want it wired in as its own pass, or left as public API until v1.0 needs per-call catalog resolution?
3. **The rename does not reach Python or `web_core`.** The blueprint now says `PayloadValidator`, and `agent_sdks/python` still ships `a2ui.core.validating.A2uiValidator` (referenced from `blueprints/modules/a2ui_agent.blueprint.md`, `eval/DESIGN.md` and the Python README). Should I file a follow-up to rename there, or leave the blueprint ahead of those SDKs deliberately?

---

## 3. nan-yu — `dart/a2ui_core/lib/src/processing/processor.dart:71`

> Can we remove the default protocol version and make it required?
> Otherwise, we'd update the default value when a new protocol version is available.

**Draft reply:**

Done, and applied to `PayloadValidator` and `PayloadValidator.parseMessages` too, since the same argument holds for each: a default there would silently move every caller onto the next version the day one lands.

---

## 4. nan-yu — `dart/a2ui_core/lib/src/validation/validator.dart:454`

> This basically disallowed components from mixed catalogs, which is a key feature in v1.0.
>
> We should support that. Therefore, the validator can only validate a single component, but not all components overall.

**Draft reply:**

Agreed, and fixed. The check you flagged is gone, along with the payload-wide walk it belonged to.

What replaces it: catalog resolution is per item and lives on `MessageProcessor`, which is the only thing holding every supported catalog. Each component resolves through its own `catalogId` first, then the surface's default, then the sole supported catalog, and is checked by the validator for whatever that resolves to. `PayloadValidator` never sees the question.

So a payload spanning several catalogs is now checked against each of them rather than rejected, and the v1.0 per-component override works today rather than needing another pass later. New coverage in `validator_test.dart` under `MessageProcessor catalog resolution`:

| case                                                        | result                                 |
| ----------------------------------------------------------- | -------------------------------------- |
| `s1` → `cat1` + Alpha, `s2` → `cat2` + Beta, in one payload | accepted                               |
| `s1` → `cat1`, component `Beta` with `catalogId: cat2`      | accepted (v1.0 per-component override) |
| `s1` → `cat1`, component `Beta` with no override            | rejected                               |
| `s1` → `cat2` on a processor supporting only `cat1`         | `A2uiCatalogError`                     |
| incremental payload, several catalogs supported, none named | `A2uiCatalogError`                     |

The last row is the one case that still refuses rather than resolves: v0.9 declares `catalogId` on `createSurface` alone, so an incremental payload arriving with no surface state and more than one candidate catalog genuinely cannot be attributed. Validating it against an arbitrary catalog would report a payload valid that nothing had checked. Note this only affects `validatePayload` — through `processMessages` the surface exists and carries its catalog, so it never comes up.

Graph checks follow the same rule: `checkComponentTopology` and `checkComponentIntegrity` now take the reference fields merged across every catalog a surface draws on, so a mixed-catalog surface has its whole graph walked rather than the part one catalog happens to describe.

---

## Verification

- `dart analyze` in `dart/a2ui_core` and `dart/a2ui_agent`: no issues
- `dart test` in `dart/a2ui_core`: 304 passed, 25 skipped (pre-existing v0.8 conformance cases)
- `dart format`: clean; `prettier --check` on the blueprint and CHANGELOG: clean
- The `conformance/core/validator.yaml` suite runs unchanged through `MessageProcessor.validatePayload` — 21 cases, all passing

## Open items not covered above

- The shared suite is still named `core/validator.yaml` while it now exercises the processor. Renaming it is a cross-language change (the Python reference harness reads the same file), so it is left alone here.
- Dart's `MessageProcessor` is renderer-shaped: its catalogs carry `FunctionImplementation`, because a surface invokes functions. Agents hold schema-only catalogs (`SchemaCatalog`, functions as `FunctionApi`), and Dart generics are covariant, so a schema-only catalog is not one of those. Tests bridge it with a small `rendererCatalog` helper. If the agent SDK is meant to validate through `MessageProcessor`, that seam needs a real answer — either the processor becomes generic over the function type, or `a2ui_core` publishes the conversion.
