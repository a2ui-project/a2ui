---
associated_module: a2ui_agent
codebase_path: typescript/a2ui_agent
---

# Express inference format addendum

This addendum expands section 5 of `design_doc.blueprint.md` into an implementation
plan and resolves parts of open questions 2 and 3 in section 10. It is a separate
file so the original design doc stays as the record of what was built; nothing here
edits it.

Section 2 corrects two errors in the design doc that would cause the work to be
mis-sized and mis-built. Read it before planning anything.

---

## 1. Status and cost

Express is a release requirement, so the question is not whether to build it but
what it costs and in what order. The figures below are here to size the work, not
to argue against it.

Roughly 3,400 lines of hand-written TypeScript, plus a checked-in ANTLR codegen
output and a new build step. The conformance return is one case on this branch but
86 on `main`, where PR #2713 landed an Express suite; section 6 covers what reaching
them costs. The payoff is inference cost: the specification claims a 55% to 70%
reduction in output tokens against native A2UI payloads, and that the compact
grammar suits small on-device models.

The risk that could have invalidated the approach has been measured and is
manageable. Property ordering between the two languages agrees everywhere except
the placement of one synthesised property on six components, and reading the
catalog JSON removes even that. Section 4 has the numbers.

Sequencing note: v0.9 support is being done first, and its section 4 decision
settles how this package reaches catalog JSON. Express inherits that mechanism
rather than choosing its own.

---

## 2. Two corrections to the design doc

The sentinel tag is wrong. The design doc uses `<a2ui-express>` at lines 471, 482,
and 565, and `blueprints/modules/a2ui_agent.blueprint.md:758` repeats it. The actual
tag is `<a2ui>` with closing `</a2ui>`. Python defines it as
`A2UI_INFERENCE_OPEN_TAG` alongside the Direct JSON `A2UI_OPEN_TAG = "<a2ui-json>"`,
and the one Express conformance case feeds `<a2ui>` as input. The string
`a2ui-express` does not occur anywhere under `specification/`, `python/`, or
`conformance/`. Shipping `<a2ui-express>` fails the only runnable case.

Express does not stream in Python. The design doc's cost table gives Express a
"113-line parser over the shared lexer" for streaming and says the streaming story
is "nearly free". The 113 lines correspond to `express/parser.py`, which contains no
streaming code at all. Neither `process_chunk` nor `supports_streaming` appears
anywhere under the Python Express directory, and an active test asserts the
failure message "Streaming is not supported by ExpressParser".

What exists instead is block-level partial tolerance. The shared `BlockLexer` emits
a part with `is_final=False` when a block is unclosed, and `ExpressCompiler.compile`
suppresses the syntax-error raise when `is_final` is false, with the visitor
truncating at the first error line. That yields a recompile-the-whole-buffer
behaviour which is quadratic in stream length and returns full payloads rather than
deltas. Nobody has wired it into a streaming entry point.

The consequence is that Express streaming in TypeScript would be original design
work with no reference implementation and no conformance cases to check it against.
It is not being built. See section 10.

Upstream agrees, and said so after this addendum was first drafted. PR #2713, merged
to `main` on 2026-09-21, added per-format conformance suites including four for
Express, and deliberately omitted a streaming one with the explanation: "Express has
no streaming suite because the format does not stream." Direct JSON got a
`response_streaming.yaml` in the same change. The design doc's cost table is
therefore wrong on this point in a way that is now settled rather than merely
suspected.

A third, smaller divergence: the design doc places the code at
`inference_formats/express/`, dropping the `experimental/` segment Python uses,
and Python marks both classes `@experimental`. That divergence is now deliberate.
Express is expected to graduate to non-experimental, so the TypeScript
implementation does not carry the segment or the marking. Section 10 records this,
including the fact that it leaves the implementation presented as supported while
its specification is still a proposal.

---

## 3. What Express is

Statements are assignments of component constructors to variables, inside `<a2ui>`
tags. The compiler flattens the resulting variable graph into the flat adjacency
list that `createSurface` expects. From the specification:

```
<a2ui>
root = Card(main_column)
main_column = Column([icon, title, description, actions], _, "center")
icon = Icon($/icon)
title = Text($/title, "h3")
description = Text($/description, "body")
actions = Row([yes_btn, no_btn], "center")
yes_btn_text = Text("Yes")
yes_btn = Button(yes_btn_text, _, Event("accept"))
</a2ui>
```

