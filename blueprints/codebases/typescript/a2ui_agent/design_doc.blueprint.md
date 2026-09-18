---
associated_module: a2ui_agent
codebase_path: typescript/a2ui_agent
---

# TypeScript Agent SDK Design Doc

## Overview

This document describes how the `a2ui_agent` module blueprint is realized for Node.js.
The package is named `@a2ui/agent` and lives in `typescript/a2ui_agent`. It targets
A2UI protocol **v1.0** only; there is no backwards compatibility requirement, so the
design optimizes for a clean API surface over parity with older code paths.

The SDK covers catalog management, capability negotiation, prompt generation, response
parsing, and payload validation for agents that emit A2UI.

> [!NOTE]
> Interface shapes here follow `blueprints/modules/a2ui_agent.blueprint.md`. Where this
> SDK deviates, the deviation is called out inline and justified. Section 10 lists
> questions that are still open across languages, and section 11 records what was
> verified against the real code.

This document owns design: interface shapes, type signatures, naming, and the reasoning
behind each decision. It deliberately carries no step ordering, branch names, or
milestones. Its scope is **both** inference formats, Direct JSON and Express.

---

## 1. Dependency on `@a2ui/web_core`

The SDK reuses `@a2ui/web_core` rather than redefining catalog or schema types. The
module blueprint refers to this dependency as `a2ui_core`; in TypeScript, that role is
currently played by `web_core`.

| Subpath                             | What we use                                                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `@a2ui/web_core/catalog`            | `Catalog`, `CatalogInterface`, `ComponentApi`, `FunctionApi`, `loadCatalogFromSchema`                                                    |
| `@a2ui/web_core/v1_0`               | `AgentToRendererMessage`, `AgentToRendererMessageSchema`, `RendererToAgentMessage`, `V10RendererCapabilities`                            |
| `@a2ui/web_core/v1_0/basic_catalog` | `BASIC_COMPONENTS`, `BASIC_FUNCTION_APIS`                                                                                                |
| `@a2ui/web_core/validating`         | `validateRecursionAndPaths`, `STRICT_VALIDATION`, `getComponentReferences`, `buildComponentRefMap`, `V10_CHILD_REF_OPTIONS`              |
| `@a2ui/web_core/processing`         | `MessageProcessor` (see section 6)                                                                                                       |
| `@a2ui/web_core/errors`             | `A2uiError`, `A2uiValidationError`, `A2uiIntegrityError`, `A2uiRecursionError`, `A2uiStateError`, `A2uiDataError`, `A2uiExpressionError` |

`RendererToAgentMessage` types the inbound direction — user events and callbacks coming
back from a renderer. This SDK does not process those; it types them so an agent can
accept them without redeclaring the shape.

### Core contracts landing in `web_core`

The v1.0 core work defines contracts each language SDK should find in its core package.
Three are not in `web_core` as of this writing but are expected. **This design assumes
they exist**, and targets their agreed cross-language names rather than working around
their absence.

| Contract           | State when last checked                                       | This SDK's assumption                                              |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `PayloadValidator` | Specified in the `a2ui_core` blueprint; not yet in `web_core` | Per-catalog checks only, behind `MessageProcessor` — see section 6 |
| `A2uiCatalogError` | Not defined                                                   | Imported from core rather than declared locally                    |

**The validator is `PayloadValidator`, and it is not the entry point.** The `a2ui_core`
blueprint makes `MessageProcessor` the single entry point that both processes and
validates messages, because only it can span a mixed-catalog surface. `PayloadValidator`
is scoped to one catalog and checks a single component or function within it. An earlier
draft of this document had a standalone `A2uiValidator` doing whole-payload validation;
that class does not exist and would be the wrong shape if it did. Section 6 is written
around the processor instead.

**Renderer capabilities are `V10RendererCapabilities`**, used directly. Because this SDK
targets v1.0 only, there is nothing to abstract over and no reason to introduce an alias.
Review raised the possibility of an `A2uiRendererCapabilities` union spanning
`V09RendererCapabilities` as well — that becomes the right shape if and only if the SDK
takes on v0.9, which is open question 1. Until then the concrete type is the simpler and
more honest one.

There is no longer a `BasicCatalog` contract to wait on. `BASIC_COMPONENTS` and
`BASIC_FUNCTION_APIS` are defined programmatically, so a catalog is a `new Catalog(...)`
away — which is why `BundledCatalogProvider` was removed from the TypeScript side
entirely. One asymmetry to know about: `web_core` ships a ready-built `basicCatalog`
instance for **v0.9 only**, at `v0_9/basic_catalog/catalog.ts`. The v1.0 subpath exports
components and functions but no assembled catalog, so this SDK builds its own. A
ready-built v1.0 equivalent would be welcome but is not required.

> [!NOTE]
> The basic catalog may move out of the core modules altogether. Nothing here should
> depend on its current location beyond the single re-export module described below.

