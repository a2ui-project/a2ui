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

---

## 1. Dependency on `@a2ui/web_core`

The SDK reuses `@a2ui/web_core` rather than redefining catalog or schema types. The
module blueprint refers to this dependency as `a2ui_core`; in TypeScript, that role is
currently played by `web_core`.

| Subpath | What we use |
| --- | --- |
| `@a2ui/web_core/catalog` | `Catalog`, `CatalogInterface`, `ComponentApi`, `FunctionApi`, `loadCatalogFromSchema` |
| `@a2ui/web_core/v1_0` | `AgentToRendererMessage`, `AgentToRendererMessageSchema`, `V10RendererCapabilities` |
| `@a2ui/web_core/v1_0/basic_catalog` | `BASIC_COMPONENTS`, `BASIC_FUNCTION_APIS` |
| `@a2ui/web_core/validating` | `validateRecursionAndPaths`, `STRICT_VALIDATION`, `getComponentReferences`, `buildComponentRefMap`, `V10_CHILD_REF_OPTIONS` |
| `@a2ui/web_core/processing` | `MessageProcessor` (see section 6) |

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

### Known gap: the basic catalog JSON is not exported

`web_core` copies `specification/v1_0/catalogs/basic/catalog.json` into its build output
at `dist/src/v1_0/schemas/catalogs/basic/catalog.json`, but its `package.json` `exports`
map has no entry that reaches it. Only `./data/*` is mapped, and that points at `v0_8`.

This matters because the catalog JSON is the only place the basic catalog's
`instructions` string lives, and those instructions materially affect prompt quality.
The `BASIC_COMPONENTS` / `BASIC_FUNCTION_APIS` exports carry component and function
signatures but not the instructions.

Options, in order of preference:

1. Add a `./v1_0/schemas/*` entry to the `web_core` exports map, then have the bundled
   provider load `catalog.json` through `loadCatalogFromSchema`. This matches what
   Python already does — its `BundledCatalogProvider` reads the catalog JSON rather
   than assembling one from component constants.
2. Construct the catalog from `BASIC_COMPONENTS` and `BASIC_FUNCTION_APIS`, accepting
   that `instructions` is absent or duplicated.

Option 1 is the recommendation, and the catalog layer depends on it. It also survives
the `a2ui_core` split cleanly: the basic catalog JSON is framework-agnostic, so the same
export entry moves to the new package with the rest of the catalog code.

---

## 2. Package structure

The blueprint standardizes the layout across languages. This mirrors it, with `.ts`
modules where the blueprint names Python modules.

```
typescript/a2ui_agent/
├── src/
│   ├── processor/               # High-level application facade
│   │   ├── catalog_config.ts    # CatalogConfig
│   │   ├── processor.ts         # A2uiRequestProcessor
│   │   ├── generator.ts         # A2uiGenerator
│   │   └── catalog_providers.ts # CatalogProvider implementations
│   ├── inference_format.ts      # InferenceFormat & InferenceFormatFactory
│   ├── inference_formats/
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
│   │   └── errors.ts            # ParseError and friends
│   ├── prompt/
│   │   └── generator.ts         # Abstract PromptGenerator
│   ├── catalog_transformers/
│   │   ├── base.ts              # CatalogTransformer
│   │   └── pruning.ts           # Component/Function pruning
│   ├── utils/
│   │   └── catalog_resolver.ts  # resolveCatalogs
│   └── index.ts
└── tests/
    └── conformance/             # YAML harness over conformance/agent/
```

---

## 3. Base contracts

Method names are camelCase, which is the only systematic departure from the blueprint's
Python spelling.

### Response parts

These follow the blueprint's structured model rather than the flat `ResponsePart` shape
currently in the Python SDK. Python is being brought into line with the blueprint, so
modelling the target structure here avoids writing code we would immediately have to
unwind.