Arguments are positional, and the property names are omitted entirely. `_` marks a
skipped positional and compiles to `null`. `$/path` is an absolute data binding and
`$name` a relative one. Beyond component construction the format carries data model
assignment, validation checks such as `?required`, `Event(...)` for server events,
`_template(...)` for list templating, `surface(...)` for surface targeting,
`deleteSurface(...)`, and bare function calls that compile to `callFunction`.

Against Direct JSON the differences that matter are that the model writes no
property keys and no message envelope. The compiler recovers both: property names
come from the catalog schema by position, and the envelope kind is inferred.

The grammar is `specification/inference_formats/express/Express.g4`, 170 lines of
ANTLR4. Since Express has no JSON schema, the grammar is the closest thing to a
normative artefact and should be treated as the top authority for this format,
ahead of the prose specification at
`specification/proposals/express/a2ui_express.md`.

Two places where the grammar and the prose disagree, both of which need a
deliberate choice. The grammar skips newlines as whitespace, so it is not
line-oriented, yet the prose sells a "line-oriented grammar" as the basis for
streaming and describes reading input line by line. And `IDENTIFIER` is ASCII-only
in the grammar while the prose mandates UAX #31 Unicode identifiers. Follow the
grammar in both cases, because Python's generated parser does.

---

## 4. Property order, measured

Positional arguments only work if the compiler and the prompt agree with Python on
the order of each component's properties. The specification is explicit that the
compiler "reads the declared properties in their strict definition order".

Python reads that order off the catalog JSON document directly. TypeScript does not
have that document in the same place. In this SDK a catalog's `ComponentApi.schema`
is a Zod schema (`typescript/web_core/src/catalog/types.ts`), and a JSON Schema
document is only available through the `catalogSchema` getter, which lazily
regenerates it via `generateCatalogSchema(this)`.

This was measured on 2026-09-22 against the v1.0 basic catalog, comparing the
property sequence Python derives from
`specification/v1_0/catalogs/basic/catalog.json` with the sequence TypeScript
produces from `basicCatalog().catalogSchema`, in both cases discarding the
structural `component` and `id` keys.

The result is better than feared, with one exception that would have been severe.
Both sides expose the same 18 components. For 12 of them the property sequence is
byte-identical. There are zero reorderings of ordinary properties.

