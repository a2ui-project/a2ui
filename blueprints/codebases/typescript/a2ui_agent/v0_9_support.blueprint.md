---
associated_module: a2ui_agent
codebase_path: typescript/a2ui_agent
---

# v0.9 protocol support addendum

This addendum resolves open question 1 in section 10 of `design_doc.blueprint.md`
("Should this SDK support v0.9 as well as v1.0?"). It is a separate file so the
original design doc stays as the record of what was built; nothing here edits it.

The brief had two conditions: add v0.9 only if it is cheap, and make it cheap to
remove again. Section 7 is written to satisfy the second condition, and it is the
part worth reading if you read nothing else.

---

## 1. Recommendation

Do it, in the reduced form described in section 8.

The cost is moderate rather than small, and it is not spread the way the design doc
guessed. Most of the work is confined to four files. One item, described in section
4, needs a decision before anything can start. The reward is 41 conformance cases
that currently skip.

Two of the changes below are worth making whether or not v0.9 ever lands, because
they remove hardcoded version literals that are wrong in principle today. Those are
marked as permanent.

---

## 2. Why this is smaller than the design doc assumed

The design doc treats v1.0-only as an architectural property of the SDK. It is not.
Multi-version handling already exists in `web_core` and the agent SDK sits on top of
it without using it.

`MessageProcessor` defaults to `v0.9`, not `v1.0`
(`typescript/web_core/src/processing/message-processor.ts:163`). More importantly,
inbound validation ignores the configured version entirely: `processMessages` calls
`this.adapterRegistry.resolveFromPayload(messages)`
(`message-processor.ts:439`), so the adapter is chosen per message from the
message's own `version` field. A `V0Point9Adapter` exists
(`typescript/web_core/src/processing/adapters/v0_9.ts`) and is registered by default
for `0.9` and `0.9.1` (`adapters/factory.ts:33-38`).

This confirms and explains an earlier finding on this project. During Phase 3 an
agent deleted a v0.9/v1.0 version test after concluding there was no observable
divergence for inbound validation. That conclusion was correct, and the reason is
`resolveFromPayload`. The `{version: 'v1.0'}` literal at
`src/processor/processor.ts:52` only affects `getRendererCapabilities`,
`getClientDataModel`, and outbound synthesis, none of which the agent SDK calls.

Catalog loading is also already version-aware. `schema_loader.ts` branches on
`isAtLeastVersion(protocolVersion, '1.0')` and stamps the version onto the resulting
`Catalog`, so `Catalog.fromSchema` handles a v0.9 inline catalog correctly today.

---

## 3. What is actually coupled to v1.0

Three kinds of coupling, in descending order of difficulty.

Hard couplings, which must change:

| File and line | What it is |
| --- | --- |
| `src/internal/web_core.ts:34-44` | Imports the message and capability schemas from `@a2ui/web_core/v1_0` |
| `src/internal/web_core.ts:46-47` | Re-exports `BASIC_COMPONENTS` and `BASIC_FUNCTION_APIS` from `@a2ui/web_core/v1_0/basic_catalog`. This is the line that hits the problem in section 4 |
| `src/types.ts:50-62` | `basicCatalog()` hardcodes the v1.0 catalog id and passes `'v1.0'` to the `Catalog` constructor, memoised in a module-level singleton at line 35 |
| `src/inference_formats/direct_json/streaming.ts:575` and `:971` | Synthesised partial messages stamped `version: 'v1.0'` |

Naming-only couplings. `V10RendererCapabilities` appears as a parameter type in
`src/processor/generator.ts:19,50` and `src/utils/catalog_resolver.ts:20,35`. The
type is structurally identical to v0.9's `A2uiVersionCapabilities`: both require
`supportedCatalogIds` and allow optional `inlineCatalogs`. This is naming debt, not
semantic debt. `resolveCatalogs` consumes the inner capabilities block and is
already version-neutral in behaviour.

Shape assumptions that a search for "v1.0" does not find:

* `src/processor/generator.ts:59-62` reads `msg.createSurface?.components` when
  validating examples. v0.9 `createSurface` has no `components` field, so under
  v0.9 this branch is dead and example validation silently does nothing.