If any of these land under a different name, the changes here are import-level rather
than structural.

Errors this SDK raises extend `A2uiError` from `@a2ui/web_core/errors`, so callers can
catch agent and core failures uniformly. `ParseError` is defined locally on that base.

Two consequences worth calling out.

**Catalogs in an agent are schema-only.** `Catalog<T, F>` defaults `F` to
`FunctionImplementation`, the renderer-side shape that carries executable code. An agent
never invokes catalog functions; it only needs their signatures. So the SDK
parameterizes as `Catalog<ComponentApi, FunctionApi>` and exports a `SchemaCatalog`
alias for it. This also makes `loadCatalogFromSchema` a drop-in, since it already
returns exactly that type.

**Prompt generation gets the catalog schema for free.** `Catalog` exposes a
`catalogSchema` getter that lazily reconstructs the unified JSON Schema document, and a
`componentRefMap` getter for child-reference topology. Prompt generators and pruning
transformers build on those rather than re-deriving anything.

### Node.js compatibility, and the planned `a2ui_core` split

`web_core` depends on `lit` and `@lit/context`, which raised the question of whether it
is safe to import from a server process. This was tested by importing each subpath from
a plain Node process with no DOM globals. All resolved and evaluated cleanly, including
the package root. So there is no hard incompatibility to work around today.

The dependency is still expected to be temporary. The plan for the wider repository is
to split the framework-agnostic pieces of `web_core` — catalogs, schemas, validation,
protocol types — into a separate package, tentatively `@a2ui/a2ui_core`, and leave
`web_core` holding only the APIs that genuinely need a browser. Everything in the table
above falls on the `a2ui_core` side of that line.

That package does not exist yet, so this SDK depends on `web_core` for now. Two
implications:

- Confine `web_core` imports to the narrow subpaths in the table. Never import the
  package root, even though it happens to evaluate cleanly in Node. Keeping the surface
  small makes the eventual migration a change to import specifiers, not a redesign.
- Funnel those imports through a single internal re-export module so the swap touches
  one file.

### The bundled spec JSON is not a dependency

`web_core` currently copies `specification/<version>/json` and
`specification/<version>/catalogs` into its build output via `scripts/copy-spec.js`, and
no `exports` entry reaches the result. An earlier draft treated that as a gap this SDK
needed closed, on the assumption that the basic catalog had to be loaded from
`catalog.json`.

That assumption is obsolete. `web_core` is moving to Zod schemas as the single source of
truth and is expected to stop copying the JSON, and the v1.0 basic components and
functions are already defined programmatically. This SDK therefore builds catalogs from
the exported constants and never reads the bundled JSON, so the missing export entry
costs it nothing.

One consequence to accept: the `instructions` string that lives in `catalog.json` has no
programmatic equivalent. Prompt quality depends on it, so if it is not carried over to
the Zod definitions it has to be supplied by the agent as part of its own preamble.

---

## 2. Package structure

The blueprint standardizes this layout across languages. The tree below mirrors it, with
`.ts` modules in place of Python ones.

```
typescript/a2ui_agent/
├── src/
│   ├── processor/               # High-level application facade
│   │   ├── catalog_config.ts    # CatalogConfig
│   │   ├── processor.ts         # A2uiRequestProcessor
│   │   ├── generator.ts         # A2uiGenerator
│   │   └── catalog_providers.ts # CatalogProvider implementations
│   ├── inference_format/
│   │   └── base.ts              # InferenceFormat & InferenceFormatFactory
│   ├── inference_formats/
│   │   ├── direct_json/         # Self-contained Direct JSON package
│   │   │   ├── format.ts        # DirectJsonFormat, DirectJsonFormatFactory
│   │   │   ├── parser.ts        # DirectJsonParser
│   │   │   ├── streaming.ts     # DirectJsonStreamProcessor
│   │   │   ├── decompiler.ts
│   │   │   └── prompt_generator.ts
│   │   └── express/             # Self-contained Express DSL package
│   │       ├── format.ts        # ExpressFormat, ExpressFormatFactory
│   │       ├── compiler.ts      # ExpressCompiler
│   │       ├── decompiler.ts    # ExpressDecompiler
│   │       ├── parser.ts        # ExpressParser
│   │       ├── prompt_generator.ts
│   │       └── generated/       # ANTLR output, see section 5
│   ├── parser/
│   │   ├── parser.ts            # Abstract Parser
│   │   ├── response_part.ts     # Response part structures
│   │   └── errors.ts            # ParseError, A2uiCatalogError
│   ├── prompt/
│   │   └── generator.ts         # Abstract PromptGenerator
│   ├── catalog_transformers/
│   │   ├── base.ts              # CatalogTransformer
│   │   └── pruning.ts           # Component/Function pruning
│   ├── utils/
│   │   └── catalog_resolver.ts  # resolveCatalogs
│   └── index.ts
└── tests/
    ├── unit/
    └── conformance/             # YAML harness over conformance/agent/
```