The exception is the synthesised `checks` property on the six Checkable components:
`Button`, `TextField`, `CheckBox`, `ChoicePicker`, `Slider`, and `DateTimeInput`.
Python detects checkability by matching the substring `"Checkable"` in a `$ref` and
appends `checks` to the end of the list
(`schema_helper.py:116-118`, whose comment reads "If it's checkable, add checks at
the end"). The TypeScript regenerated document inlines `checks` as the first
property instead.

Taken naively this shifts every positional argument by one on those six components.
`Button(child, variant, action)` would bind `child` to `checks`, `variant` to
`child`, and so on. Nothing in the type system or the test suite would catch it.

The fix is to stop deriving order from the regenerated document. Read the catalog
JSON instead, as described immediately below, and replicate Python's `checks`
append explicitly. That reduces the problem to a single rule stated in one place
rather than an emergent property of two independent schema generators.

Keep the comparison as a permanent test regardless of which route is taken. It is
cheap, and it is the only thing standing between a schema-generation change in
`web_core` and a silent cross-language divergence.

### Reading the catalog JSON

Read it from `web_core`, not from the specification tree. The distinction now
matters, because catalog locations upstream are moving and `web_core` is the thing
that absorbs the churn.

`scripts/copy-spec.js` copies the versioned schema directories and the catalogs
into `typescript/web_core/src/<version>/schemas/`. Both
`src/v0_9/schemas/catalogs/basic/catalog.json` and
`src/v1_0/schemas/catalogs/basic/catalog.json` exist, and `web_core`'s
`package.json` declares `files: ["dist", "src"]`, so the JSON is present in the
published package rather than only in a working tree.

That destination path is stable while the sources are not. Upstream PR #2693,
merged on 2026-09-22 and not yet in this branch, moved the v1.0 basic catalog from
`specification/v1_0/catalogs/basic/` to `catalogs/basic/v1/`, on the grounds that
catalogs are versioned independently of the protocol. It repointed `copy-spec.js`
at the new source while leaving the copied output where it was. Issue #2700, still
open, will do the same for v0.9 and v0.9.1, and explicitly calls out decoupling
catalog `$id` derivation from repository paths in the Python and Kotlin SDKs.

The rule that follows is simple: this package must never name a
`specification/<version>/catalogs/...` path. Anything that does will break twice,
once at #2700 and again at the next reorganisation.

Two gaps stand between the copied JSON and using it. It does not reach `dist`,
because `tsc` does not copy non-TypeScript files, and no `exports` entry addresses
it. Consuming it therefore needs either a new subpath export in `web_core`, which
insulates this package from the layout inside `web_core` as well, or resolution of
the `web_core` package root followed by a path join, which needs no change there
but hardcodes the internal `src/<version>/schemas/` shape.

One conceptual consequence of #2693 is worth carrying into the API. Catalog
versions and protocol versions are now separate axes: `catalogs/basic/v1/` is
catalog major version 1, not protocol v1.0. A protocol version maps to a catalog
version, but the two must not be assumed identical in any signature or path
construction.

Using the catalog JSON as the source of property order has three benefits beyond
correctness. It matches what Python reads, byte for byte, so the ordering question
stops being a question. It makes the `checks` synthesis an explicit rule in the
TypeScript implementation rather than something inherited from a schema generator
that knows nothing about Express. And it keeps the Express implementation working
if `web_core`'s Zod to JSON Schema generation changes shape later.

It does not, on its own, remove Zod from the dependency tree. `Catalog.fromSchema`
builds Zod schemas internally whatever the input, and `MessageProcessor` validates
with them. The agent SDK already declares no Zod dependency and imports Zod
nowhere, so Zod is an implementation detail of `web_core` from this package's point
of view either way.


---

## 5. Catalog agnosticism

`AGENTS.md` section 8 requires inference formats to derive catalog constraints from
the catalog schema rather than hardcoding them, and
`python/a2ui_agent/src/a2ui/inference_formats/README.md` states the same rule for
the Python package.

Python's Express mostly honours it. There are no hardcoded component names anywhere
in the Express directory, property mapping is driven by a schema crawl, and unknown
names are rejected by catalog lookup rather than an allowlist. `Event` and
`_template` are format-level reserved words defined by the specification, so
treating them specially is correct and not a leak.

Six places do violate the rule, and none should be ported as written:

* `compiler.py:540` decides whether a property is an action with
  `prop_name in ["action", "submitAction"]`.
* `compiler.py:546-552` coerces a list of strings into `{label, value}` objects. The
  detection is schema-driven but the predicate and the emitted key names are
  hardcoded.
* `compiler.py:563-568`, `:589-598`, and `:679-687` use the literal string `"value"`
  to decide whether a validation check gets an auto-bound target.
* `schema_helper.py:84-87` matches the substring `"Checkable"` inside a `$ref` and
  synthesises a `"checks"` property, which is then hardcoded in the compiler. A
  similar `$ref` sniff exists for `"DataBinding"` and `"Dynamic"`. These may not
  survive Zod to JSON Schema regeneration at all, which makes them a portability
  problem as well as a rule violation.
* `prompt_generator.py:60` and `:89` name `DateTimeInput` and the `action` parameter
  inside `EXPRESS_RULES`, the block that is supposed to be catalog-agnostic.
* `_schema_allows_databinding` exists twice with different behaviour, in
  `compiler.py:71-97` and `prompt_generator.py:96-113`, so the prompt and the
  compiler can disagree about whether a property accepts a `$` path. Port one
  implementation.

Each of these needs a schema-derived replacement, which is design work rather than
translation. The design follows. All six hardcodings are still present in
`origin/main`'s Python, shifted by about four lines, and that is the version to port.

### 5.1 The principle: name protocol types, never catalog content

A catalog reaches the protocol's shared types through `$ref`s into
`common_types.json`. The v0.9 catalog writes these as absolute URLs, and v1.0 and the
conformance fixtures write them as relative `common_types.json#/$defs/<Name>`. The
names under `$defs` (`Action`, `CheckRule`, `DataBinding`, `ComponentId`, …) are
defined by the protocol, not by any catalog. Recognising them is therefore no more
catalog-specific than recognising `Event` or `_template`.

Python's leak is not that it names these types. It matches **substrings** of any
`$ref` (`"Dynamic" in ref`, `"Checkable" in ref`), and it names **catalog
properties** (`"action"`, `"value"`, `"label"`, `"checks"`). The TS port applies two
rules:

* A `$ref` is recognised only if it points into `common_types.json`, and then only
  by the exact def name: regex `(^|/)common_types\.json#/\$defs/(\w+)$`. A catalog's
  own `#/$defs/MyDynamicThing` never matches.
* The compiler never names a catalog property. It learns property names from the
  schema. The one documented exception is option coercion (5.2 item 2).

`get_property_type` (`schema_helper.py:285-309`, with its `"Child" in ref` sniffs) is
used only by the Atom format and its tests, so it is not ported.

### 5.2 The replacements

Each rule was checked with a throwaway script against the v0.9 and v1.0 basic
catalogs and main's three conformance fixtures (forms, simplified, custom). The unit
tests for the TS schema helper should repeat these checks.

1. **Action slots.** A property is an action slot when its schema references the
   common `Action` def, directly or through `oneOf`/`anyOf`/`allOf`. This replaces
   `prop_name in ["action", "submitAction"]`. It selects exactly `Button.action` in
   every catalog checked, the same set as Python. `submitAction` appears in none of
   them.

2. **Option-object coercion: decided to match Python, as a documented exception.**
   When a property doesn't admit a path, is an array, and its items are an object
   schema declaring both `label` and `value` properties, each string `s` in the
   written list becomes `{"label": s, "value": s}`. This is the one place the port
   names catalog property names. It is kept because:
   * Coercion is a convenience whose meaning depends on the names. A string can
     stand in for `{label, value}` because a choice shown as its own value is a
     common idiom. No schema feature expresses "this object is a label/value pair".
   * The schema-shaped alternative looked at (items whose required properties all
     accept strings, excluding component references) selected the same property in
     every catalog checked. It is still the same guess in more general form: without
     the exclusion it would have wrongly caught `Tabs.tabs` (`title`, `child`), and a
     future catalog could defeat the exclusion too.
   * Matching Python keeps the two SDKs compiling the same Express text to the same
     JSON. No conformance case covers this, so parity is the only external check.

   The code carries a comment citing this section. When the rule fires or fails it
   only changes a convenience: a model can always write the objects out in full.

3. **The checked value.** Python binds a check's first argument when that parameter
   is literally named `value` and the component bound a property literally named
   `value`. The TS rule is to bind the check function's first declared parameter
   when the component bound a property **of the same name** to a path, and the
   written first argument isn't itself a path.
   * Both names come from the catalog.
   * Every check function in every catalog checked has `value` as its first
     parameter, so behaviour is identical.
   * This is the suite's rule, "a `?check` passes the component's own bound value",
     made precise.

4. **The check-rule property.** A component's check-rule property is found in one of
   two places:
   * its own property whose schema is an array of common `CheckRule`, which is how
     the forms fixture declares it; or
   * a property of that shape inside a common def the component pulls in via
     `allOf`, which is `Checkable.checks` in both basic catalogs.

   The schema helper exposes that property's name per component. The compiler uses
   it instead of the literal `"checks"` and leaves it out of the positional order. An
   inherited one is appended last, as Python does.
   * This finds the same six components per basic catalog as Python's `"Checkable"`
     sniff, plus the forms fixture's `TextField`. Python only picks that one up by
     accident: its own property happens to be named `checks`.
   * **Deliberate difference:** writing checks on a component with no check-rule
     property throws `ExpressValidationError`. Python silently emits a `checks` key
     that the component doesn't declare (verified: `Text("hi", _, _, [?required])`
     compiles to `Text` with `checks` and empty args).

