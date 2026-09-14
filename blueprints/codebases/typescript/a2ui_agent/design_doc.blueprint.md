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

| Subpath | What we use |
| --- | --- |
| `@a2ui/web_core/catalog` | `Catalog`, `CatalogInterface`, `ComponentApi`, `FunctionApi`, `loadCatalogFromSchema` |
| `@a2ui/web_core/v1_0` | `AgentToRendererMessage`, `AgentToRendererMessageSchema`, `RendererToAgentMessage`, `V10RendererCapabilities` |
| `@a2ui/web_core/v1_0/basic_catalog` | `BASIC_COMPONENTS`, `BASIC_FUNCTION_APIS` |
| `@a2ui/web_core/validating` | `validateRecursionAndPaths`, `STRICT_VALIDATION`, `getComponentReferences`, `buildComponentRefMap`, `V10_CHILD_REF_OPTIONS` |
| `@a2ui/web_core/processing` | `MessageProcessor` (see section 6) |
| `@a2ui/web_core/errors` | `A2uiError`, `A2uiValidationError`, `A2uiIntegrityError`, `A2uiRecursionError`, `A2uiStateError`, `A2uiDataError`, `A2uiExpressionError` |

`RendererToAgentMessage` types the inbound direction — user events and callbacks coming
back from a renderer. This SDK does not process those; it types them so an agent can
accept them without redeclaring the shape.

### Core contracts landing in `web_core`

The v1.0 core work defines contracts that each language SDK should find in its core
package. Four of them are not in `web_core` as of this writing but are being added.
**This design assumes they exist**, and targets their agreed cross-language names rather
than working around their absence.

`v1_0_implementation_plan.md`, at the repository root, is the authority on what lands
and under what name. It settles the validator: `A2uiValidator`, in a `validation/`
module, in both Python and TypeScript. Python's current
`a2ui.core.validation.payload_validator.PayloadValidator` is the pre-rename name.

| Contract | State when last checked | This SDK's assumption |
| --- | --- | --- |
| `A2uiValidator` | No validator class in `web_core` | Used directly for payload validation, per section 6. Name confirmed by the v1.0 plan |
| `A2uiRendererCapabilities` | Exists as `V10RendererCapabilities` | Uses the cross-language name once available |
| `A2uiCatalogError` | Not defined | Imported from core rather than declared locally |
| `BasicCatalog` | Only `BASIC_COMPONENTS` / `BASIC_FUNCTION_APIS` | Backs `BundledCatalogProvider`, per section 4 |

The same plan renames two `web_core` directories this SDK imports from: `validating/`
becomes `validation/`, and `errors.ts` becomes `exceptions/`. The subpaths in the table
above are the ones that resolve today, and will need revisiting when that lands.

Two consequences. First, if any of these land under a different name, the changes here
are import-level rather than structural. Second, `BasicCatalog` may make the export gap
below moot: if core exposes a ready-built basic catalog, this SDK never needs to reach
for the bundled JSON itself.

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

`blueprints/features/skill_generator.blueprint.md` requires every language SDK to split
prompt generation into three independently callable pieces, with `generate` as a template
method over them. The split exists so that a skill generator can emit the base rules on
their own as a standalone core skill, and each catalog's instructions as its own catalog
skill, without duplicating any prompt-building logic.

