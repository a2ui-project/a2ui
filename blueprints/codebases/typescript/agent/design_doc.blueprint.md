---
associated_module: a2ui_agent
codebase_path: typescript/agent
---

# **TypeScript Agent SDK Codebase Blueprint**

## **Overview**
This codebase implements the `a2ui_agent` module blueprint for Node.js and TypeScript environments. The package is named `@a2ui/agent` and resides in `typescript/agent`. 

The SDK provides catalog management, capability negotiation, prompt engineering, parsing, and payload validation for AI agents generating A2UI components.

## **Core Dependencies**
This SDK heavily leverages the existing `@a2ui/web_core` package to prevent duplication and ensure strict cross-platform parity:
- **Catalogs**: Uses `Catalog` and `CatalogDefinition` types natively from `web_core`.
- **Validation**: Uses `A2uiValidator` from `web_core` to perform deep structural checks, duplicate ID prevention, and JSON pointer resolution prior to payload delivery.

## **Architecture & Technical Decisions**

### **1. Package Structure**
The directory layout mirrors the Python SDK while adopting TypeScript idioms:
```
typescript/agent/
├── src/
│   ├── processor/          # A2uiGenerator, A2uiRequestProcessor, CatalogConfig, Providers
│   ├── inference_formats/  # Inference formats (Express)
│   ├── parser/             # Common Parser contracts (AsyncIterable based)
│   ├── prompt/             # Prompt generators
│   ├── transformers/       # ComponentPruningTransformer, FunctionPruningTransformer
│   └── utils/              # Capability resolution
```

### **2. Base Interfaces & Contracts (TypeScript)**
The SDK defines abstract base classes and interfaces translating the core primitive layer to TypeScript:

```typescript
/**
 * Abstract base interface for transformation rules applied to catalog schemas
 * prior to prompt engineering and payload validation.
 */
export interface CatalogTransformer {
  transform(catalog: Catalog<any, any>): Catalog<any, any>;
}

/**
 * Abstract base class for constructing system prompt instruction snippets 
 * across inference formats.
 */
export abstract class PromptGenerator {
  constructor(
    protected catalogs: Catalog<any, any>[],
    protected examples?: Record<string, AgentToRendererMessage[]>
  ) {}
  
  /**
   * Renders format-specific system prompt instructions and catalog schemas.
   * The caller (Agent/Framework) prepends role/workflow preambles.
   */
  abstract generate(): string;
}

/**
 * Abstract base class for response parsers across all inference format strategies.
 * Responsible for tokenizing LLM output streams, unwrapping format tags, 
 * and compiling raw format expressions into standard A2UI payload messages.
 */
export abstract class Parser {
  /** Wraps response parts with sentinel tags. */
  abstract wrap(blocks: RawResponsePart[]): string;
  /** Extracts tagged sections from raw LLM output. */
  abstract unwrap(content: string): RawResponsePart[];
  /** Compiles a format string (e.g. DSL or JSON) into A2UI Messages. */
  abstract compile(formatContent: string): AgentToRendererMessage[];
  /** Converts A2UI messages back into the inference format string. */
  abstract decompile(a2uiPayload: AgentToRendererMessage[]): string;

  /** Generic non-streaming response parsing. */
  parseResponse(content: string, wrapped: boolean = true): ResponsePart[] {
    // Base implementation to unwrap and compile static content
  }

  /**
   * Processes streaming response chunks incrementally, yielding parsed parts 
   * as soon as they are complete.
   */
  abstract parseStream(
    chunkStream: AsyncIterable<string>, 
    wrapped?: boolean
  ): AsyncGenerator<ResponsePart[], void, unknown>;
}
```

### **3. Inference Formats: Express First**
For the initial implementation targeting the `v1.0` A2UI protocol, this SDK implements **only** the `ExpressFormat`. 
- **ExpressCompiler/Decompiler**: Translates `<a2ui-express>` DSL expressions to and from the standard `AgentToRendererMessage` arrays.
- **ExpressPromptGenerator**: Generates compact positional signatures to reduce token consumption for the LLM.