```typescript
/** Conversational text extracted from an LLM response. */
export interface TextPart {
  /** Text content intended for user display. */
  text: string;
}

/** An uncompiled A2UI format block extracted from an LLM response. */
export interface RawA2uiPart {
  /** Raw, uncompiled format content, such as an Express DSL expression. */
  a2uiRaw: string;
}

/** An uncompiled token from an LLM response stream. */
export interface RawResponsePart {
  /** Either conversational text or an uncompiled A2UI block. */
  part: TextPart | RawA2uiPart;
  /** False when the block was truncated mid-stream rather than closed. */
  isFinal: boolean;
}

/** Compiled A2UI payload messages ready to deliver to a renderer. */
export interface A2uiPart {
  /** Validated messages to send to the client renderer. */
  a2ui: AgentToRendererMessage[];
}

/** A parsed segment of an LLM response: either text or compiled payload. */
export type ResponsePart = TextPart | A2uiPart;
```

### Catalog transformers

```typescript
/**
 * A rule applied to a catalog before it is used for prompting or validation.
 *
 * Transformers exist mainly to shrink the schema that reaches the model: dropping
 * components or functions an agent will never emit cuts prompt tokens and reduces the
 * chance of the model reaching for something the renderer cannot draw. Implementations
 * must be pure and must return a new catalog rather than mutating the input.
 */
export interface CatalogTransformer {
  transform(catalog: SchemaCatalog): SchemaCatalog;
}

/** Prunes catalog components down to an allowlist. */
export class ComponentPruningTransformer implements CatalogTransformer {
  constructor(allowedComponents: string[]);
  transform(catalog: SchemaCatalog): SchemaCatalog;
}

/** Prunes catalog functions down to an allowlist. */
export class FunctionPruningTransformer implements CatalogTransformer {
  constructor(allowedFunctions: string[]);
  transform(catalog: SchemaCatalog): SchemaCatalog;
}
```

### Prompt generator

```typescript
/**
 * Builds the format-specific portion of the system prompt.
 *
 * A generator renders catalog schemas and output-format instructions. It deliberately
 * does not render role, persona, or workflow preamble; the calling agent owns those and
 * prepends them.
 */
export abstract class PromptGenerator {
  constructor(
    protected readonly catalogs: SchemaCatalog[],
    /** Example turns keyed by a description of what the turn demonstrates. */
    protected readonly examples?: Record<string, AgentToRendererMessage[]>,
  ) {}

  /** Renders the instruction snippet for this format and catalog set. */
  abstract generate(): string;
}
```

### Parser

```typescript
/**
 * Turns raw model output into ResponseParts for a single inference format.
 *
 * A parser instance is stateful when streaming, since it buffers across chunks. Create
 * a fresh parser per response rather than sharing one.
 */
export abstract class Parser {
  /**
   * Reports whether the content contains at least one complete format block.
   *
   * Not in the module blueprint, but the conformance suite exercises it via the
   * `has_parts` action, and Python provides the equivalent as `has_format_content`.
   * An unterminated opening tag counts as false.
   */
  abstract hasA2uiParts(content: string): boolean;

  /** Serializes parts back to a string, re-adding sentinel tags around A2UI blocks. */
  abstract wrap(blocks: RawResponsePart[]): string;

  /**
   * Tokenizes a response into ordered raw parts, preserving the original interleaving
   * of conversational text and tagged payload blocks. Does not compile.
   */
  abstract unwrap(content: string): RawResponsePart[];

  /** Compiles one raw format string into A2UI messages. */
  abstract compile(formatContent: string): AgentToRendererMessage[];

  /** Renders A2UI messages back into this format's raw notation. */
  abstract decompile(payload: AgentToRendererMessage[]): string;

  /**
   * Parses a complete, non-streamed response.
   * @param wrapped False when the content is a bare payload with no sentinel tags.
   */
  parseResponse(content: string, wrapped = true): ResponsePart[] {
    /* unwrap, then compile each raw A2UI part */
  }

  /**
   * Consumes one streaming chunk and returns the parts that became complete.
   * Returns an empty array when the chunk only advanced an unfinished block.
   * @param wrapped False when the stream is a bare payload with no sentinel tags.
   */
  abstract parseChunk(chunk: string, wrapped?: boolean): ResponsePart[];

  /**
   * Async-iterable wrapper over parseChunk, for `for await` over a model stream.
   *
   * TypeScript-specific addition. Every AI SDK we intend to document exposes its
   * response stream as an async iterable, so this is the shape callers reach for.
   * It adds no behavior of its own; parseChunk stays the primitive, and the
   * conformance harness drives that rather than this.
   */
  async *parseStream(
    chunks: AsyncIterable<string>,
    wrapped = true,
  ): AsyncGenerator<ResponsePart> {
    /* delegates to parseChunk, flushes any trailing buffer at completion */
  }
}
```