5. **Prompt text.** `EXPRESS_RULES` names `DateTimeInput` and an `action` parameter.
   It is ported **verbatim**, because the skill conformance cases compare the
   generated files byte-for-byte against `conformance/test_data/skills/`. It stays a
   known leak, to be raised upstream rather than fixed here.

6. **One databinding predicate.** Python's two copies answer different questions, and
   neither is written structurally. The TS port uses one predicate, `admitsPath`: a
   schema admits a path if it is, or combines via `$ref`/`oneOf`/`anyOf`/`allOf`, an
   object schema declaring a `path` property. It never descends into `items` or into
   property values.
   * This covers `DataBinding` and every `Dynamic*` type, which reach `DataBinding`,
     as well as the `ChildList` template form `{componentId, path}`, with no names at
     all.
   * **Prompt:** a property is labelled `(static)` when it does not admit a path.
     Checked against the golden `express_catalog_instructions.txt`, it matches all
     75 labels (51 static, 24 not), with 0 mismatches.
   * **Compiler:** the forbidden-binding check applies `admitsPath` at the position
     where a path is written, following `items` and object properties down the
     schema.
   * **Deliberate difference:** Python rejects a path anywhere inside a property
     whose top level doesn't admit one. That wrongly rejects
     `Tabs([{title: $/t, child: c}])` even though `title` is a `DynamicString`
     (verified against Python).
   * The prompt's `(component ID)` label keeps Python's rule: a direct `$ref` to
     common `ComponentId`, by exact name. It must not resolve `Child` to
     `ComponentId`, because the golden labels `Card(child (static))`, not
     `(component ID)`.