**Extensibility for Future Formats (e.g. Direct JSON)**:
The architecture utilizes the `InferenceFormat` facade interface, which decouples the format strategy from the core agent loop. To add `DirectJsonFormat` later, we simply implement:
1. A new `DirectJsonPromptGenerator` (implementing `PromptGenerator`).
2. A new `DirectJsonParser` (implementing the `Parser` interface).
3. The format factory to swap between them based on agent capability negotiation.

*(Note: `DirectJsonFormat` is deferred to a future iteration if needed, as Express provides a superior token-to-component ratio).*

### **4. Streaming via Async Iterables**
To align with modern Node.js and TypeScript standards, streaming parsing utilizes `AsyncGenerator` / `AsyncIterable` rather than classic Node streams. 
- The `Parser` interface exposes `parseStream(chunkStream: AsyncIterable<string>)` that yields `ResponsePart` objects asynchronously as they are compiled and validated.
- This allows for seamless integration with AI SDKs which natively expose response streams as async iterables. **Note on Documentation**: When creating user-facing documentation for the SDK, we will explicitly include examples demonstrating how to integrate this streaming loop with the Google Gen AI SDK (`@google/genai`), the ADK, the OpenAI SDK, and the Vercel AI SDK.

### **5. Catalog Providers**
We implement the `CatalogProvider` interface to ingest schema definitions:
- `FileSystemCatalogProvider`: Uses Node's `fs.promises.readFile` and `JSON.parse` to ingest custom schemas from disk.
- `InMemoryCatalogProvider`: Accepts raw JS/TS objects for dynamic or synthesized catalogs.
- **`BasicCatalogProvider`**: We will offer a dedicated provider that natively imports the compiled `BasicCatalog` directly from `@a2ui/web_core/v1_0/basic_catalog` so end-users can plug it in very easily without manual resolution.

## **Implementation Steps**

*Note: During all implementation steps, we must ensure we are creating and maintaining the `typescript/agent/codebase.blueprint.md` file, tracking module compliance exactly as outlined in the `docs/proposals/spec_driven_development.md` guidelines.*

1. **Initialize Workspace**: Setup `typescript/agent` with `package.json` utilizing `wireit`, `eslint`, and `prettier` per A2UI repository standards. Link `@a2ui/web_core` as a workspace dependency.
2. **Base Contracts**: Define `CatalogTransformer`, `Parser`, `PromptGenerator`, and the response part structures (`TextPart`, `A2uiPart`).
3. **Transformers**: Implement `ComponentPruningTransformer` and `FunctionPruningTransformer`. These transformers allow the agent to filter/prune down the catalog schema (e.g., dropping components or functions not needed for the current application) to save context tokens and simplify LLM prompts.
4. **Express Format**: Implement `ExpressCompiler` and `ExpressParser`. Build the tokenizer and AST parser for the `<a2ui-express>` DSL.
5. **High-Level Facade**: Implement `A2uiGenerator`, `A2uiRequestProcessor`, and the `resolveCatalogs` utility.
6. **Tests & Conformance**: Ensure comprehensive unit tests validating end-to-end flows. Crucially, the SDK must load and execute the language-agnostic Agent SDK conformance test suite (located in `conformance/agent/`) to guarantee behavioral parity with the Python and Kotlin Agent SDKs.
7. **Sample Application**: Port a comprehensive agent sample (such as the Python restaurant finder example) to a TypeScript/Node.js server. The SDK itself remains entirely transport-agnostic, meaning no specific server/HTTP facilities need to be baked into it. The demo will showcase integration using a standard HTTP framework (e.g., Express.js, Fastify, or Hono) or the JS ADK to demonstrate a real-world scenario with streaming enabled.