### Inference format facade

```typescript
/** Pairs a prompt generator with a matching parser for one output format. */
export interface InferenceFormat {
  readonly promptGenerator: PromptGenerator;
  /** Returns a fresh parser. Never reuse one across responses. */
  createParser(): Parser;
}

/** Constructs an InferenceFormat once the active catalogs are known. */
export interface InferenceFormatFactory {
  createFormat(
    catalogs: SchemaCatalog[],
    examples?: Record<string, AgentToRendererMessage[]>,
  ): InferenceFormat;
}
```

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

/**
 * Loads the bundled v1.0 basic catalog with no configuration.
 *
 * Not in the module blueprint as a provider, but Python ships the equivalent as
 * `BundledCatalogProvider` behind a `BasicCatalog` helper. Included so that using the
 * standard catalog is a one-liner. Depends on the export gap in section 1.
 */
export class BasicCatalogProvider implements CatalogProvider {
  constructor(version?: string);
  load(): Promise<SchemaCatalog>;
}
```

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
  /** Format-specific system prompt snippet to feed the model. */
  get promptSnippet(): string;

  /** Parses and validates a model response. */
  parseResponse(content: string): ResponsePart[];
}
```

> [!NOTE]
> The blueprint defaults `A2uiGenerator`'s factory to `DirectJsonFormatFactory`. Since
> this SDK ships Express only (section 5), the default here is `ExpressFormatFactory`.

---

## 5. Inference format: Express only

This SDK implements the Express DSL and does not implement Direct JSON. That is a team
decision, taken with the tradeoffs below understood.

### What Express costs

Express is not the smaller of the two formats. Measured against the Python reference:

| | Express | Direct JSON (v1.0-relevant) |
| --- | --- | --- |
| Total | ~2,790 lines | ~1,770 lines |
| Streaming | 113-line parser over the shared lexer | 1,143-line incremental JSON healer |
| Grammar | ANTLR, generated from `Express.g4` | none |

So the headline count favors Direct JSON, but the shape of the work differs. Direct
JSON's bulk sits in incremental JSON repair, which is intricate hand-written logic and
is exactly where its 76 streaming conformance cases concentrate. Express's bulk sits in
a compiler generated from a declarative grammar, and its streaming story is close to
free because the DSL tokenizes cleanly at expression boundaries.

On that reading, Express-only is a defensible simplification even though it is more
code.

### The ANTLR dependency

Python generates its Express lexer and parser with ANTLR from
`specification/inference_formats/express/Express.g4`, and depends on
`antlr4-python3-runtime`. The grammar is target-agnostic, so TypeScript can generate
from the same file and stay in lockstep with Python.

That means adding an ANTLR TypeScript runtime and a codegen step to this package.
Generated sources land in `inference_formats/express/generated/` and should be checked
in, so that a plain `yarn build` needs no Java toolchain. Regeneration becomes a
separate script, run when the grammar changes.

Sharing one grammar across languages is a real advantage: divergence between the Python
and TypeScript Express dialects becomes a grammar change rather than a silent drift.
The choice of runtime package is listed as open in section 10.