* `src/inference_formats/direct_json/streaming.ts:603-613` makes the same
  assumption when harvesting inline components.
* `src/inference_formats/direct_json/streaming.ts:80-82` uses
  `{component: 'Row', children: {explicitList: []}}` as its placeholder.
  `explicitList` is v0.8 syntax. It appears nowhere in the v0.9 or v1.0
  specifications, which both define `ChildList` as either a plain array of
  component ids or a `{componentId, path}` template object. Python's equivalent is
  `{'component': 'Row', 'children': []}`. This is a live bug in the v1.0 code path
  and should be fixed independently of this addendum.

Already version-neutral, and not to be touched: `src/parser/constants.ts:20-29`,
which already carries both the v0.8 constants and the shared v0.9/v1.0 ones;
`src/processor/catalog_providers.ts`; `src/processor/catalog_config.ts`;
`src/catalog_transformers/pruning.ts`; and both prompt generators, which just
render whatever catalog they are given.

`V09_CHILD_REF_OPTIONS` and `V10_CHILD_REF_OPTIONS` have identical contents, so the
`buildComponentRefMap` call at `streaming.ts:77` costs nothing to generalise.

---

## 4. The one real blocker

The v0.9 basic catalog in `web_core` is coupled to Lit; the v1.0 one is not.

`typescript/web_core/src/v1_0/basic_catalog/index.ts` is 19 lines and exports three
pure data modules. No file under `v1_0/basic_catalog/` imports Lit.

`typescript/web_core/src/v0_9/basic_catalog/index.ts` is 60 lines and re-exports 18
Lit custom elements plus a Lit base element. 19 files under `v0_9/basic_catalog/`
import from `lit`. `v0_9/index.ts` is worse, since it also re-exports
`catalog/a2ui-lit-element.js` and `render-a2ui-node.js`.

`@a2ui/agent` is a Node package whose only runtime dependency is `@a2ui/web_core`.
Importing `@a2ui/web_core/v0_9/basic_catalog` would pull Lit and DOM-dependent
modules into a server SDK. That is not acceptable, so one of three things has to
happen.

The first option is to add narrow, pure subpath exports to `web_core`, for example
`./v0_9/basic_catalog/components`. This is clean and matches how v1.0 is already
shaped, but it changes another package's public API and so belongs in a separate
commit with its own review.

The second option is to import the deep path
`@a2ui/web_core/dist/src/v0_9/basic_catalog/components/basic_components.js`. This
works today and requires no changes elsewhere, but it bypasses the exports map,
which is exactly what the seam file at `src/internal/web_core.ts:17-23` was written
to prevent. Reject this.

The third option is to load the v0.9 basic catalog from its JSON definition at
runtime rather than from compiled code. This is what Python does
(`python/a2ui_agent/src/a2ui/basic_catalog/constants.py:24`). It sidesteps Lit
completely and needs no change to `web_core`. The cost is that the catalog becomes a
file read rather than a compile-time import, which means the package needs a way to
locate the JSON at runtime.

### Decision

Option three, and applied to v1.0 as well as v0.9 so that both versions load the
same way.

The JSON should come from `web_core`, not from the specification directory, and
that distinction has just become load-bearing. `scripts/copy-spec.js` copies the
versioned schema directories and the catalogs into
`typescript/web_core/src/<version>/schemas/`. Both
`src/v0_9/schemas/catalogs/basic/catalog.json` and
`src/v1_0/schemas/catalogs/basic/catalog.json` exist, and `web_core` publishes
`files: ["dist", "src"]`, so the JSON travels with the package.

Upstream PR #2693, merged on 2026-09-22 and not yet present in this branch, moved
the v1.0 basic catalog out of `specification/v1_0/catalogs/basic/` and into
`catalogs/basic/v1/`, because catalogs are versioned independently of the protocol.
It repointed `copy-spec.js` at the new source and left the copied destination
unchanged. Issue #2700 is open to do the same for v0.9 and v0.9.1, and lists
decoupling catalog `$id` derivation from repository paths in the Python and Kotlin
SDKs as part of that work.

So the destination inside `web_core` is stable while the upstream sources are in
motion. The rule for this package is to never name a
`specification/<version>/catalogs/...` path, which also rules out copying Python's
current approach in `basic_catalog/constants.py`, since that is one of the things
#2700 exists to undo.