---

## 3. Base contracts

`blueprints/modules/a2ui_agent.blueprint.md` defines these contracts for every language,
and they are not restated here. This section records only where the TypeScript SDK
departs from it, and why.

| Contract          | Departure                                                                    |
| ----------------- | ---------------------------------------------------------------------------- |
| all               | Method names are camelCase rather than the blueprint's Python spelling       |
| `CatalogProvider` | `load()` returns a promise, since the filesystem provider uses `fs.promises` |
| `Parser`          | Adds `hasA2uiParts`, and `parseStream` as async-iterable sugar               |
| `PromptGenerator` | Split into three sub-methods; `generate` takes an options object             |
| response parts    | Models the blueprint's structured shape, not Python's flat one               |

### Response parts

The blueprint's structured model — `TextPart`, `RawA2uiPart`, `RawResponsePart`,
`A2uiPart`, and `ResponsePart` as a union of text and compiled payload — is used as
written. The Python SDK still ships a flat `ResponsePart` carrying every field at once,
and is being brought into line. Modelling the target here avoids writing code we would
immediately have to unwind.

### Parser

Two additions to the blueprint's abstract `Parser`.

`hasA2uiParts(content)` reports whether the content holds at least one complete format
block, with an unterminated opening tag counting as false. The blueprint's `Parser` has
no content predicate, but the conformance suite exercises one through the `has_parts`
action and Python implements it as `has_format_content`. Review confirmed this is a
blueprint omission that will be corrected, so the method stays.

`parseStream(chunks, wrapped)` wraps `parseChunk` as an async generator, for `for await`
over a model stream. Every AI SDK this package intends to document exposes its response
stream as an async iterable, so this is the shape callers reach for. It adds no behavior:
`parseChunk` stays the primitive, and the conformance harness drives that rather than
this.

### Prompt generator

`blueprints/features/skill_generator.blueprint.md` requires every language SDK to split
prompt generation into three independently callable pieces, with `generate` as a template
method over them. The split exists so a skill generator can emit the base rules alone as
a standalone core skill, and each catalog's instructions as its own catalog skill,
without duplicating prompt-building logic.

```typescript
/** Options for assembling a complete system prompt. */
export interface PromptOptions {
  roleDescription?: string;
  workflowDescription?: string;
  uiDescription?: string;
  includeSchema?: boolean; // defaults to true
  includeExamples?: boolean; // defaults to false
  validateExamples?: boolean; // defaults to false
}

export abstract class PromptGenerator {
  /** Catalog-agnostic syntax contracts, grammar, and sentinel tags. */
  abstract generateBaseRules(): string;

  /** Signatures for one catalog, or for all bound catalogs. */
  abstract generateCatalogInstructions(includeSchema?: boolean, catalog?: SchemaCatalog): string;

  /** Few-shot examples for one catalog, or for all bound catalogs. */
  abstract generateExamples(catalog?: SchemaCatalog, validate?: boolean): string;

  /** Template method assembling the three above. Formats override the pieces, not this. */
  generate(options?: PromptOptions): string;
}
```

The feature blueprint gives `generate` six positional parameters with defaults. Six
positional strings and booleans read poorly in TypeScript and are easy to transpose at a
call site, so this SDK takes a single options object whose fields are those parameter
names in camelCase — which is also how the conformance YAML already spells them.

Multi-catalog behavior is mandated rather than chosen: when several catalogs are bound, a
generator compiles instructions for every one of them, never picking a default.

---

## 4. Catalog layer and processor facade

### Providers

```typescript
/** Loads a catalog definition. */
export interface CatalogProvider {
  /**
   * Loads and returns a catalog.
   *
   * Returns a promise, unlike the blueprint's synchronous `load()`, because the
   * filesystem provider uses `fs.promises`. The name is kept for cross-language parity.
   */
  load(): Promise<SchemaCatalog>;
}

/** Loads a catalog from a JSON file on disk. */
export class FileSystemCatalogProvider implements CatalogProvider {
  constructor(
    path: string,
    /** Expected protocol version. Throws on mismatch with the loaded catalog. */
    protocolVersion?: ProtocolVersion,
    /** Expected catalog ID. Throws on mismatch with the loaded catalog. */
    catalogId?: string,
  );
  load(): Promise<SchemaCatalog>;
}

/** Builds a catalog from an in-memory schema object. */
export class InMemoryCatalogProvider implements CatalogProvider {
  constructor(
    catalog: Record<string, unknown>,
    protocolVersion?: ProtocolVersion,
    catalogId?: string,
  );
  load(): Promise<SchemaCatalog>;
}
```