```typescript
/** Options for assembling a complete system prompt. */
export interface PromptOptions {
  roleDescription?: string;
  workflowDescription?: string;
  uiDescription?: string;
  includeSchema?: boolean;   // defaults to true
  includeExamples?: boolean; // defaults to false
  validateExamples?: boolean; // defaults to false
}

/**
 * Builds the system prompt for one inference format and catalog set.
 */
export abstract class PromptGenerator {
  constructor(
    protected readonly catalogs: SchemaCatalog[],
    /** Example turns keyed by a description of what the turn demonstrates. */
    protected readonly examples?: Record<string, AgentToRendererMessage[]>,
  ) {}

  /**
   * Base syntax contracts, grammar, and sentinel tags for this format.
   *
   * Must be catalog-agnostic: a skill generator emits this verbatim as a standalone
   * core skill, with no catalog bound.
   */
  abstract generateBaseRules(): string;

  /** Component and function signatures for one catalog, or for all bound catalogs. */
  abstract generateCatalogInstructions(
    includeSchema?: boolean,
    catalog?: SchemaCatalog,
  ): string;

  /** Few-shot examples for one catalog, or for all bound catalogs. */
  abstract generateExamples(catalog?: SchemaCatalog, validate?: boolean): string;

  /**
   * Assembles a complete system prompt from the three pieces above.
   *
   * Concrete formats override the pieces, not the assembly: the order is fixed by the
   * feature blueprint so prompts stay comparable across languages. Sections are joined
   * with blank lines, and empty ones are dropped — role, then base rules and workflow
   * under `## Workflow Description:`, then `## UI Description:`, then catalog
   * instructions, then `### Examples:`.
   */
  generate(options?: PromptOptions): string;
}
```

> One deviation. The feature blueprint gives `generate` six positional parameters with
> defaults. Six positional booleans and strings read poorly in TypeScript and are easy to
> transpose at a call site, so this SDK takes a single options object. The field names are
> the blueprint's parameter names in camelCase, which is also how the conformance YAML
> already spells them, so the mapping is mechanical.

Multi-catalog behavior is mandated rather than chosen: when several catalogs are bound, a
generator compiles instructions for *every* one of them. It never picks a default.

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
 * Not in the module blueprint's provider list, but Python ships this as
 * `BundledCatalogProvider`. The name is kept identical here for cross-language parity.
 * Depends on the export gap in section 1.
 */
export class BundledCatalogProvider implements CatalogProvider {
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

| | Direct JSON (v1.0-relevant) | Express |
| --- | --- | --- |
| Total | ~1,770 lines | ~2,790 lines |
| Streaming | 1,143-line incremental JSON healer | 113-line parser over the shared lexer |
| Grammar | none | ANTLR, generated from `Express.g4` |

Direct JSON is less code overall, but its bulk is intricate hand-written JSON repair —
healing truncated payloads mid-stream — which is where its 76 streaming conformance
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

Validation uses `A2uiValidator` from core, as the blueprint specifies. It covers protocol version branching, deep structural checks (component
uniqueness, root reachability, cycle prevention, recursion depth caps), and JSON Pointer
syntax for data bindings. This SDK adds no validator wrapper of its own.

`A2uiValidator` is one of the contracts still landing in `web_core` (section 1). If it
arrives under a different name, only the import changes. If it does not arrive, the
equivalent can be assembled from primitives that already exist —
`AgentToRendererMessageSchema.parse()` for envelope shape, each `ComponentApi`'s Zod
`schema` for component props, and `validateRecursionAndPaths()` plus
`getComponentReferences()` and `buildComponentRefMap()` with `V10_CHILD_REF_OPTIONS` for
structure — but that is a fallback, not the plan.

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
| `skill.yaml` | 4 | v1.0 basic catalog | `<a2ui-express>` |

Direct JSON carries 115 of the 119 cases. The four in `skill.yaml` are the only Express
coverage anywhere in the repository, and they test skill generation rather than parsing.
`streaming_parser.yaml`, the largest suite, still has no v1.0 cases at all.

### What is actually reachable

Counting by suite is misleading, because reachability depends on the action and the
protocol version, not the file. With Direct JSON implemented and the SDK targeting v1.0
only:

| Action | Cases | Reachable? |
| --- | --- | --- |
| `select_catalog` | 8 | Yes — format- and version-agnostic |
| `load_catalog` | 3 | Yes — format- and version-agnostic |
| `has_parts` | 3 | Yes — unversioned, Direct JSON tags |
| `parse_full` | 9 | Yes — unversioned, Direct JSON tags |
| `fix_payload` | 7 | Yes — unversioned JSON repair |
| `process_chunk` (v1.0) | 1 | Yes |
| `process_chunk` (v0.8/v0.9) | 76 | No — protocol versions this SDK does not target |
| `generate_prompt` | 8 | No — see below |
| `from_format`, `core_syntax`, `from_catalog`, `skill_set` | 4 | Not yet — need Express and a skill generator |

**31 of 119 cases run**, rising to 35 once Express and skill generation land. Everything
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
take on now is the half of the contract that is *not* additive: section 3's decomposed
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

### A. The module blueprint and the Python SDK disagree

Python's agent SDK has not finished its v1.0 migration: the facades, providers, and
directory layout the blueprint describes are Stage 4 of `v1_0_implementation_plan.md`,
and none of it has landed. Comparisons below are against Python as it stands today, so
the migration may settle some of them on its own.

1. **`CatalogConfig` holds a catalog, or a provider?** The blueprint contradicts itself.
   Its summary calls `CatalogConfig` a dataclass encapsulating catalog *providers* and
   examples; its type definition declares an already-resolved `catalog` plus
   `transformers`. Python matches the summary, taking `name`, `provider`, and
   `examples_path`. The difference is a real one: whether catalog loading happens when
   the config is constructed, or is deferred to negotiation.
   *This SDK follows the type definition.* **Blocking** for the catalog layer, since
   reversing it later changes when I/O happens and whether construction is async.

2. **`parseChunk` or `processChunk`?** The blueprint says `parse_chunk(chunk, wrapped)`.
   Python implements `process_chunk(chunk)` — different name, and no `wrapped`
   parameter. The conformance suite labels the action `process_chunk`.
   *This SDK follows the blueprint (`parseChunk`, with `wrapped`).* Cosmetic, but it is
   the method every SDK's streaming path is named after, so it is worth converging.

3. **The blueprint's `Parser` is missing a content predicate.** Python has
   `has_format_content`, and the conformance suite tests it through the `has_parts`
   action, but the blueprint's `Parser` does not declare it. Any SDK written strictly
   from the blueprint will fail those cases.
   *This SDK adds `hasA2uiParts`.* The blueprint should gain the method.

### B. Decisions with repository-wide reach

4. **Which ANTLR TypeScript runtime?** Generating from the shared
   `specification/inference_formats/express/Express.g4` is decided: a single grammar
   compiled for both languages makes TypeScript/Python dialect divergence structurally
   impossible rather than merely unlikely, which is worth a codegen step. What remains
   open is which runtime package to use. Python uses `antlr4-python3-runtime`; the
   TypeScript ecosystem offers several options with meaningfully different maintenance
   stories, and the choice sets precedent for any future TS grammar work.
   **Blocking** for the Express compiler.

5. **Should Express graduate out of `proposals/`?** Its specification lives at
   `specification/proposals/express/a2ui_express.md` while its grammar sits at
   `specification/inference_formats/express/Express.g4`, and the Python implementation
   is under `inference_formats/experimental/`. Less urgent now that Direct JSON carries
   the SDK, but still worth settling before Express ships to users: either promote the
   spec, or record that implementations are knowingly ahead of it.

6. **Should `BundledCatalogProvider` be in the blueprint?** Python ships it, this SDK
   wants it, and `v1_0_implementation_plan.md` schedules v1.0 work on it, so the
   blueprint's provider list looks incomplete.

### C. Dependencies on other work

7. **Core contracts landing in `web_core`.** This design assumes `A2uiValidator`,
   `A2uiRendererCapabilities`, `A2uiCatalogError`, and `BasicCatalog`, none of which
   exist yet (section 1). Only `A2uiValidator` has a confirmed name; the other three
   need one before the imports can be written once and left alone. **Blocking** for
   validation and the bundled provider.

8. **`web_core` export gap.** If `BasicCatalog` lands in core, this may resolve itself —
   a ready-built catalog means this SDK never reaches for the bundled JSON. If it does
   not, a `./v1_0/schemas/*` export entry is still needed, and that touches a shared
   package.

9. **Does the YAML expectation format change with structured parts?** Existing cases put
   `text` and `a2ui` in one entry, which the structured model splits into two parts.
   This SDK's harness translates (section 7), but if the Python migration also revises
   the YAML format, the translation should be dropped rather than duplicated in every
   SDK. Whoever lands the Python change should decide.

10. **`a2ui_core` package.** Section 1 assumes the framework-agnostic half of `web_core`
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
  runtime package remains open (question 4).
- **The validator's name.** `A2uiValidator`, per section 1.

---

## 11. Verification log

Checked against the repository on 2026-09-11 at commit `6e3e9d3`, and re-checked on
2026-09-14 at `2297b4ac`, the tip of the `v1_0` branch.

Confirmed present and shaped as documented: `Catalog`, `loadCatalogFromSchema`,
`AgentToRendererMessage`, `RendererToAgentMessage`, `V10RendererCapabilities`,
`BASIC_COMPONENTS`, `BASIC_FUNCTION_APIS`, `MessageProcessor`, the `A2uiError` hierarchy
in `@a2ui/web_core/errors`, and Node-safe subpath imports for every `web_core` path in
section 1.

Confirmed absent as of the re-check, and assumed to be landing: `A2uiValidator`,
`A2uiCatalogError`, `BasicCatalog`, and the `A2uiRendererCapabilities` alias. Also still
absent: any export path reaching the bundled v1.0 basic catalog JSON.

Section 10 was reconciled against `v1_0_implementation_plan.md` on 2026-09-14. The
Python agent SDK is at the end of that plan's Stage 3: `A2uiGenerator`,
`A2uiRequestProcessor`, and the `processor/`, `catalog_transformers/`, and `utils/`
packages the blueprint describes do not exist yet.

Section 3's `PromptGenerator` follows
`blueprints/features/skill_generator.blueprint.md`, added on the same branch and bound to
the `a2ui_agent` module. Its four conformance cases in `conformance/agent/skill.yaml` all
generate Express skills against `specification/v1_0/catalogs/basic/catalog.json`.

Conformance figures in section 7 come from parsing `conformance/agent/*.yaml` and
counting cases by `action` and by the `version` in each case's arguments. Line counts in
section 5 come from the Python packages under
`python/a2ui_agent/src/a2ui/inference_formats/`.

---

## 12. Status of this document

This is a design document, not a compliance record. Once the SDK implements identifiable
module features, it should be replaced by a `codebase.blueprint.md` tracking
`implemented_features` by commit hash, as described in
`docs/proposals/spec_driven_development.md`.