### Express package contents

Following the blueprint's Express layout: `ExpressFormat` and `ExpressFormatFactory`;
`ExpressPromptGenerator` rendering compact positional signatures for catalog components
and functions; `ExpressCompiler` lexing and parsing `<a2ui-express>` expressions into
`AgentToRendererMessage` lists; `ExpressDecompiler` for the reverse; and `ExpressParser`
delegating to both and handling streaming chunks.

### Consequence for conformance

The agent conformance suite is written entirely against Direct JSON, so an Express-only
SDK cannot run most of it. Section 7 covers what remains reachable.

---

## 6. Validation

The blueprint points at `a2ui.core.validating.A2uiValidator`. No such class exists — see
section 10. TypeScript `web_core` has no validator class at all, so the SDK assembles
one from the primitives that do exist and exposes it as `PayloadValidator`, matching the
name Python actually uses:

- **Envelope shape**: `AgentToRendererMessageSchema.parse()`.
- **Component props**: each `ComponentApi` carries a Zod `schema`, so
  `catalog.components.get(name)?.schema.parse(props)`.
- **Structure**: `validateRecursionAndPaths()` for depth and JSON-pointer sanity, plus
  `getComponentReferences()` and `buildComponentRefMap()` with `V10_CHILD_REF_OPTIONS`
  for reachability and cycles. `STRICT_VALIDATION` is the config preset.

### Surface state during validation

A validator sees one outbound payload at a time. When a payload updates a surface it did
not itself create, it carries no component tree, so a reference to a component the agent
sent in an earlier payload cannot be checked and is accepted by default. Cycles spanning
two payloads go unnoticed for the same reason.

An agent that runs `MessageProcessor` from `@a2ui/web_core/processing` over its own
outbound messages holds that tree. References then resolve against what the surface
already has, and cycles are found across the whole surface rather than one payload at a
time. The renderer runs equivalent checks on arrival, so doing this first catches a bad
payload before it is sent instead of after.

`A2uiRequestProcessor` therefore maintains a `MessageProcessor` over the messages it has
emitted, and validates against that accumulated surface state. This costs memory
proportional to surface size and makes the processor stateful across a session, which is
worth being deliberate about.

---

## 7. Conformance testing

The project keeps a language-agnostic suite in `conformance/agent/`. Running it is part
of this SDK's work, and so is extending it.

### What the suite contains today

| Suite | Cases | Protocol versions | Format |
| --- | --- | --- | --- |
| `parser.yaml` | 19 | unversioned | `<a2ui-json>` |
| `streaming_parser.yaml` | 76 | 38 × v0.8, 38 × v0.9 | `<a2ui-json>` |
| `inference_format.yaml` | 20 | 1 × v1.0 | `<a2ui-json>` |

Every case targets Direct JSON. Express appears nowhere; the three apparent matches are
the phrase "express or implied" in license headers. And `streaming_parser.yaml`, the
largest suite, has no v1.0 cases at all.

### What is actually reachable

Counting by case is misleading, because reachability depends on the action rather than
the suite. Broken down:

| Action | Cases | Reachable for a v1.0 Express SDK? |
| --- | --- | --- |
| `select_catalog` | 8 | Yes — format-agnostic capability negotiation |
| `load_catalog` | 3 | Yes — format-agnostic catalog loading |
| `has_parts` | 3 | Structure reusable, inputs need Express variants |
| `parse_full` | 9 | Structure reusable, inputs need Express variants |
| `generate_prompt` | 8 | No — asserts Direct JSON prompt text |
| `fix_payload` | 7 | No — JSON repair has no Express analogue |
| `process_chunk` | 77 | No — v0.8/v0.9 Direct JSON payloads |

So **11 cases run directly today**: the `select_catalog` and `load_catalog` sets, which
exercise `resolveCatalogs` and the catalog providers and care nothing about output
format. A further 12 test logic we want, but feed `<a2ui-json>` inputs that an Express
parser will not recognize.