Two gaps remain. The copied JSON never reaches `dist`, because `tsc` does not copy
non-TypeScript files, and no `exports` entry addresses it. Closing the first gap
properly means adding a subpath export to `web_core`, which would insulate this
package from `web_core`'s internal layout as well; the cheaper alternative is to
resolve the `web_core` package root and join the path, which needs no change there
but hardcodes the `src/<version>/schemas/` shape. This is the same access problem
the Express addendum has, so the two share one answer.

A second consequence of #2693 belongs in the API design. Catalog versions and
protocol versions are now separate axes: `catalogs/basic/v1/` is catalog major
version 1, not protocol v1.0. The `basicCatalog(version)` parameter described below
is keyed by protocol version, so it needs an explicit protocol-to-catalog mapping
rather than string manipulation on the version.

Applying this to v1.0 is a real change rather than a formality. The v1.0 basic
catalog is fully populated today: `basicCatalog()` assembles 18 components whose
property sets match the specification JSON exactly, as measured while writing the
Express addendum. Switching it to a JSON load swaps a working mechanism for a
different working mechanism, and the justification is consistency between versions
plus the fact that reading the JSON directly is what makes Express property
ordering match Python. Sequence it so v1.0 keeps passing its existing tests at each
step.

Option one stays worth doing as a separate `web_core` cleanup, since a Node-safe
subpath for the v0.9 component definitions is useful independently of this work.

---

## 5. Protocol delta that matters agent-side

Only differences with consequences for an agent are listed.

The message union differs in size. v0.9 has four members (`createSurface`,
`updateComponents`, `updateDataModel`, `deleteSurface`); v1.0 has those four plus
`callRendererFunction` and `agentFunctionResponse`. The message names themselves are
shared, so the existing parser constants serve both.

`createSurface` differs the most. In v0.9 `catalogId` is required, `theme` is
allowed, and there is no `components`, `dataModel`, or `metadata`. In v1.0
`catalogId` is optional, `theme` is gone, and `components`, `dataModel`, and
`metadata.extensions` are present. This is what makes the two shape assumptions in
section 3 v1.0-only.

`updateDataModel` has a deletion trap. In v0.9 `value` is optional and omitting it
deletes the key at `path`. In v1.0 `value` is required and deletion is expressed as
`value: null`. The streaming delta emitter at `streaming.ts:560-586` emits only
changed keys, so a v0.9 deletion does not round-trip the same way. This needs a
test rather than a code change.

Capability negotiation is structurally the same handshake in both versions. Only
the wrapping key differs, and the SDK consumes the inner block.

v0.9 has no `catalog_definition.json` and no `v0_9/schema/catalog-definition.ts`.
Inline catalogs are defined by `$defs/Catalog` inside
`specification/v0_9/json/client_capabilities.json`. This does not block anything,
because the SDK does not use the v1.0 catalog definition schema either.

---

## 6. What it buys

A renderable demo, first of all. The Lit, React and Angular renderers in this
repository all stop at v0.9, and there is no v1.0 renderer here; one is expected to
arrive from outside the repository, and v1.0 stays headless until it does. Supporting
v0.9 is therefore the only route to a sample that a human can look at, rather than an
A2A stream that has to be read. That is the reason this work is sequenced ahead of
the Express format, which is otherwise the higher priority.

Then the tests. 41 conformance cases, all in
`conformance/agent/streaming_parser.yaml`, all tagged `protocolVersion: "v0.9"`, all
`action: process_chunk`. Verified by direct count: that file holds 41 v0.9 cases, 39
v0.8 cases, and a single v1.0 case.

Against the current baseline of 36 runnable of 131, enabling v0.9 would take
runnable cases to roughly 77, subject to how many pass without a v0.9 streaming
subclass.

That count is for this branch. Upstream PR #2713, merged on 2026-09-21 to `main`,
renamed this file to `conformance/agent/legacy/streaming_parser.yaml` and left its
contents untouched, "until the SDKs move over". It also added 204 new cases in a
per-format layout, moved catalog fixtures to `conformance/test_data/catalogs/`, and
changed cases to name a fixture by path rather than inlining it. The 41 v0.9 cases
survive the move unchanged, so the figure above still holds, but the path does not,
and the harness reads inline catalog data today. The sequencing is settled: target
the suites where they are now, and migrate when `main` merges into `v1_0` and the
rename arrives. The migration is shared with the Express effort.