There is deliberately no bundled-catalog provider. Python has a
`BundledCatalogProvider` because it loads the basic catalog out of bundled JSON, but the
TypeScript equivalent was removed once `BASIC_COMPONENTS` and `BASIC_FUNCTION_APIS`
became programmatic definitions. Building the basic catalog is a `new Catalog(...)` call,
which needs no provider indirection. See section 1 for the v0.9 and v1.0 asymmetry.

### `CatalogConfig`

```typescript
/** Associates a catalog with the transformations to apply to it. */
export class CatalogConfig {
  constructor(
    readonly catalog: SchemaCatalog,
    readonly transformers?: CatalogTransformer[],
  );

  /** The catalog with all configured transformers applied in order. */
  get transformedCatalog(): SchemaCatalog;

  /** Loads a catalog from disk into a CatalogConfig. */
  static fromPath(
    catalogPath: string,
    transformers?: CatalogTransformer[],
  ): Promise<CatalogConfig>;
}
```

### `resolveCatalogs`

```typescript
/**
 * Matches renderer capabilities against registered catalogs and returns the active,
 * transformed set for this session.
 */
export function resolveCatalogs(
  catalogs: CatalogConfig[],
  rendererCapabilities: V10RendererCapabilities,
  acceptsInlineCatalogs?: boolean,
): SchemaCatalog[];
```

### `A2uiGenerator` and `A2uiRequestProcessor`

```typescript
/**
 * Agent-lifetime object holding every catalog the agent supports.
 *
 * Construct one at startup and keep it. Per request, ask it for a processor bound to
 * that caller's renderer capabilities.
 */
export class A2uiGenerator {
  constructor(
    catalogs: CatalogConfig[],
    examples?: Record<string, AgentToRendererMessage[]>,
    inferenceFormatFactory?: InferenceFormatFactory,
  );

  /**
   * Creates a processor negotiated against one renderer's capabilities.
   *
   * Validates the configured examples against the resolved catalogs and throws if an
   * example uses a component the negotiated catalogs do not support.
   */
  createProcessor(
    rendererCapabilities: V10RendererCapabilities,
    inferenceFormatFactory?: InferenceFormatFactory,
  ): A2uiRequestProcessor;
}

/** Request-scoped facade over the negotiated catalogs, prompt, parser, and validation. */
export class A2uiRequestProcessor {
  constructor(
    catalogs: SchemaCatalog[],
    examples?: Record<string, AgentToRendererMessage[]>,
    formatFactory?: InferenceFormatFactory,
  );

  /** The negotiated catalogs active for this request. */
  get activeCatalogs(): SchemaCatalog[];
  get examples(): Record<string, AgentToRendererMessage[]> | undefined;
  /**
   * Format-specific system prompt snippet to feed the model.
   *
   * Equivalent to `generate()` with defaults, kept as a property because the module
   * blueprint declares `prompt_snippet` that way. Callers wanting role, workflow, or UI
   * descriptions reach the full `PromptGenerator.generate(options)` through the format.
   */
  get promptSnippet(): string;

  /** Parses and validates a model response. */
  parseResponse(content: string): ResponsePart[];
}
```

> [!NOTE]
> The default `inferenceFormatFactory` is `DirectJsonFormatFactory`, matching the module
> blueprint. Callers pass `ExpressFormatFactory` explicitly to opt into the DSL.

---

## 5. Inference formats: Direct JSON, then Express

This SDK implements both formats behind the `InferenceFormat` seam. Direct JSON is the
default and the one the rest of this document assumes; Express is built on top of the
same seam.

### Why Direct JSON goes first

Three reasons, in descending weight:

1. **It carries almost all of the conformance suite.** 115 of the 119 agent cases are
   written against `<a2ui-json>`; only the four skill-generation cases target Express.
   Building it first means the harness has something real to assert against from the
   beginning rather than skipping almost everything.
2. **It is the stable format.** Python ships Direct JSON at
   `inference_formats/direct_json/`, while Express sits under
   `inference_formats/experimental/`. The module blueprint also defaults
   `A2uiGenerator` to `DirectJsonFormatFactory`.
3. **It has no toolchain dependency.** Express needs ANTLR codegen wired into the build;
   Direct JSON needs nothing beyond `JSON.parse`. Deferring that keeps the first format
   unblocked.

### Relative cost

Measured against the Python reference, the two are closer than they look, and the work
is shaped differently:

|           | Direct JSON (v1.0-relevant)        | Express                               |
| --------- | ---------------------------------- | ------------------------------------- |
| Total     | ~2,000 lines                       | ~4,200 lines                          |
| Streaming | 1,349-line incremental JSON healer | 113-line parser over the shared lexer |
| Grammar   | none                               | ANTLR, generated from `Express.g4`    |

