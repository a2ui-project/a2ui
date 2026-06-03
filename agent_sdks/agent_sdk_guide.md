# Agent SDK Development Guide

This document describes the architecture of an A2UI Agent SDK. The design separates concerns into distinct layers to follow a similar structure for consistency across languages, providing a streamlined developer experience for building AI agents that generate rich UI.

The **Agent SDK** is responsible for **capability management, prompt engineering, and A2UI payload validation**. It enables the LLM to understand what UI it can build and ensures that what it produces is valid.

## 1. Unified Architecture Overview

The A2UI Agent SDK architecture has a well-defined data flow that bridges language-agnostic schema specifications with LLM inputs and outputs.

1.  **Define Capabilities**: The SDK loads component schemas (usually from bundled package resources) and organizes them into **Catalogs**.
2.  **Generate Prompts**: The SDK uses these catalogs to generate system instructions, automatically injecting the relevant JSON Schema and few-shot examples into the LLM's prompt.
3.  **Streaming Parsing**: Support parsing the LLM's output _as it streams_, yielding partial or complete UI messages progressively.
4.  **Validate Output**: When the LLM generates a response, the SDK parses it, extracts the A2UI JSON, and validates it against the schema.
5.  **Serialize & Send**: The validated JSON is wrapped in a standard transport envelope (e.g., Agent-to-Agent/A2A DataPart) and streamed to the client.

---

## 2. The Core Interfaces

At the heart of the A2UI Agent SDK are four key interfaces that manage schemas and validate output.

### `CatalogConfig`

Defines the metadata for a component catalog. It uses a **Provider** to load the schema and points to optional examples.

```python
class CatalogConfig:
    name: str
    provider: A2uiCatalogProvider
    examples_path: Optional[str] = None
```

### `A2uiCatalog`

Represents a processed catalog. It provides methods for validation and LLM instruction rendering.

```python
class A2uiCatalog:
    name: str
    validator: A2uiValidator

    def render_as_llm_instructions(self, options: InstructionOptions) -> str:
        """
        Generates a string representation of the catalog (schemas and examples)
        suitable for inclusion in an LLM system prompt.
        """
        ...
```

### `InferenceStrategy`

The abstract base interface for assembling system prompts for the LLM. It defines how to combine role descriptions, workflow descriptions, and UI descriptions into a single prompt.

```python
class InferenceStrategy(ABC):
    @abstractmethod
    def generate_system_prompt(
        self,
        role_description: str,
        workflow_description: str = "",
        ui_description: str = "",
        client_ui_capabilities: Optional[dict[str, Any]] = None,
        allowed_components: Optional[list[str]] = None,
        allowed_messages: Optional[list[str]] = None,
        include_schema: bool = False,
        include_examples: bool = False,
        validate_examples: bool = False,
    ) -> str:
        """
        Generates a system prompt for the LLM.
        """
        ...
```

#### Standard Implementations

- **`A2uiSchemaManager`**: Generates prompts by dynamically loading and organizing Component Schemas and examples from catalogs.
- **`A2uiTemplateManager`**: Generates prompts using predefined UI templates or static structures.

### `A2uiValidator` & `PayloadFixer`

The safety net of the SDK.

- **`PayloadFixer`**: Attempts to fix common LLM formatting errors (like trailing commas, missing quotes, or unterminated brackets) before structural parsing.
- **`A2uiValidator`**: Performs deep semantic and integrity validation beyond standard JSON Schema checks.

#### Standard Validator Checks:

1.  **JSON Schema Validation**: Verifies that the payload adheres to the A2UI JSON Schema.
2.  **Component Integrity**: Ensures all component IDs are unique and that a valid `root` component exists if required.
3.  **Topology & Reachability**: Detects circular references (including self-references) and orphaned components (all components must be reachable from the root).
4.  **Recursion Depth Limits**: Enforces limits on nesting depth (e.g., 50 levels) and specific limits for function calls (e.g., 5 levels) to prevent stack overflows on the client.
5.  **Path Syntax Validation**: Validates JSON Pointer syntax for data binding paths.

---

## 3. Schema Management & Loading

The SDK does not define component schemas programmatically in code. Instead, it **loads basic catalog JSON Schema definitions packed into the SDK resources** at runtime. Porting the SDK to a new language requires implementing a resource loader and a schema parser for that language's ecosystem (e.g., using `Pydantic` in Python or `kotlinx.serialization` in Kotlin).

Loading from the workspace's `specification/` directory is supported but should be treated as a **fallback for local development**.