Two further v0.9 cases exist in `conformance/agent/inference_format.yaml`
(`test_generate_system_prompt_with_schema` and
`test_generate_system_prompt_v0_9_common_types`), but both use
`action: generate_prompt`, which the harness deliberately does not implement, and
both expect a "### Common Types Schema:" section the prompt generator does not
emit. Enabling v0.9 without also implementing prompt-generation conformance would
turn these two from skipped into failing. Quote the prize as 41, not 43.

One hidden cost: the v0.9 streaming cases reference
`commonTypesSchema: "test_data/simplified_common_types_v09.json"` and
`s2cSchema: "test_data/simplified_s2c_v09.json"`. The harness fixture loader at
`tests/conformance/fixtures.ts:24-45` reads only `protocolVersion` and
`catalogSchema` and drops both on the floor. Fixture plumbing is needed on top of
the source changes.

---

## 7. Design, and how removal works

The requirement that v0.9 be easy to remove drives the whole design. Three rules.

Rule one: every v0.9 import lives in `src/internal/web_core.ts` and nowhere else.
That file already declares itself the single funnel for `web_core` imports and the
rule already holds for v1.0. v0.9 imports go in a block delimited by
`// BEGIN v0.9 support` and `// END v0.9 support`, with aliases applied at the
boundary so that the names crossing out of the seam carry no version: for example
`A2uiMessageSchema as V09MessageSchema`.

Rule two: nothing outside the seam names a protocol version in a type. Introduce a
version-neutral `RendererCapabilities` type in the seam and change the four
annotation sites in `generator.ts` and `catalog_resolver.ts` to use it. This is
pure type-level work with no runtime effect. Python did not do this, and as a
result `V09Capabilities` is imported as the general capabilities type across at
least seven unrelated modules there. That is the specific mistake this rule exists
to avoid.

Rule three: the emitted version comes from the catalog, never from a literal.
`SchemaCatalog` already carries `protocolVersion`, and the stream processor already
holds the catalog. Replace the literals at `streaming.ts:575` and `:971`, and the
`{version: 'v1.0'}` at `processor.ts:52`, with a read of
`catalog.protocolVersion`. Python does exactly this in
`streaming_v09.py:266-269`. This change is permanent: it is correct on its own
terms and stays if v0.9 is later dropped.

To keep rule one honest, add an eslint `no-restricted-imports` entry banning
`@a2ui/web_core/v0_9*` everywhere except `src/internal/web_core.ts`. Without a
mechanical guard the imports will diffuse, and diffusion is the thing that makes
removal expensive.

Removal procedure, if v0.9 is later dropped. Delete the delimited block in
`src/internal/web_core.ts`. Delete `streaming_v09.ts` if it was needed. Remove
`'v0.9'` from `SUPPORTED_PROTOCOL_VERSIONS` in `tests/conformance/loader.ts:42`.
Drop the version parameter from `basicCatalog()`. Remove the eslint entry. That is
four source files and one test file, and the version-neutral type alias and the
catalog-derived version stay behind as improvements.

---

## 8. Implementation steps

The first three steps are worth doing on their own merits and do not commit the
project to v0.9.

1. Replace the three hardcoded version literals with reads of
   `catalog.protocolVersion` (`streaming.ts:575`, `streaming.ts:971`,
   `processor.ts:52`). Fix the `explicitList` placeholder at `streaming.ts:80-82`
   while in the file, since it is wrong for every version the SDK supports.
2. Introduce the version-neutral `RendererCapabilities` alias in the seam and
   repoint the four annotation sites.
3. Add the eslint `no-restricted-imports` guard for version-specific subpaths.
4. Build the catalog JSON loading path decided in section 4, and move v1.0 onto it
   first, while its existing tests still provide cover. Only once v1.0 passes
   unchanged does v0.9 get added on the same mechanism.
5. Add the v0.9 block to the seam, and give `basicCatalog()` an optional version
   parameter with a per-version memo map. Default stays `'v1.0'` so no caller
   breaks.