### 5.3 Decisions

1. Option coercion matches Python: the `label`/`value` name test is kept as a
   documented exception (5.2 item 2).
2. The two Python bugs are fixed in TS, not copied: throwing on checks for a
   component that takes none (5.2 item 4), and binding checks by position
   (5.2 item 6). Both are recorded in `typescript/a2ui_agent/KNOWN_GAPS.md` §4 so an
   upstream Python issue can be filed from them.

---

## 6. Cost and conformance

Line counts are from the Python implementation. TypeScript estimates assume similar
structure with some added verbosity.

| Component | Python | TypeScript estimate | Risk |
| --- | ---: | ---: | --- |
| `format.ts` | 77 | 90 | low |
| `parser.ts` | 114 | 130 | low, `BlockLexer` already ported |
| `visitor.ts` | 217 | 280 | low, mechanical against the grammar |
| `schema_helper.ts` | 308 | 400 | high, see section 4 |
| `compiler.ts` | 834 | 1,000 | high |
| `decompiler.ts` | 465 | 550 | medium, needed for few-shot examples |
| `prompt_generator.ts` | 542 | 600 | medium |
| `errors.ts` | 186 | 200 | low |
| `constants.ts` | 25 | 30 | low |
| Harness format dispatch | n/a | 60 | low |
| ANTLR codegen script and config | n/a | 50 | low |
| Streaming | 0 | unknown | no reference, see section 2 |

Hand-written total excluding generated sources and streaming: about 2,768 lines in
Python, an estimated 3,400 in TypeScript. Generated ANTLR output is about 49 KB
across three files in Python and would be similar here.

Conformance has changed completely, and for the better, but not on this branch yet.

On this branch there is one runnable Express case:
`conformance/agent/inference_format.yaml` has a single `format: express` case with
`action: parse_full`. Four more sit in `conformance/agent/skill.yaml` using actions
the harness does not implement.

On `main`, PR #2713 landed on 2026-09-21 and added 204 conformance cases, of which
86 are Express:

| Suite | Cases |
| --- | ---: |
| `conformance/agent/express/compiler.yaml` | 45 |
| `conformance/agent/express/response_parser.yaml` | 17 |
| `conformance/agent/express/decompiler.yaml` | 12 |
| `conformance/agent/express/prompt_generator.yaml` | 12 |

There is no `express/response_streaming.yaml`. Its absence is deliberate, and the
PR states the reason directly: "Express has no streaming suite because the format
does not stream." That is independent upstream confirmation of the correction in
section 2.

The same PR reorganised everything else the harness depends on. The three suites
this SDK reads today are renamed to `conformance/agent/legacy/parser.yaml`,
`legacy/inference_format.yaml`, and `legacy/streaming_parser.yaml`, kept unchanged
"until the SDKs move over". Catalog fixtures move to
`conformance/test_data/catalogs/` and examples to `conformance/test_data/examples/`,
and cases now name a fixture by path instead of inlining it. The harness reads
inline catalog data today, so fixture resolution has to change before any of the new
suites can run.

