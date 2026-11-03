---
codebase_path: python/a2ui_agent
associated_module: a2ui_agent
module_blueprint_commit: ccf5dc20d0b0ed041b03e3913d807420ff45e178
implemented_features:
  agent_functions: 0275eabbd2e8230dfa713cf8be086004ca554c30
  skill_generator: c177173ca12a9d4739e16e56d6eb87b1e0608d85
  typesafe_builder_api: ae0a5253b4e4d8aad06e1b97c236d426b8a401f0
local_development:
  test_command: 'uv run pytest'
  lint_command: 'uv run pyink --check .'
  format_command: 'uv run pyink .'
---

# **Python Agent SDK Codebase Blueprint**

## **Architecture & Ecosystem Map**

The reference Python implementation of the A2UI Agent SDK (`a2ui_agent`).

- **Inference Formats & Prompt Engineering**: Decouples input prompt generation and output response parsing via format strategy facades (`InferenceFormat` / `InferenceFormatFactory`). Each strategy coordinates a format-specific `PromptGenerator` (which outputs instruction snippets and catalog schemas) and a `Parser` (which tokenizes, unwraps, and compiles responses).
- **Response Parsing**: Employs format-specific `Parser` engines to unwrap sentinel-tagged content, tokenize LLM responses into conversational text and raw payload blocks, and compile format expressions into standard A2UI payload messages. In `ExpressCompiler`, surface-creating scopes fold data path assignments (supporting list traversal and canonical numeric-segment list auto-vivification) into a single root data model, whereas surface-updating scopes emit one targeted `updateDataModel` message per data path assignment at its JSON Pointer path.
- **Validation**: Structural layout and schema validation are delegated directly to core `a2ui.core.validation.PayloadValidator` to enforce contract compliance across all inference formats.
- **Framework Independence**: The SDK is completely agent-framework agnostic. It provides pure Python primitives and processor facades without hardcoded dependencies on specific agent frameworks like ADK or LangChain.
- **Typesafe Builder API**: `a2ui.builder` is the authoring counterpart to the inference formats, letting application code construct A2UI directly against native types. It splits into a hand-written runtime (`core/` for child-slot flattening and ID allocation, `<version>/` for protocol models) and `<version>/catalogs/`, which is generated from the catalog JSON schema by the Dart CLI and never edited by hand.

## **Local Technical Decisions & Overrides**

- **Multi-Catalog Capability Negotiation**: Implements `A2uiGenerator` and `A2uiRequestProcessor` to negotiate client capabilities (`A2uiRendererCapabilities`) against registered catalog configurations (`CatalogConfig`).
- **Standalone Catalog Transformers**: Uses `ComponentPruningTransformer` and `FunctionPruningTransformer` to decouple component and function allowlist filtering from raw schema parsing and representation.
- **Zero Validator Overhead**: Directly reuses `a2ui.core.validation.PayloadValidator` from `a2ui_core`, eliminating redundant validator facade wrappers in the agent layer.
- **Direct JSON Syntax Healing**: `DirectJsonFormat` includes JSON-specific repair utilities and `progressive_keys` to auto-heal fragmented JSON syntax, unquoted keys, and trailing commas.
- **Catalog Providers**: Provides `FileSystemCatalogProvider` for reading local catalog files and `InMemoryCatalogProvider` for in-memory dictionaries, with an extensible `CatalogProvider` base class for custom catalog loading strategies (e.g., remote REST API or cloud storage).
- **Streamed parts typing**: `ResponseStream` is generic in the parts it returns, and `open_stream` is overloaded on `after_rejected_block`, so only a stream opened with `"continue"` is typed `ResponseStream[StreamPart]` and returns `ErrorPart`s. Python 3.10 has no type parameter defaults, so every annotation names the part type, usually `ResponseStream[ResponsePart]`.
- **Streaming without a chunk transaction**: `DirectJsonResponseStream` applies each block's messages as it emits them, so a failing chunk's earlier parts stay applied and are attached to the error as `partial_results`. A rejected block is still scanned for its closing tag, without being read, when the stream reads past rejected blocks.
- **No renderer**: The Python SDK has no renderer, so it does not implement the optional `agent_renderer_app` feature.
- **Agent function RPC on asyncio**: `a2ui.rpc` is asyncio-native. `AgentFunctionRegistry` awaits async handlers on the caller's loop and runs sync handlers through `asyncio.to_thread`; `RendererFunctionCalls` returns an `asyncio.Future`, uses `loop.call_later` for timeouts, and accepts `resolve` and `dispose` from other threads through `loop.call_soon_threadsafe`.

## **Validation & Execution Recipes**

- **Test execution**: Run unit/integration tests with `uv run pytest`.
- **Linting check**: Check style boundaries with `uv run pyink --check .`.
- **Formatting**: Format codebase via `uv run pyink .`.