6. Make the two `createSurface` shape assumptions conditional
   (`generator.ts:59-62`, `streaming.ts:603-613`).
7. Teach `tests/conformance/fixtures.ts` to honour `commonTypesSchema` and
   `s2cSchema`.
8. Add `'v0.9'` to `SUPPORTED_PROTOCOL_VERSIONS` and run the suite. Record which of
   the 41 cases pass unchanged.
9. Only if step 8 leaves failures: add a `V09DirectJsonStreamProcessor` subclass
   overriding the placeholder component and the inline-components branch. Python
   shares one parser class between v0.9 and v1.0 and only forks for v0.8, which is
   evidence this step may not be needed. Do not write it speculatively.
10. Add a test for the `updateDataModel` deletion difference described in
    section 5.

---

## 9. Corrections to the design doc

Section 10 question 1 says the cost is "a second set of catalogs and capability
types". The capability types are structurally identical and need no duplication.
The catalogs do need handling, but the obstacle is Lit packaging rather than the
protocol.

Section 10 question 1 estimates reachability would go "from 31 of 119 to well over
100". Both numbers have moved. The current baseline is 36 of 131, and enabling
v0.9 alone reaches roughly 77. Passing "well over 100" also requires the 39 v0.8
cases, which are out of scope here.

Section 6 already notes that `MessageProcessor`'s version option defaults to
`'v0.9'`. What it does not say is that the option is close to irrelevant for this
SDK, because inbound validation dispatches from the payload.

---

## 10. Decisions

### Settled

v0.8 is out of scope for this SDK, permanently. It has a genuinely different message
model (`beginRendering` and `surfaceUpdate`), Python forks its stream parser for it,
and the 39 v0.8 conformance cases are not a small extension of this work. They stay
skipped.

Catalog access prefers whatever works without modifying `web_core`, which means
resolving the `web_core` package root and joining the path to the copied JSON. If
adding a subpath export to `web_core` turns out to be materially simpler or more
robust, take it instead. Keeping that change self-contained is still good practice,
but it is no longer a requirement: section 11 explains why cherry-picking it to
`main` ahead of the merge is not available anyway.

Conformance targets the suites where they are today, and migrates to the per-format
layout when PR #2713 reaches `v1_0` with the merge. Building against the current
paths is not wasted work, because #2713 kept those three suites intact under
`conformance/agent/legacy/` specifically so SDKs could move over on their own
schedule. The migration is shared with the Express work and belongs to neither
feature; section 6 describes what it involves.

### Open

Whether `basicCatalog()` should keep its module-level memo once it takes a version
parameter, or move to a map keyed by version. The latter is assumed above.

---

## 11. Where these changes land

Everything here lands on `v1_0`, via this feature branch. `main` is not a target.
`typescript/a2ui_agent` does not exist on `main` at all, which has restructured the
SDK directories under `agent_sdks/` and carries no `typescript/` tree, so neither the
preparatory steps in section 8 nor the `explicitList` fix have an upstream
counterpart to land. The `explicitList` placeholder is confined to
`src/inference_formats/direct_json/streaming.ts` on this branch; the only other
occurrences anywhere in the repository are in Python's v0.8 tests and an integration
script, where the syntax is correct. There is no upstream copy of the bug.

The direction of travel is `main` into `v1_0`, not the reverse. `v1_0` stays the
working branch and picks up the rest of the repository later. That is the reassuring
version of the divergence described below: this package is in a directory `main` has
never had, so the merge cannot collide with it, and nothing here needs to move.

What the merge brings, and what each item costs us:

* The conformance reorganisation from PR #2713. This is the one with real work
  attached, and section 6 describes it. Until it arrives, the harness keeps reading
  the three suites at their current paths; after it arrives, those paths become
  `conformance/agent/legacy/` and the per-format suites become available.
* The catalog relocation from PR #2693, `specification/v1_0/catalogs/basic/` to
  `catalogs/basic/v1/`. This costs us nothing, because the catalog access mechanism
  in section 4 reads the copy that `copy-spec.js` writes into `web_core`, and #2693
  deliberately left that destination path unchanged. The source path inside
  `copy-spec.js` will need repointing at merge time, but that is a `web_core`
  concern rather than an agent SDK one, and it is a single line.