Direct JSON is less code overall, but its bulk is intricate hand-written JSON repair —
healing truncated payloads mid-stream — which is where its 82 streaming conformance
cases concentrate. Express is more code, but most of it is generated from a declarative
grammar, and its streaming story is nearly free because the DSL tokenizes cleanly at
expression boundaries. Express also costs meaningfully fewer output tokens at inference
time, which is the reason to carry both rather than stopping at one.

### Direct JSON package contents

`DirectJsonFormat` and `DirectJsonFormatFactory`; `DirectJsonPromptGenerator` rendering
pruned catalog definitions and `<a2ui-json>` output instructions; `DirectJsonParser`
handling tag unwrapping, payload fixing, and compilation; and `DirectJsonStreamProcessor`
for incremental chunks with progressive token healing over a configurable
`progressiveKeys` set.

### Express package contents

`ExpressFormat` and `ExpressFormatFactory`; `ExpressPromptGenerator` rendering compact
positional signatures for catalog components and functions; `ExpressCompiler` lexing and
parsing `<a2ui-express>` expressions into `AgentToRendererMessage` lists;
`ExpressDecompiler` for the reverse; and `ExpressParser` delegating to both and handling
streaming chunks.

### The ANTLR dependency, for Express

Python generates its Express lexer and parser with ANTLR from
`specification/inference_formats/express/Express.g4`, and depends on
`antlr4-python3-runtime`. The grammar is target-agnostic, so TypeScript generates from
the same file and stays in lockstep with Python.

Concretely, the compile path is: strip the `<a2ui-express>` tags, feed the body through
the generated lexer and parser to get a parse tree, walk it with a hand-written visitor
into AST nodes, then map those onto `AgentToRendererMessage` objects. ANTLR covers only
the lexer and parser — roughly 1,400 of the ~2,790 lines. The visitor and compiler are
hand-written regardless.

This adds an ANTLR TypeScript runtime and a codegen step. Generated sources land in
`inference_formats/express/generated/` and are checked in, so a plain `yarn build` needs
no Java toolchain; regeneration is a separate script run when the grammar changes.
Sharing one grammar makes divergence between the Python and TypeScript Express dialects
a grammar change rather than a silent drift. The runtime package choice is open in
section 10.

---

## 6. Validation

Validation runs through `MessageProcessor` from `@a2ui/web_core/processing`. The
`a2ui_core` blueprint makes it the single entry point that both processes and validates
messages, and it is the only component that can see a whole surface built from more than
one catalog. `PayloadValidator` sits underneath it, scoped to a single catalog, checking
one component or function at a time. This SDK calls neither directly beyond constructing
the processor; it adds no validator wrapper of its own.

```typescript
const processor = new MessageProcessor(negotiatedCatalogs, undefined, {version: 'v1.0'});
processor.processMessages(messages);
```

> [!IMPORTANT]
> `MessageProcessorOptions.version` defaults to `'v0.9'`. A v1.0-only SDK must pass
> `'v1.0'` explicitly on every construction, or it will silently validate against the
> wrong version adapter. This is the single easiest mistake to make in this layer.

`processMessages` is the entry point: it applies a payload to surface state and checks
each message against the surface it joins. The processor rejects a `createSurface` whose
`catalogId` was never negotiated, or a component drawn from a catalog the renderer did
not offer, with `A2uiCatalogError`. Surface lifecycle violations — creating a surface
twice, updating one that does not exist — raise `A2uiIntegrityError`.

Envelope structure is not the validator's job. The version adapter checks the version
header, confirms exactly one update type is present, and validates against the versioned
protocol schema before any catalog is consulted. `PayloadValidator` cannot see a whole
envelope, and exposes only `validateComponent`, `validateFunction`, and `validateTheme`
— one item, one catalog, per call.

### Why the processor rather than a validator

Checking a payload in isolation is weaker than it looks. When a payload updates a surface
it did not create, it carries no component tree, so a reference to a component the agent
sent in an earlier payload cannot be resolved and is accepted by default. Cycles spanning
two payloads go unnoticed for the same reason.

Running the processor over outbound messages keeps that tree. References resolve against
what the surface already holds, and cycles are found across the whole surface rather than
one payload at a time. The renderer performs equivalent checks on arrival, so doing this
first catches a bad payload before it is sent rather than after.

`A2uiRequestProcessor` therefore maintains a `MessageProcessor` over the messages it has
emitted and validates against that accumulated state. This costs memory proportional to
surface size and makes the processor stateful across a session, which is worth being
deliberate about.

> [!NOTE]
> An earlier draft of this section had a standalone `A2uiValidator` performing
> whole-payload validation. No such class exists, and review established that it would be
> the wrong shape: single-catalog validation and surface-spanning validation are
> different jobs, split across `PayloadValidator` and `MessageProcessor` respectively.

---

## 7. Conformance testing

The project keeps a language-agnostic suite in `conformance/agent/`. Running it is part
of this SDK's work, and so is extending it.

### What the suite contains today

