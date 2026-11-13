---
codebase_path: python/a2ui_agent
associated_module: a2ui_agent
module_blueprint_commit: 24d1bf9c830071f74c9c908433e73cc6cbe0aa33
implemented_features:
  skill_generator: e4e8ee409b5dc32f97e3f452bafc07897fa6a05b
  typesafe_builder_api: 24d1bf9c830071f74c9c908433e73cc6cbe0aa33
local_development:
  test_command: 'uv run pytest'
  lint_command: 'uv run pyink --check .'
  format_command: 'uv run pyink .'
---

# **Python Agent SDK Codebase Blueprint**

## **Architecture & Ecosystem Map**

The reference Python implementation of the A2UI Agent SDK (`a2ui_agent`).

- **Inference Formats & Prompt Engineering**: Decouples input prompt generation and output response parsing via format strategy facades (`InferenceFormat` / `InferenceFormatFactory`). Each strategy coordinates a format-specific `PromptGenerator` (whose `catalogs` property and decomposed `generate_base_rules`, `generate_catalog_instructions`, and `generate_examples` hooks feed `a2ui.prompt.assemble_instructions`, shared by `@final` `PromptGenerator.generate` and `SkillGenerator.generate_skill`, with per-format generator subclasses kept internal behind `InferenceFormat.prompt_generator`) and a `Parser` (which tokenizes, unwraps, and compiles responses).
- **Response Parsing**: Employs format-specific `Parser` engines to unwrap sentinel-tagged content, tokenize LLM responses into conversational text and raw payload blocks, and compile format expressions into standard A2UI payload messages. In `ExpressCompiler`, surface-creating scopes fold data path assignments (supporting list traversal and canonical numeric-segment list auto-vivification) into a single root data model, whereas surface-updating scopes emit one targeted `updateDataModel` message per data path assignment at its JSON Pointer path.
- **Validation**: Structural layout and schema validation are delegated directly to core `a2ui.core.validation.PayloadValidator` to enforce contract compliance across all inference formats.
- **Framework Independence**: The SDK is completely agent-framework agnostic. It provides pure Python primitives and processor facades without hardcoded dependencies on specific agent frameworks like ADK or LangChain.
- **Typesafe Builder API**: `a2ui.builder` is the authoring counterpart to the inference formats, letting application code construct A2UI directly against native types. It splits into a hand-written runtime (`core/` for child-slot flattening and ID allocation, `<version>/` for protocol models) and `<version>/catalogs/`, which is generated from the catalog JSON schema by the Dart CLI and never edited by hand.

## **Local Technical Decisions & Overrides**