Two consequences for planning. Express stops being a format with no test coverage
and becomes the best-covered format in the suite, which removes the main argument
against building it carefully. And the harness work is no longer a 60-line format
dispatch; it is a migration onto a new suite layout, shared with the Direct JSON and
v0.9 work rather than owned by Express.

These suites arrive here when `main` merges into `v1_0`, which is planned, so the
question is timing rather than whether. Do not wait for them. Build Express against
the single `parse_full` case and against unit tests written alongside the code, then
migrate the harness and turn on the other 85 when the merge lands. The alternative,
holding the work until the merge, trades a known schedule for an unknown one and
gains nothing, since the code has to be written either way.

The gate to open remains `SUPPORTED_FORMATS` at `tests/conformance/loader.ts:43`,
which currently holds `direct_json` only.

---

## 7. Implementation steps

1. Inherit the catalog JSON access mechanism built for v0.9, and land the
   property-order comparison from section 4 as a permanent test, including the
   `checks` placement on the six Checkable components.
2. Add codegen and check the generated lexer, parser, and visitor into the
   repository so a plain `yarn build` never runs the generator. Exclude the
   generated directory from eslint and prettier. Done 2026-09-23 with antlr-ng and
   `antlr4ng` (section 10): `yarn generate:express` runs `antlr-ng` with a visitor
   and no listener, matching Python's options. Findings: generated relative imports
   carry `.js`, so no post-processing is needed under `nodenext`; the generated code
   type-checks cleanly; regeneration is byte-for-byte deterministic; the lexer and
   parser ATNs and the `.interp` and `.tokens` files are identical to Python's.
   `generated_parser.test.ts` keeps the ATN comparison permanent and smoke-tests a
   parse. ESLint already ignores `**/generated/**`; a package `.prettierignore`
   covers prettier. The README documents regeneration.
3. Build `visitor.ts` and the AST types against grammar fixtures.
4. Build `schema_helper.ts`, with the ordering test from step 1 kept as a permanent
   regression test.
5. Build `compiler.ts`, replacing each of the six hardcodings in section 5 with a
   schema-derived rule. The milestone is the 45 cases in
   `conformance/agent/express/compiler.yaml` once the suite reaches this branch, or
   the single `parse_full` case until then.
6. Add `express` to `SUPPORTED_FORMATS` and add format dispatch to the harness,
   which currently instantiates `DirectJsonParser` unconditionally.
7. Build `prompt_generator.ts` and `decompiler.ts` against
   `express/prompt_generator.yaml` and `express/decompiler.yaml`.
8. Declare `supportsStreaming` false. Do not build Express streaming. Revisit only
   if streaming conformance cases appear for Express, which upstream has stated
   they will not while the format does not stream.

---

## 8. Changes needed to the shared seam

Four adjustments, all additive.

`Parser.parseChunk` is abstract at `src/parser/parser.ts:81`, which forces every
format to ship a streaming body. Python makes it concrete and throwing, and pairs it
with a `supports_streaming` flag on both the parser and the format. The TypeScript
contracts have no equivalent flag. Add `readonly supportsStreaming: boolean`
defaulting to false and demote `parseChunk` to a concrete default that throws.

`A2UI_OPEN_TAG` and `A2UI_CLOSE_TAG` at `src/parser/constants.ts:35-36` hold the
Direct JSON tags under generic names in the shared parser module, and
`DEFAULT_WORKFLOW_RULES` in the same file is Direct JSON prose. Namespace both
before a second format arrives. Python already separates `A2UI_OPEN_TAG` from
`A2UI_INFERENCE_OPEN_TAG`.

`createFormat` takes an array of catalogs but `DirectJsonFormat.createParser` uses
only `catalogs[0]`, and Python's Express is single-catalog by construction, while
`PromptGenerator` is already multi-catalog. Decided 2026-09-23: Express takes
exactly one catalog, matching Python, and throws when given more than one rather
than silently using the first. Within that catalog, names resolve first-match-wins in
Python's order (`compiler.py:713-776`): catalog components, then the built-ins
`_template` and `Event`, then catalog functions. A function sharing a component's
name, or a function named `Event` or `_template`, is unreachable without error, as
in Python. Up-front collision detection at catalog load, and multi-catalog support
with collision rules, are deferred.