| Suite                   | Cases | Protocol versions              | Format           |
| ----------------------- | ----- | ------------------------------ | ---------------- |
| `parser.yaml`           | 23    | unversioned, plus 3 × v1.0     | `<a2ui-json>`    |
| `streaming_parser.yaml` | 81    | 39 × v0.8, 41 × v0.9, 1 × v1.0 | `<a2ui-json>`    |
| `inference_format.yaml` | 23    | 8 × v0.8/v0.9, 1 × v1.0        | `<a2ui-json>`    |
| `skill.yaml`            | 4     | v1.0 basic catalog             | `<a2ui-express>` |

Direct JSON carries 127 of the 131 cases. The four in `skill.yaml` are the only Express
coverage anywhere in the repository, and they test skill generation rather than parsing.
The suite grew by 12 cases in September, and v1.0 coverage finally appeared: 3 in
`parser.yaml` and 2 `process_chunk` cases.

### What is actually reachable

Counting by suite is misleading, because reachability depends on the action and the
protocol version, not the file. With Direct JSON implemented and the SDK targeting v1.0
only:

| Action                                                    | Cases | Reachable?                                      |
| --------------------------------------------------------- | ----- | ----------------------------------------------- |
| `select_catalog`                                          | 8     | Yes, with a caveat — see below                  |
| `load_catalog`                                            | 3     | Yes — format- and version-agnostic              |
| `has_parts`                                               | 3     | Yes — unversioned, Direct JSON tags             |
| `parse_full`                                              | 15    | Yes — 12 unversioned, 3 × v1.0                  |
| `fix_payload`                                             | 8     | Yes — unversioned JSON repair                   |
| `process_chunk` (v1.0)                                    | 2     | Yes                                             |
| `process_chunk` (v0.8/v0.9)                               | 80    | No — protocol versions this SDK does not target |
| `generate_prompt`                                         | 8     | No — see below                                  |
| `from_format`, `core_syntax`, `from_catalog`, `skill_set` | 4     | Not yet — need Express and a skill generator    |

The `select_catalog` caveat: the action has no counterpart in
`blueprints/modules/a2ui_agent.blueprint.md`, so what it asserts is not traceable to a
specified method. Review flagged the cases themselves as needing an update, so treat the
8 as provisionally rather than definitively reachable.

**39 of 131 cases run**, rising to 43 once Express and skill generation land. Everything
skipped is gated on protocol version, on a deprecated API, or on Express — not on
anything Direct JSON does.

The 8 `generate_prompt` cases skip on protocol version alone: each passes `version: 0.8`
or `version: 0.9` in its arguments. Their shape is no longer an obstacle. The skill
generator feature blueprint puts `roleDescription`, `workflowDescription`, and
`uiDescription` back onto `generate` (section 3), and the YAML already names its
arguments in exactly that camelCase. v1.0 variants of these cases would run against this
SDK unchanged, which is what makes them worth authoring.

The 76 skipped streaming cases are the real loss, and they are why authoring v1.0
streaming cases matters below.

### Scope

1. **Build the harness** in `tests/conformance/`, following
   `python/a2ui_agent/tests/conformance/test_conformance.py`, declaring both
   `SUPPORTED_PROTOCOL_VERSIONS` and `SKIP_TEST_NAMES`. The 31 reachable cases pass; the
   rest are skipped and logged.
2. **Author v1.0 streaming cases**, since `streaming_parser.yaml` stops at v0.9. This is
   the largest genuine gap in the suite, and Direct JSON streaming is where the
   trickiest logic lives, so the coverage is worth the most here.
3. **Author v1.0 `generate_prompt` cases.** The existing 8 stop at v0.9, and the prompt
   contract is now fixed across languages, so v1.0 equivalents would pin down prompt
   assembly for every SDK rather than just this one.
4. **Author Express cases** once Express lands: `has_parts`, `parse_full`, and
   compile/decompile coverage with `<a2ui-express>` inputs, mirroring the Direct JSON
   cases. Contributed upstream to `conformance/agent/` rather than kept local, so any
   later Express implementation inherits them.

Deriving Express cases carries a risk worth naming: a conformance suite written from a
single implementation encodes that implementation's bugs as the specification. Express
cases should be derived from `Express.g4` and cross-checked against the Python Express
implementation, not transcribed from our own output.

### Harness mapping to the structured part model

The YAML expectation format predates the blueprint's structured parts, and combines both
kinds of content in one entry:

```yaml
expect:
  - text: 'Hello'
    a2ui: [{'id': 'test'}]
  - text: 'Goodbye'
```

Under `ResponsePart = TextPart | A2uiPart` a single part cannot hold both, so the harness
maps each YAML entry to one or two parts: a `TextPart` when `text` is non-empty, followed
by an `A2uiPart` when `a2ui` is present. An entry with `text: ""` and a payload yields
only the `A2uiPart`.