- **Multi-Catalog Capability Negotiation**: Implements `A2uiGenerator`, `A2uiRequestProcessor`, `resolve_catalogs`, and `read_renderer_capabilities` (`a2ui.utils`, with `A2UI_CLIENT_CAPABILITIES_KEY` and `A2UI_RENDERER_CAPABILITIES_KEY` in `a2ui.constants`) to extract, validate, and negotiate client capabilities (`A2uiRendererCapabilities`) against registered catalog configurations (`CatalogConfig`).
- **Standalone Catalog Transformers**: Uses `ComponentPruningTransformer` and `FunctionPruningTransformer` to decouple component and function allowlist filtering from raw schema parsing and representation.
- **Zero Validator Overhead**: Directly reuses `a2ui.core.validation.PayloadValidator` from `a2ui_core`, eliminating redundant validator facade wrappers in the agent layer.
- **Direct JSON Syntax Healing**: `DirectJsonFormat` includes JSON-specific repair utilities and `progressive_keys` to auto-heal fragmented JSON syntax, unquoted keys, and trailing commas.
- **Catalog Providers**: Provides `FileSystemCatalogProvider` for reading local catalog files and `InMemoryCatalogProvider` for in-memory dictionaries, with an extensible `CatalogProvider` base class for custom catalog loading strategies (e.g., remote REST API or cloud storage).
- **Streamed parts typing**: `ResponseStream` is generic in the parts it returns, and `open_stream` is overloaded on `after_rejected_block`, so only a stream opened with `"continue"` is typed `ResponseStream[StreamPart]` and returns `ErrorPart`s. Python 3.10 has no type parameter defaults, so every annotation names the part type, usually `ResponseStream[ResponsePart]`.
- **Streaming without a chunk transaction**: `DirectJsonResponseStream` applies each block's messages as it emits them, so a failing chunk's earlier parts stay applied and are attached to the error as `partial_results`. A rejected block is still scanned for its closing tag, without being read, when the stream reads past rejected blocks.
- **Component envelope keys**: `a2ui.utils.component_envelope` (`envelope_key`, `get_envelope_value`) is the one place that picks the `@`-prefixed wire key for a v1.0 component and reads legacy bare keys during the transition, shared by the Express and experimental format compilers and decompilers, the macro expander, and `RendererState`.
- **No renderer**: The Python SDK has no renderer, so it does not implement the optional `agent_renderer_app` feature.
- **Agent and renderer function RPC on asyncio**: `a2ui.rpc` is asyncio-native and exports `RendererToAgentMessageProcessor`, `RendererFunctionCalls`, the v1.0 renderer-to-agent message classes, and `AgentFunctionResponseMessage`. `RendererToAgentMessageProcessor.process_message` is a coroutine; it awaits async agent function handlers on the caller's loop, runs sync handlers through `asyncio.to_thread`, applies `agent_function_timeout` (in seconds) with `asyncio.wait_for` around an inner coroutine that already turns the handler's own exceptions (a `TimeoutError` included) into error replies, so only the processor's deadline gives the timeout message, and accepts sync or async callbacks, which may return `False` to decline. There is no `process_messages`; callers await `process_message` per message. `RendererFunctionCalls` checks `callRendererFunction` targets against `catalog.renderer_functions` (requiring `allowedCallers` of `"agentOnly"` or `"rendererOrAgent"` without `requiresUserActivation`), resolves `rendererFunctionResponse` futures by `functionCallId`, and fails pending calls with `A2uiRpcError(code=RpcErrorCode.CANCELLED)` on `dispose()` (or `async with` exit). The agent function index is the internal module `a2ui.rpc._agent_function_registry`.
- **`CallRendererFunctionMessage` re-export gap**: `a2ui.rpc` does not yet re-export `CallRendererFunctionMessage` from `a2ui.core.schema.v1_0` ([`agent_functions.blueprint.md`](../../../features/agent_functions.blueprint.md)), so `agent_functions` remains omitted from `implemented_features` until that re-export is added.
- **ADK and A2A integration**: `a2ui-a2a`'s `renderer_capabilities_from_message` reads and validates renderer capabilities across `Message.metadata`, `DataPart.metadata`, and legacy `DataPart.data["metadata"]` mappings. `a2ui-adk`'s `a2ui_rpc_callback` (together with `A2uiRendererCallsStore` and `a2ui_rpc_interceptor`) builds a `RendererToAgentMessageProcessor` per request from the agent's catalogs (or a provider of the session's active catalogs), settles pending `RendererFunctionCalls` from `rendererFunctionResponse` messages first, answers requests whose parts are all handled A2UI RPC messages (`callAgentFunction` and settled `rendererFunctionResponse`, with `a2ui_rpc_interceptor` completing empty-reply tasks) without a model turn, and passes any other request to the agent. `exclude_a2ui_rpc_from_prompt` and `SendA2uiToClientToolset` keep `callAgentFunction` and `agentFunctionResponse` out of the model's prompt, and A2A serialization uses Pydantic `exclude_unset=True` so `null` response values are preserved on the wire.

## **Validation & Execution Recipes**

- **Test execution**: Run unit/integration tests with `uv run pytest`.
- **Linting check**: Check style boundaries with `uv run pyink --check .`.
- **Formatting**: Format codebase via `uv run pyink .`.