Python surfaces a compilation error carrying line, column, help text, and partial
results, plus seven Express-specific error classes. TypeScript has `ParseError` and
`A2uiCatalogError`. New error types are needed, and the harness error-category map
will need extending.

---

## 9. Behaviour that must be matched exactly

Python's visitor discards every statement from the first error line onward and
silently drops individual statements that fail to compile, via a bare exception
handler. This is not sloppiness; it is the isolation step of the error-recovery
workflow in the specification. Parity means reproducing which statements survive, so
these paths need tests rather than tidying.

Sentinel tags are stripped twice in Python, once by `BlockLexer` in `unwrap` and
again by hand inside `ExpressCompiler.compile`. The duplication is load-bearing for
callers that invoke the compiler directly. Do not remove it without checking
callers.

`surface()` is specified as stateful, resolving to `createSurface` or
`updateComponents` based on session state, but `ExpressParser.compile` constructs a
fresh compiler on every call, so there is no session memory. Decided 2026-09-23:
match Python, which is stateless. Each `compile` call is independent. Every scope
that assigns `root` emits `createSurface` (on v0.9 followed by `updateComponents`,
and `updateDataModel` when data paths are assigned; on v1.0 a single
`createSurface` carrying `components` and optional `dataModel`). A scope with data
path assignments but no `root` emits only `updateDataModel`; one with neither raises
`ExpressUndefinedRootError`. `updateComponents` is never emitted on its own.

The specification also describes an error-recovery pipeline whose later steps send
broken lines to a fast model for correction. Python implements only the first step.
Do not scope the rest from a literal reading of the specification.

---

## 10. Decisions

### Settled

Express is a release requirement, so the comparison against `elemental` and `atom`
is not a gate on this work. Atom claims a further 25% to 50% token reduction over
Express and Elemental and may deserve its own evaluation later, but Express is the
one being shipped.

Streaming is not being built. `supportsStreaming` is false, matching Python. The
position to revisit it is the arrival of Express streaming conformance cases, and
upstream has stated there will be none while the format does not stream.

No `experimental/` path segment and no experimental stability marking. Express is
expected to graduate to non-experimental, so the TypeScript implementation lands at
`inference_formats/express/` and is presented as supported. This is a deliberate
divergence from Python's layout rather than an oversight.

