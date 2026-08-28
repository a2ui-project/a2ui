---
codebase_path: agent_sdks/python/a2ui_agent
associated_module: a2ui_agent
module_blueprint_commit: null
implemented_features: []
local_development:
  test_command: 'uv run pytest'
  lint_command: 'uv run pyink --check .'
  format_command: 'uv run pyink .'
---

# **Python Agent SDK Codebase Blueprint**

## **Architecture & Ecosystem Map**

The reference Python implementation of the A2UI Agent SDK (`a2ui_agent`).

- **Inference Formats & Prompt Engineering**: Decouples input prompt generation and output response parsing via format strategy facades (`InferenceFormat` / `InferenceFormatFactory`). Each strategy coordinates a format-specific `PromptGenerator` (which outputs instruction snippets and catalog schemas) and a `Parser` (which tokenizes, unwraps, and compiles responses).
- **Response Parsing**: Employs format-specific `Parser` engines to unwrap sentinel-tagged content, tokenize LLM responses into conversational text and raw payload blocks, and compile format expressions into standard A2UI payload messages.
- **Validation**: Structural layout and schema validation are delegated directly to core `a2ui.core.validating.A2uiValidator` to enforce contract compliance across all inference formats.
- **Framework Independence**: The SDK is completely agent-framework agnostic. It provides pure Python primitives and processor facades without hardcoded dependencies on specific agent frameworks like ADK or LangChain.

## **Local Technical Decisions & Overrides**

- **Multi-Catalog Capability Negotiation**: Implements `A2uiGenerator` and `A2uiRequestProcessor` to negotiate client capabilities (`A2uiRendererCapabilities`) against registered catalog configurations (`CatalogConfig`), caching processors by deterministic capability hash signature.
- **Standalone Catalog Transformers**: Uses `ComponentPruningTransformer` and `FunctionPruningTransformer` to decouple component and function allowlist filtering from raw schema parsing and representation.
- **Zero Validator Overhead**: Directly reuses `a2ui.core.validating.A2uiValidator` from `a2ui_core`, eliminating redundant validator facade wrappers in the agent layer.
- **Direct JSON Syntax Healing**: `DirectJsonFormat` includes JSON-specific repair utilities and `progressive_keys` to auto-heal fragmented JSON syntax, unquoted keys, and trailing commas.
- **Catalog Providers**: Provides `FileSystemCatalogProvider` for reading local catalog files and `InMemoryCatalogProvider` for in-memory dictionaries, with an extensible `CatalogProvider` base class for custom catalog loading strategies (e.g., remote REST API or cloud storage).

## **Validation & Execution Recipes**

- **Test execution**: Run unit/integration tests with `uv run pytest`.
- **Linting check**: Check style boundaries with `uv run pyink --check .`.
- **Formatting**: Format codebase via `uv run pyink .`.