* `agent_sdks/`, `dart/`, and the top-level `catalogs/`. No interaction with this
  package.

A `web_core` subpath export, if the catalog access decision in section 4 goes that
way, is the one change with a possible separate life. It could be cherry-picked and
published on its own, but `typescript/web_core` does not exist on `main` either, so
that would have to wait for the merge as well. Since both branches converge anyway,
there is no longer a reason to keep it cherry-pickable at the cost of a worse design.

---

## 12. Verification log

Checked against the repository on 2026-09-22 at commit `4e91ad9a`, the tip of
`feat/ts-agent`.

Verified directly by the author of this document: `MessageProcessor`'s default
version of `'v0.9'` at `message-processor.ts:163` and the `resolveFromPayload` call
at `:439`; the Lit asymmetry, by counting files importing from `lit` under each
basic catalog directory (19 under `v0_9`, 0 under `v1_0`) and the index file line
counts (60 and 19); the conformance counts of 41 v0.9, 39 v0.8, and 1 v1.0 in
`streaming_parser.yaml`; the harness gates at `tests/conformance/loader.ts:42-43`;
and that `explicitList` appears in `specification/v0_8/` only, with no occurrence
under `v0_9/` or `v1_0/`.

Verified in support of the section 4 decision: that
`typescript/web_core/scripts/copy-spec.js` copies the specification JSON and
catalogs into `src/<version>/schemas/`; that
`src/v0_9/schemas/catalogs/basic/catalog.json` and
`src/v1_0/schemas/catalogs/basic/catalog.json` both exist; that no catalog JSON
appears anywhere under `typescript/web_core/dist`; that `web_core` publishes
`files: ["dist", "src"]`; and that `typescript/a2ui_agent` imports Zod nowhere and
declares no Zod dependency. The claim that the v1.0 basic catalog is fully
populated comes from the property-order measurement recorded in the Express
addendum, which found 18 components on both the TypeScript and specification sides.

PR #2693 and issue #2700 were read from the GitHub API on 2026-09-22. Neither is
present in this branch: `catalogs/` here contains only `mcp`, and
`specification/v1_0/catalogs/basic/catalog.json` still exists locally. `origin/main`
in this clone is older than the merge, so the new layout could not be inspected
directly and the descriptions of it come from the PR and issue text. The TypeScript
conformance harness does not resolve specification catalog paths at all, so the move
does not affect the existing test suite; the pinned
`specification/v1_0/catalogs/basic/catalog.json` paths in `conformance/agent/skill.yaml`
belong to the four skill cases this SDK does not run.

The branch divergence in section 11 was established with `git ls-tree`:
`origin/main` has top-level `agent_sdks`, `catalogs`, and `dart` and no
`typescript`; `origin/main:agent_sdks` contains `python`; `origin/v1_0` has
`typescript`, and `origin/v1_0:typescript` contains `a2ui_agent` and `web_core`.
`git rev-list --count` reports 0 commits on `origin/v1_0` since this branch's
merge base `cb538fe3`, and 123 on `origin/main` since its much older merge base
`44a420b6`. `git merge-base --is-ancestor` confirms this branch's streaming commit
is not reachable from `origin/main`. Note that `origin/main` in this clone is stale
at `c08702a4` and predates both PR #2693 and PR #2713, so the contents of those
changes come from the GitHub API rather than from local inspection.

The PR #2713 case counts were obtained from the pull request file list via the
GitHub API, counting `- name:` entries in the added-file patches: 45 in
`express/compiler.yaml`, 17 in `express/response_parser.yaml`, 12 each in
`express/decompiler.yaml` and `express/prompt_generator.yaml`, for 86 Express cases
and 204 across all new suites. The three legacy renames were read from the same file
list.

The remaining file and line references come from a source survey performed for this
addendum. A sample of seven of its claims was checked independently and all seven
held, but the individual line numbers in sections 3 and 5 have not each been
reconfirmed and should be treated as accurate to within a few lines.

Not verified, and deliberately left for implementation: whether the 41 v0.9
streaming cases pass without a dedicated subclass. Section 8 is sequenced so this is
measured rather than assumed.