The ANTLR toolchain is [antlr-ng](https://www.antlr-ng.org/introduction.html) 1.0.10,
a TypeScript port of the ANTLR 4.13.2 tool, as a devDependency, with the `antlr4ng`
3.0.16 runtime as a runtime dependency, both pinned exactly. Decided 2026-09-23,
superseding an earlier decision for the official 4.13.2 jar with the official
`antlr4` npm runtime.

The criterion is unchanged: Python stays the reference implementation for the
grammar. The earlier decision met it by sharing Python's jar. The current one meets
it by testing the output: the serialized ATN decides every lexing and parsing
decision, and `tests/unit/inference_formats/express/generated_parser.test.ts` asserts
that the TypeScript lexer and parser ATNs equal Python's checked-in ones value for
value. They do (1,985 and 1,416 values).

The official pair was dropped for two reasons found on 2026-09-23. The `antlr4`
runtime's type declarations fail under this package's `nodenext` resolution with 216
errors: its `types` entry `index.d.cts` re-exports subdirectories whose ESM `.d.ts`
files use extensionless relative re-exports. The generated code type-checks cleanly
under `moduleResolution: bundler`, so the fault is the runtime's packaging. And the
official tool needs Java, which the npm package does not ship. `antlr4ng` resolves
cleanly under `nodenext`, and `antlr-ng` runs under Node, so the toolchain needs no
Java and no jar download.

`antlr4ng` also removes what the parity notes had ranked as the largest divergence
risk. Its `AbstractParseTreeVisitor` has `defaultResult`, `aggregateResult`, and
`shouldVisitNextChild`, and its default `visitChildren` returns the last child's
result as Python's does, where the official JavaScript runtime returns an array. The
cost is that `antlr4ng` renames some accessors from methods to properties, so the
TypeScript visitor does not read line-by-line against Python's.

`antlr4ng-cli` remains rejected: it ships `antlr4-4.13.2-SNAPSHOT-complete.jar` and
needs Java. `antlr4ts` last published `0.5.0-alpha.4` on 2021-01-01 and predates the
ANTLR 4.10 serialized ATN format change, so it cannot read 4.13.2 output at all.

The reviewer notes asked for alongside this decision are written, at
`antlr_parity_notes.md` in this directory, revised for the current toolchain. They
cover the divergence risks, each marked verified or needing a test, the settled
build-integration problems, and a checklist for reviewing a grammar diff. The document
moves next to the generated code when the Express implementation lands.

Conformance targets the suites where they are today and migrates to the per-format
layout when PR #2713 arrives with the `main` into `v1_0` merge. Express is built
before then rather than waiting, for the reasons in section 6. This decision is
shared with the v0.9 work.

Whether Express graduates out of `specification/proposals/` is outside our control
and is not treated as a dependency. The format maintainer owns that move. This
implementation presents Express as supported either way, and the tension that
creates while the specification is still a proposal is accepted rather than
resolved.

### Open

Nothing. Every question raised by this addendum has an answer above.

---

## 11. Verification log

Checked against the repository on 2026-09-22 at commit `4e91ad9a`, the tip of
`feat/ts-agent`.

Verified directly by the author of this document: that `a2ui-express` occurs nowhere
under `specification/`, `python/`, or `conformance/`; that Python defines
`A2UI_INFERENCE_OPEN_TAG = "<a2ui>"` separately from `A2UI_OPEN_TAG = "<a2ui-json>"`;
that the one Express conformance case feeds `<a2ui>`; that neither `process_chunk`
nor `supports_streaming` occurs anywhere under the Python Express directory; that
`ComponentApi.schema` is typed as a Zod schema and `catalogSchema` is a lazily
regenerated getter calling `generateCatalogSchema`; and the harness gates at
`tests/conformance/loader.ts:42-43`.

The property-order result in section 4 was measured, not estimated. A script loaded
`basicCatalog()` from the built package, took its `catalogSchema`, and compared the
per-component property sequence against the one derived from
`specification/v1_0/catalogs/basic/catalog.json` by the same crawl Python performs
over `allOf`, `anyOf`, `oneOf`, and `properties`. Both sides reported 18
components. Twelve matched exactly, six differed only by the position of `checks`,
and no ordinary property was reordered. Python's append-at-the-end behaviour for
`checks` was then confirmed by reading `schema_helper.py:110-118`.

That measurement read the catalog from `specification/v1_0/catalogs/basic/`, which
is where it lives on this branch. Upstream PR #2693 has since moved it to
`catalogs/basic/v1/`. Only the location changed, so the numbers stand, but the path
in this document is the pre-rebase one. PR #2693 and issue #2700 were read from the
GitHub API on 2026-09-22; neither is present in this branch, and `origin/main` in
this clone is older still, so the new layout could not be inspected locally.

The facts in "Reading the catalog JSON" were confirmed by reading
`typescript/web_core/scripts/copy-spec.js`, listing
`src/v0_9/schemas/catalogs/basic/catalog.json` and
`src/v1_0/schemas/catalogs/basic/catalog.json`, finding no catalog JSON anywhere
under `typescript/web_core/dist`, and reading the `files` array in
`typescript/web_core/package.json`. That the agent SDK has no Zod import and no Zod
dependency was confirmed by grep over `typescript/a2ui_agent/src` and by reading its
`package.json`.

The evidence behind the ANTLR toolchain decision is recorded in the verification log
of `antlr_parity_notes.md` rather than repeated here. In summary, it comes from the
ANTLR target documentation and both tree-visitor runtimes at tag 4.13.2, from the
npm registry over HTTPS for the three candidate packages and the file listings of
their tarballs, and from the Python pins and codegen hook in this repository. The
`npm` client itself is blocked in this environment by a registry proxy.

The remaining file and line references come from a source survey performed for this
addendum. A sample of its claims was checked independently and held, but individual
line numbers in sections 5 and 6 have not each been reconfirmed.