This mapping lives in the harness for now. If the Python migration to structured parts
also revises the YAML expectation format, this SDK should follow rather than keep its own
translation layer — see section 10.

---

## 8. Deliberate exclusions

Two responsibilities that belong to the module but are out of scope for this SDK's first
release. Both are additive: they compose over the contracts in sections 3 and 4 without
changing them, so deferring them costs nothing structurally.

### Transport

The blueprint lists transport packaging as an Agent SDK responsibility, realized in
Python as `a2a/` and `adk/` subpackages with their own conformance suites under
`conformance/extensions/`.

This SDK stays transport-agnostic: it produces `AgentToRendererMessage` objects and has
no opinion about delivery. Shipping transport bindings now would double the surface
before the core has proven itself. The sample application demonstrates one concrete
transport instead.

### Skill generation

`blueprints/features/skill_generator.blueprint.md` specifies `Skill`, `SkillSet`, and
`SkillGenerator` — a compiler that turns an `InferenceFormat` into `SKILL.md` packages for
managed agent platforms. Python ships it at `python/a2ui_agent/src/a2ui/skill/`, and
`conformance/agent/skill.yaml` covers it with four cases.

This SDK does not implement it yet. The feature blueprint is explicit that skill
generation is a composition layer sitting strictly on top of `InferenceFormat` and
`PromptGenerator`, so it can be added later without touching either. What this SDK does
take on now is the half of the contract that is _not_ additive: section 3's decomposed
`PromptGenerator`. Retrofitting that split after concrete formats exist would mean
rewriting each one, so it is cheaper to build it in from the start.

The four conformance cases stay out of reach regardless, since all of them generate
Express skills.

---

## 9. Sample application and documentation

Because the SDK is transport-agnostic, its ergonomics are hard to judge from the API
alone. A sample covers that: a port of the restaurant finder agent to a Node server,
running over a plain HTTP framework or the JS ADK with streaming enabled. The sample
owns the transport entirely; nothing about it leaks back into the SDK.

User-facing documentation carries integration examples for the runtimes agents are
actually built on: `@google/genai`, the ADK, the OpenAI SDK, and the Vercel AI SDK.
Each shows the same two touch points — feeding `promptSnippet` into the system prompt,
and driving the parser from that runtime's response stream.

---

## 10. Open questions

Cross-language questions this SDK cannot settle alone. Grouped by what kind of decision
each needs. Nothing here blocks starting implementation; items marked **blocking** must
be resolved before the affected area is finished.

### A. Scope

1. **Should this SDK support v0.9 as well as v1.0?** This document assumes v1.0 only.
   Review challenged that: Dart will support v0.9 and v1.0, Python supports v0.8 through
   v1.0, and all of them are expected to be forward compatible. A TypeScript SDK that
   stops at v1.0 would be the odd one out.
   The cost is not evenly spread. Supporting v0.9 means a second set of catalogs and
   capability types, but it also unlocks the 76 v0.8/v0.9 streaming conformance cases
   that section 7 currently writes off — reachability would go from 31 of 119 to well
   over 100.
   **Blocking** for section 7's scope and for the capability types in section 1.

### B. Decisions with repository-wide reach

2. **Which ANTLR TypeScript runtime?** Generating from the shared
   `specification/inference_formats/express/Express.g4` is decided: a single grammar
   compiled for both languages makes TypeScript/Python dialect divergence structurally
   impossible rather than merely unlikely, which is worth a codegen step. What remains
   open is which runtime package to use. Python uses `antlr4-python3-runtime`; the
   TypeScript ecosystem offers several options with meaningfully different maintenance
   stories, and the choice sets precedent for any future TS grammar work.
   **Blocking** for the Express compiler.

3. **Should Express graduate out of `proposals/`?** Its specification lives at
   `specification/proposals/express/a2ui_express.md` while its grammar sits at
   `specification/inference_formats/express/Express.g4`, and the Python implementation
   is under `inference_formats/experimental/`. Less urgent now that Direct JSON carries
   the SDK, but still worth settling before Express ships to users: either promote the
   spec, or record that implementations are knowingly ahead of it.
   Express decisions, including this one and question 2, are owned by the Express format
   maintainer rather than settled here.

### C. Dependencies on other work

4. **Core contracts landing in `web_core`.** This design assumes `PayloadValidator` and
   `A2uiCatalogError`, neither of which exists there yet (section 1). **Blocking** for
   validation.

5. **Does the YAML expectation format change with structured parts?** Existing cases put
   `text` and `a2ui` in one entry, which the structured model splits into two parts.
   This SDK's harness translates (section 7), but if the Python migration also revises
   the YAML format, the translation should be dropped rather than duplicated in every
   SDK. Whoever lands the Python change should decide.