An earlier draft of this document claimed all 19 `parser.yaml` cases were reachable.
That was wrong: 7 of them are `fix_payload`, which tests JSON healing that Express does
not do, and the rest carry Direct JSON inputs.

### Scope

1. **Build the harness** in `tests/conformance/`, following
   `python/a2ui_agent/tests/conformance/test_conformance.py`, declaring both
   `SUPPORTED_PROTOCOL_VERSIONS` and `SKIP_TEST_NAMES`. The 11 directly runnable cases
   pass from the start; the rest are skipped and logged.
2. **Author Express cases** for `has_parts` and `parse_full`, mirroring the existing
   Direct JSON cases with `<a2ui-express>` inputs, plus Express-specific compile and
   decompile coverage. These are contributed upstream to `conformance/agent/`, not kept
   local, so that any later Express implementation inherits them.
3. **Author v1.0 streaming cases**, since `streaming_parser.yaml` currently stops at
   v0.9. This is the largest genuine gap in the suite.

Deriving Express cases carries a risk worth naming: a conformance suite written from a
single implementation encodes that implementation's bugs as the specification. Express
cases should be derived from `Express.g4` and cross-checked against the Python Express
implementation, not transcribed from our own output.

### Harness mapping to the structured part model

The YAML expectation format predates the blueprint's structured parts, and combines both
kinds of content in one entry:

```yaml
expect:
  - text: "Hello"
    a2ui: [{"id": "test"}]
  - text: "Goodbye"
```

Under `ResponsePart = TextPart | A2uiPart` a single part cannot hold both, so the harness
maps each YAML entry to one or two parts: a `TextPart` when `text` is non-empty, followed
by an `A2uiPart` when `a2ui` is present. An entry with `text: ""` and a payload yields
only the `A2uiPart`.

This mapping lives in the harness for now. If the Python migration to structured parts
also revises the YAML expectation format, this SDK should follow rather than keep its own
translation layer — see section 10.

---

## 8. Transport

The blueprint lists transport packaging as an Agent SDK responsibility, realized in
Python as `a2a/` and `adk/` subpackages with their own conformance suites under
`conformance/extensions/`.

This SDK deliberately excludes them for now. It stays transport-agnostic: it produces
`AgentToRendererMessage` objects and has no opinion about delivery. The reasoning is
that transport bindings are additive and can be layered on later without disturbing the
core, whereas shipping them now would double the surface before the core has proven
itself.

The sample application demonstrates one concrete transport instead.

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

### A. The module blueprint disagrees with every implementation

Conforming to the blueprint literally would be wrong in these cases, so this SDK has
picked a side. The blueprint should be corrected either way.

1. **`A2uiValidator` does not exist.** The blueprint specifies
   `a2ui.core.validating.A2uiValidator`. Python has
   `a2ui.core.validation.payload_validator.PayloadValidator` — different module,
   different class name. TypeScript `web_core` has no validator class at all.
   *This SDK uses `PayloadValidator`.* Low risk, but the blueprint misleads every new
   implementer who reads it.

2. **`CatalogConfig` holds a catalog, or a provider?** The blueprint says
   `CatalogConfig(catalog, transformers)` — an already-resolved catalog. Python's takes
   `name`, `provider`, and `examples_path`, holding an *unresolved* provider. That is a
   real lifecycle difference: whether loading happens at config construction or is
   deferred to negotiation.
   *This SDK follows the blueprint.* **Blocking** for the catalog layer, since reversing
   it later changes when I/O happens and whether construction is async.

3. **`parseChunk` or `processChunk`?** The blueprint says `parse_chunk(chunk, wrapped)`.
   Python implements `process_chunk(chunk)` — different name, and no `wrapped`
   parameter. The conformance suite labels the action `process_chunk`.
   *This SDK follows the blueprint (`parseChunk`, with `wrapped`).* Cosmetic, but it is
   the method every SDK's streaming path is named after, so it is worth converging.