### Implementation Principles

1.  **Freestanding Catalogs**: Catalogs should be freestanding. They should define their own types or reference relative paths within the same directory tree.
2.  **Version Awareness**: The schema manager must respect the A2UI protocol version (e.g., `v0.9`). If an agent requests `v0.8` schema, it should serve the `v0.8` definitions.
3.  **Resource Bundling**: Standard schemas should be bundled with the SDK artifact. Use language-standard utilities to read from package resources (e.g., Python's `importlib.resources`). Fall back to scanning the local `/specification` filesystem path _only_ if resource loading fails or if explicitly configured for development.

---

## 4. Prompt Engineering & Examples

The primary value of the Agent SDK is making it easy to create **dynamic, token-efficient system prompts**.

### `generateSystemPrompt` Requirements

When generating prompts, the SDK should allow developers to:

1.  **Prune Schemas**: If an agent only needs a subset of components (e.g., only `Text` and `Button`), the SDK should prune the schema to save tokens.
2.  **Inject Few-Shot Examples**: Few-shot examples are critical for LLM accuracy. The SDK should load these from example files (e.g., `examples/` directory in the catalog) and format them correctly using standard A2UI tags.
3.  **Standard Envelopes**: The prompt must instruct the LLM to wrap its A2UI output in standard tags to enable deterministic parsing.

**Standard Prompt Tags:**

```
CONVERSATIONAL TEXT RESPONSE
<a2ui-json>
[{
  "surfaceUpdate": { ... }
}]
</a2ui-json>
```

---

## 5. The Streaming Parser

The `A2uiStreamParser` uses **regex-based block parsing** to find and extract A2UI JSON payloads from the LLM's text output stream. It buffers incoming chunks and yields standard part representations when a complete block is detected.

### 1. High-Level Usage

The parser is designed to be fed chunks of text (e.g., from an LLM stream) and returns complete or partial `ResponsePart` objects.

```python
parser = A2uiStreamParser(catalog=my_catalog)

for chunk in llm_stream:
    parts = parser.process_chunk(chunk)
    for part in parts:
        if part.a2ui_json:
            # Send UI update to client
            send_to_client(part.a2ui_json)
        if part.text:
            # Stream conversational text to user
            stream_text(part.text)
```

### 2. Internal Mechanics

The parser buffers text and uses regex to extract content between tags.

#### Chunk Buffering

Incoming text chunks are appended to an internal buffer. The parser passes through conversational text until it detects the `<a2ui-json>` opening tag.

#### Regex Block Extraction

Once both the opening and closing tags are found in the buffer, the parser uses a regex pattern (e.g., `<a2ui-json>(.*?)</a2ui-json>` with `re.DOTALL`) to extract the raw JSON string.

- It yields any text preceding the tag as standard conversational text.
- It yields the JSON content as an A2UI JSON part.

#### Sanitization & Cleanup

Before parsing the JSON, it sanitizes the string to remove any unexpected markdown code block delimiters (e.g., ` ```json `) that the LLM might have inadvertently wrapped around the JSON inside the A2UI tags.

#### Multi-Block Support

The parser searches for all occurrences of the tags in the buffer and splits the content into alternating text parts and A2UI JSON parts, clearing processed blocks from the buffer.

---

## 6. Parsing, Fixing, & Validation

LLMs are prone to syntax errors or schema violations. The SDK must handle these gracefully.

### `parseResponse` Flow

1.  **Tag Detection**: Locate `<a2ui-json>` and `</a2ui-json>` tags in the raw text.
2.  **Extraction**: Extract the substring between the tags.
3.  **Pre-processing (Fixers)**: Run standard fixers (e.g., removing trailing commas, fixing unquoted keys, correcting simple JSON structural errors).
4.  **JSON Validation**: Validate the cleaned JSON string against the target catalog schema using a standard JSON Schema validator for your language.
5.  **Error Reporting**: If validation fails and cannot be fixed, the SDK should throw a structured error or fallback gracefully (e.g., yielding an error part to the client).

---

## 7. Transport & A2A Integration

Once validated, the A2UI payload must be transmitted over the network. In typical Agent-to-App (A2A) topologies, these are wrapped as **DataParts**.

### Standards for Transport

1.  **MIME Type**: Mark A2UI JSON payloads with `application/a2ui+json`. This tells the frontend renderer (e.g., the browser or mobile app) how to interpret the stream.
2.  **Standard Helpers**: Provide a `createA2uiPart` helper to automate this wrapping process.
3.  **Yielding Strategy**: Support both complete objects (when the LLM finishes speaking) and incremental streaming parser yielding (for partial JSON display).

---

## 8. The Basic Catalog Standard

The SDK should provide an out-of-the-box configuration for the **A2UI Basic Catalog** (Button, Text, Row, Column, etc.). This ensures that "Hello, World" agents can be built without defining custom schemas.

- In Python, this is provided by `BasicCatalog.get_config()`.
- Your language SDK should provide a similar singleton or preset that points to the standard basic catalog files in the `specification` folder.

---

## 9. Agent Framework Integration (Tooling)

While an SDK can be standalone, it is most useful when it integrates with popular agent frameworks (like Python's ADK). The SDK should provide standard adapters to connect A2UI capabilities with the framework's tool and event systems.

### 1. The Toolset & Tools

Provide a standard toolset (often called `SendA2uiToClientToolset`) that exposes tools to the LLM for sending rich UI.

- **Dynamic Providers**: The toolset should accept providers (callables or futures) to let the tool determine at runtime if A2UI is enabled, and which catalog/examples to use for the current session.
- **The UI Tool**: The actual tool exposed to the LLM (e.g., `send_a2ui_json_to_client`). It should validate the LLM's JSON arguments against the schema _before_ returning success to the framework.

### 2. Part Converters

A Part Converter translates the LLM's output (either tool calls or text tags) into standard transport Parts (like A2A DataParts).

- **Tool-to-Part**: When the LLM calls the UI tool, the converter intercepts the success response (which contains the validated JSON) and wraps it into an A2UI Part.
- **Text-to-Part**: When the LLM outputs text with standard delimiters (e.g., `<a2ui-json>`), the converter runs the text through the parser and emits A2UI Parts.

### 3. Event Converters

An Event Converter intercepts the agent framework's event stream and applies the Part Converter. This ensures that validation and extraction happen seamlessly in the background without modifying the core agent logic.

---

## 10. Contributor Implementation Guide

If you are tasked with porting the `agent_sdk` to a new language (e.g., C++ or Kotlin), follow this strict, phased sequence:

### Step 1: Core Foundation (Non-UI)

Implement `CatalogConfig` (and its `Provider`), `A2uiCatalog`, and an `InferenceStrategy` (like `A2uiSchemaManager`). Ensure you can load a JSON file via a provider and print its schema.

### Step 2: Prompt Generation

Implement `generateSystemPrompt`. Verify that it outputs valid Markdown with embedded JSON schemas and examples.

### Step 3: Parsing & Validation

Implement `parseResponse` and validation. Hook up a standard JSON Schema validator for your language. Use the centralized YAML conformance suite in `agent_sdks/conformance/` to verify that your implementation handles streaming and validation edge cases identically to the reference implementation.

### Step 4: Transport (A2A)

Create the helper utilities to wrap JSON in transport Parts (if needed for your ecosystem).

### Step 5: Sample Applications

Create a simple sample (like a command-line agent or local server) to verify that the SDK works end-to-end. Refer to the reference Python samples (e.g., `samples/agent/adk/restaurant_finder`) for inspiration.

> [!IMPORTANT]
> Keep the SDK idiomatic to your language. Don't force Python-isms if it doesn't make sense (e.g., use builder patterns in Java/Kotlin or macros in C++ if they are more ergonomic).

---

## 11. Cross-Language Feature Synchronization

The A2UI Agent SDK is a multi-language ecosystem. While features may be implemented in one language first (e.g., Python), we strive for consistency across all supported languages (Kotlin, C++, etc.). To maintain this consistency, we follow a strict synchronization process:

### Synchronization Process:

1.  **Lead Implementation**: A feature can be developed and merged in one language first (often Python as the reference).
2.  **File Sync Issues**: The author or reviewer of the feature **must file issues** for the equivalent feature requests in all other supported languages to ensure they are tracked.
3.  **Cross-Referencing**: Link these new issues back to the original Pull Request or issue for context and reference.
4.  **Consistency Over Clones**: While implementations should be idiomatic to the target language, they must follow the same architectural patterns (Inference Strategies, Validators, Streaming Parsers) and protocol standards defined in this guide.

---

## 12. Conformance Testing

To ensure behavioral parity across all SDK implementations (Python, Kotlin, etc.), the project maintains a language-agnostic conformance suite.

For detailed information on the suite structure and how to use it in your SDK implementation, see the [Conformance Testing README](conformance/README.md).