6. **`a2ui_core` package.** Section 1 assumes the framework-agnostic half of `web_core`
   eventually moves there. Timing affects when this SDK repoints its imports, but
   nothing here waits on it.

### Resolved

- **Which inference formats.** Both, with Direct JSON as the default. Rationale in
  section 5.
- **Who owns v1.0 and Express conformance cases.** This SDK, per section 7.
- **Transport packaging.** Deliberately excluded, per section 8.
- **Skill generation.** Deliberately excluded, per section 8, but the `PromptGenerator`
  decomposition it mandates is adopted in section 3.
- **ANTLR for Express.** Generating from the shared `Express.g4` is settled; only the
  runtime package remains open (question 2).
- **What validates a payload.** `MessageProcessor` is the entry point and
  `PayloadValidator` the per-catalog check, per section 6. There is no `A2uiValidator`.
- **`CatalogConfig` holds a resolved `Catalog`**, not a provider — confirmed in review.
  It held a provider originally and was changed once `BasicCatalog` could be referenced
  directly. The module blueprint still reads both ways and will be made consistent.
- **The streaming method is `parseChunk`**, matching `parseResponse` — confirmed in
  review. Python's `process_chunk` is the one that moves.
- **`Parser` gains a content predicate.** Confirmed as a blueprint omission; it will be
  added there, and this SDK keeps `hasA2uiParts`.
- **No `BundledCatalogProvider`.** Removed from TypeScript; the basic catalog is
  constructed directly, per sections 1 and 4.

---

## 11. Verification log

Checked against the repository on 2026-09-11 at commit `6e3e9d3`, re-checked on
2026-09-14 at `2297b4ac`, revised on 2026-09-18 against review feedback on PR #2651, and
re-verified the same day at `99f4fd17`, the tip of the `v1_0` branch.

Confirmed present and shaped as documented: `Catalog`, `loadCatalogFromSchema`,
`AgentToRendererMessage`, `RendererToAgentMessage`, `V10RendererCapabilities`,
`BASIC_COMPONENTS`, `BASIC_FUNCTION_APIS`, `MessageProcessor`, the `A2uiError` hierarchy
in `@a2ui/web_core/errors`, and Node-safe subpath imports for every `web_core` path in
section 1.

Confirmed absent from `web_core` and assumed to be landing: any validator class and
`A2uiCatalogError`. Also absent: `V09RendererCapabilities`, which this SDK would only
need if it took on v0.9, and any export path reaching the bundled v1.0 basic catalog
JSON, which it no longer needs either way.

Verified while acting on review feedback. `BundledCatalogProvider` is gone from
TypeScript but still present in `python/a2ui_agent/src/a2ui/basic_catalog/provider.py`
and the legacy Kotlin SDK. A ready-built `basicCatalog` instance exists only at
`v0_9/basic_catalog/catalog.ts`; the v1.0 subpath exports components and functions with
no assembled catalog. `scripts/copy-spec.js` still copies the specification JSON and
catalogs into the build, so the move to Zod-only is intent rather than current state.

Section 10 was reconciled against `v1_0_implementation_plan.md` on 2026-09-14. The
Python agent SDK is at the end of that plan's Stage 3: `A2uiGenerator`,
`A2uiRequestProcessor`, and the `processor/`, `catalog_transformers/`, and `utils/`
packages the blueprint describes do not exist yet.

Section 3's `PromptGenerator` follows
`blueprints/features/skill_generator.blueprint.md`, added on the same branch and bound to
the `a2ui_agent` module. Its four conformance cases in `conformance/agent/skill.yaml` all
generate Express skills against `specification/v1_0/catalogs/basic/catalog.json`.

Re-verified at `99f4fd17`. `MessageProcessor` takes catalogs positionally rather than in
an options bag, and its `version` option defaults to `'v0.9'` — section 6 was corrected
on both counts. The `a2ui_core` blueprint now specifies `PayloadValidator` as
single-catalog with `validateComponent` / `validateFunction` / `validateTheme`, and names
`processMessages` the single entry point, which matches what section 6 already described.
`AgentToRendererMessage.parseAll`, which that blueprint names as the envelope check, does
not exist in `web_core` yet. The v1.0 basic catalog subpath gained function bodies but
still exports no assembled `Catalog`, and `scripts/copy-spec.js` still copies the
specification JSON, so both notes in section 1 stand.

Conformance figures in section 7 come from parsing `conformance/agent/*.yaml` and
counting cases by `action` and by protocol version, which streaming cases carry on
`catalog.protocolVersion` rather than a top-level field. Line counts in
section 5 come from the Python packages under
`python/a2ui_agent/src/a2ui/inference_formats/`.

---

## 12. Status of this document

This is a design document, not a compliance record. Once the SDK implements identifiable
module features, it should be replaced by a `codebase.blueprint.md` tracking
`implemented_features` by commit hash, as described in
`docs/proposals/spec_driven_development.md`.