4. **The blueprint's `Parser` is missing a content predicate.** Python has
   `has_format_content`, and the conformance suite tests it through the `has_parts`
   action, but the blueprint's `Parser` does not declare it. Any SDK written strictly
   from the blueprint will fail those cases.
   *This SDK adds `hasA2uiParts`.* The blueprint should gain the method.

5. **Response part structures.** Already being addressed by the Python migration, noted
   here only for completeness: the blueprint's structured model is the target, and this
   SDK models it directly rather than the flat shape Python currently ships.

### B. Decisions with repository-wide reach

6. **Which ANTLR TypeScript runtime?** Generating from the shared
   `specification/inference_formats/express/Express.g4` is decided: a single grammar
   compiled for both languages makes TypeScript/Python dialect divergence structurally
   impossible rather than merely unlikely, which is worth a codegen step. What remains
   open is which runtime package to use. Python uses `antlr4-python3-runtime`; the
   TypeScript ecosystem offers several options with meaningfully different maintenance
   stories, and the choice sets precedent for any future TS grammar work.
   **Blocking** for the Express compiler.

7. **Should Express graduate out of `proposals/`?** Its specification lives at
   `specification/proposals/express/a2ui_express.md` while its grammar sits at
   `specification/inference_formats/express/Express.g4`, and the Python implementation
   is under `inference_formats/experimental/`. This SDK now ships Express as its *only*
   format. Shipping a production SDK against a proposal-status spec is worth a
   deliberate decision rather than drift — either promote the spec, or record that the
   SDK is knowingly ahead of it.

8. **Should `BasicCatalogProvider` be in the blueprint?** Python ships the equivalent as
   `BundledCatalogProvider` behind a `BasicCatalog` helper, and this SDK wants it, so
   the blueprint's provider list looks incomplete.

### C. Dependencies on other work

9. **`web_core` export gap.** Adding a `./v1_0/schemas/*` entry so the bundled basic
   catalog JSON is reachable touches a shared package. Needs sign-off from whoever owns
   `web_core`, and should fold into the `a2ui_core` split planning rather than being
   done twice. **Blocking** for `BasicCatalogProvider`.

10. **Does the YAML expectation format change with structured parts?** Existing cases
    put `text` and `a2ui` in one entry, which the structured model splits into two
    parts. This SDK's harness translates (section 7), but if the Python migration also
    revises the YAML format, the translation should be dropped rather than duplicated
    in every SDK. Whoever lands the Python change should decide.

11. **`a2ui_core` package.** Section 1 assumes the framework-agnostic half of
    `web_core` eventually moves there. Timing affects when this SDK repoints its
    imports, but nothing here waits on it.

### Resolved

- **Which inference format.** Express only, by team decision. Tradeoffs in section 5.
- **Who owns v1.0 and Express conformance cases.** This SDK, per section 7.
- **Transport packaging.** Deliberately excluded, per section 8.

---

## 11. Verification log

Checked against the repository on 2026-09-11, at commit `6e3e9d3`.

Confirmed present and shaped as documented: `Catalog`, `loadCatalogFromSchema`,
`AgentToRendererMessage`, `V10RendererCapabilities`, `BASIC_COMPONENTS`,
`BASIC_FUNCTION_APIS`, `MessageProcessor`, and Node-safe subpath imports for every
`web_core` path in section 1.

Confirmed absent: any `A2uiValidator`, and any export path reaching the bundled v1.0
basic catalog JSON.

Conformance figures in section 7 come from counting cases in `conformance/agent/*.yaml`.
Line counts in section 5 come from the Python packages under
`python/a2ui_agent/src/a2ui/inference_formats/`.

---

## 12. Status of this document

This is a design document, not a compliance record. Once the SDK implements identifiable
module features, it should be replaced by a `codebase.blueprint.md` tracking
`implemented_features` by commit hash, as described in
`docs/proposals/spec_driven_development.md`.
