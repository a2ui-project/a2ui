# A2UI Agent implementation

The `python/a2ui_agent/src/a2ui` directory contains the Python implementation of
the A2UI agent SDK.

## Core Components

The following directories contain the base protocol logic, parsing, and schema operations directly under `src/a2ui/`:

### Processor & Catalog Configuration (`src/a2ui/processor`)

- **`generator.py`**: Defines `A2uiGenerator`, the main entry point for configuring an agent's catalogs and default inference format factory.
- **`processor.py`**: Defines `A2uiRequestProcessor`, which binds the active catalogs negotiated for a request to an inference format and exposes prompt generation and response parsing.
- **`catalog_config.py`**: Defines `CatalogConfig`, which binds a `Catalog` (or loads one from a path via `CatalogConfig.from_path`) with an optional sequence of `CatalogTransformer` instances into `transformed_catalog`.
- **`catalog_providers.py`**: Defines `CatalogProvider`, `FileSystemCatalogProvider`, and `InMemoryCatalogProvider` for loading catalogs.

### Schema & Examples (`src/a2ui/schema`)

- **`catalog.py`**: Defines `load_examples`, which reads few-shot examples from disk and can validate them against the active catalogs.

### Catalog transformers (`src/a2ui/catalog_transformers`)

- **`pruning.py`**: `ComponentPruningTransformer` and
  `FunctionPruningTransformer` return a copy of a catalog that keeps only the
  allowed components or functions. Pass them to `CatalogConfig` as
  `transformers`.

### Utilities (`src/a2ui/utils`)

- **`catalog_resolver.py`**: `resolve_catalogs` returns the catalogs that are
  active for the capabilities that a renderer sent.
- **`schema_pruning.py`**: `prune_messages_schema` and
  `prune_common_types_schema` reduce the protocol schemas to the allowed
  messages and the common types that are referenced.
- **`validation.py`**: `validate_payload` checks a payload the way a renderer
  holding the catalogs would, and raises `A2uiValidationError` if the
  renderer would reject it.

### Parser (`src/a2ui/parser`)

- **`parser.py`**: Defines the `Parser` (`A2uiStreamParser`) abstract base class and `parse_response` / `split_response` helpers.
- **`response_part.py`**: Defines `ResponsePart` (`TextPart` / `A2uiPart`) and `RawResponsePart` (`RawA2uiPart`).
- **`lexer.py`**: Defines `BlockLexer` for sentinel-tag tokenization (`<a2ui-json>...</a2ui-json>`).
- **`errors.py`**: Defines `A2uiParseError` and `A2uiTargetNotFoundError`.
- **`streaming.py`**: Incremental streaming parsers with automatic JSON healing and validation.
- **`payload_fixer.py`**: Utilities to automatically correct common LLM output
  issues in A2UI payloads.

### Prompt & Inference Formats (`src/a2ui/prompt`, `src/a2ui/inference_formats`)

- **`prompt/generator.py`**: Defines the `PromptGenerator` (`A2uiPromptGenerator`) abstract base class (`generate_base_rules`, `generate_catalog_instructions`, `generate_examples`, `generate`).
- **`inference_format.py`**: Defines `InferenceFormat` and `InferenceFormatFactory`.
- **`inference_formats/`**: Format implementations and factories for Direct JSON (`direct_json/`), Express (`express/`), and experimental Elemental and Atom (`experimental/`) formats.

## A2A (`src/a2ui/a2a`)

- **`extension.py`**: Utilities for managing the A2UI extension URI and activation logic.
- **`parts.py`**: Utilities for creating A2A Parts with A2UI data and helpers for response parsing.

## ADK Extensions (`src/a2ui/adk`)

Support for
the [Agent Development Kit (ADK)](https://github.com/google/adk-python) and A2A
protocol.

- **`send_a2ui_to_client_toolset.py`**: Implementation of
  `SendA2uiToClientToolset` to enable agents to send UI to clients via tool
  calls.

## Running tests

1. Navigate to the package directory:

   ```bash
   cd python/a2ui_agent
   ```

2. Run the tests

   ```bash
   uv run pytest
   ```

## Building the SDK

To build the SDK, run the following command from the `python/a2ui_agent`
directory:

```bash
uv build
```

The build doesn't need Java. The Express lexer, parser, and visitor in
`src/a2ui/inference_formats/experimental/express/generated/` are generated from
`specification/inference_formats/express/Express.g4` and committed to the
repository.

## Regenerating the Express parser

After changing `Express.g4`, regenerate the parser from the `python/a2ui_agent`
directory and commit the result:

```bash
uv run python scripts/generate_express_parser.py
```

The script runs ANTLR 4.13.2 through `antlr4-tools` from the dev dependency
group. ANTLR needs a Java runtime (JRE 11 or newer) on the `PATH`, and
`antlr4-tools` downloads the ANTLR jar on first use. Add `--check` to compare
the committed files with the grammar without changing them. CI runs this check.

## Formatting code

To format the code, run the following command from the `python`
directory:

```bash
uv run pyink .
```

## Releasing the SDK

See internal guidance at go/a2ui-release-pipy.

## Disclaimer

Important: The sample code provided is for demonstration purposes and
illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When
building production applications, it is critical to treat any agent operating
outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent—including its AgentCard,
messages, artifacts, and task statuses—should be handled as untrusted input. For
example, a malicious agent could provide crafted data in its fields (e.g., name,
skills.description) that, if used without sanitization to construct prompts for
a Large Language Model (LLM), could expose your application to prompt injection
attacks.

Similarly, any UI definition or data stream received must be treated as
untrusted. Malicious agents could attempt to spoof legitimate interfaces to
deceive users (phishing), inject malicious scripts via property values (XSS), or
generate excessive layout complexity to degrade client performance (DoS). If
your application supports optional embedded content (such as iframes or web
views), additional care must be taken to prevent exposure to malicious external
sites.

Developer Responsibility: Failure to properly validate data and strictly sandbox
rendered content can introduce severe vulnerabilities. Developers are
responsible for implementing appropriate security measures—such as input
sanitization, Content Security Policies (CSP), strict isolation for optional
embedded content, and secure credential handling—to protect their systems and
users.
