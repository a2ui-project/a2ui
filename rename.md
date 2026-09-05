# **Descriptive naming in A2UI SDK**

## **TL;DR**

## **Background**

1. A2UI protocol enables interaction between **agent** and **renderer**.  
     
2. A2UI SDK consists of the packages: a2ui_core, a2ui_agent, a2ui_renderer.

3. The packages are specified by language-agnostic [blueprints](https://github.com/a2ui-project/a2ui/tree/main/blueprints/modules).

4. **a2ui\_agent** enables interaction between three parties: model, agent, renderer.

5. **a2ui\_agent** deals with four types of envelopes:

   1. ​renderer to agent request  
   2. ​agent to model request  
   3. ​model to agent response  
   4. ​agent to renderer response

## **Problem**

API, declared in [blueprints](https://github.com/a2ui-project/a2ui/tree/main/blueprints/modules) uses words **‘payload’, ‘message’ and ‘request’**. It takes **significant mental effort** for developers (both contributors and users) to map **payload/message/request** to one of four envelopes.

Coding agents understand the difference, which results in developers having a **hard time understanding what the agent is saying**.

Sometimes there is the prefix ‘a2ui’, but that does not help because all the messages are some kind of A2UI messages. 

## **Proposal**

Update A2UI SDK to use words that are easy to map to envelopes.

Specifically:

1. rendererToAgentRequest  
2. agentToModelRequest  
3. modelToAgentResponse  
4. agentToRendererResponse

That means the code elements will be renamed as follows:

### Naming rule

Types carry the direction. The envelope union type carries `Request` or `Response`; its variants and the things that act on it do not, so `AgentToRendererResponse` has variants `CreateSurfaceMessage` and so on, and is handled by `AgentToRendererProcessor`. Methods and parameters do not repeat the direction, because the enclosing type or the parameter type already says it: `AgentToRendererProcessor.processJson(json)`, not `processAgentToRendererResponseJson`.

Each row links every declaration of the element. Methods are written as `Class.method`, using the name the class has in that column, so the proposed column shows the full name after both renames. An element declared in one language only is a gap, not an oversight, and the note under the table says which.

### 1. Agent to renderer, response

The envelopes `createSurface`, `updateComponents`, `updateDataModel` and `deleteSurface`, and everything that carries them.

| Current | Declarations | Proposed |
| :--- | :--- | :--- |
| `A2uiMessage` | [dart](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/core/messages.dart#L19), [ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/schema/server-to-client.ts#L130), [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/schema/server_to_client.py#L120) | `AgentToRendererResponse` |
| `ServerToClientMessage` | [swift](https://github.com/a2ui-project/a2ui/blob/main/swift/core/Sources/A2UICore/Messages/ServerToClientMessage.swift#L21) | `AgentToRendererResponse` |
| `A2uiMessageList` | [ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/schema/server-to-client.ts#L138) | `AgentToRendererResponseList` |
| `A2uiMessageListWrapper` | [ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/schema/server-to-client.ts#L147), [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/schema/server_to_client.py#L128) | `AgentToRendererResponseListWrapper` |
| `MessageProcessor` | [dart](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/processing/processor.dart#L50), [ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/processing/message-processor.ts#L98), [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/processing/message_processor.py#L30), [swift](https://github.com/a2ui-project/a2ui/blob/main/swift/core/Sources/A2UICore/Processing/MessageProcessor.swift#L24) | `AgentToRendererProcessor` |
| `MessageProcessorOptions` | [ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/processing/message-processor.ts#L50) | `AgentToRendererProcessorOptions` |
| `MessageParser` | [swift](https://github.com/a2ui-project/a2ui/blob/main/swift/core/Sources/A2UICore/Processing/MessageParser.swift#L18) | `AgentToRendererParser` |
| `MessageErrorMapper` | [swift](https://github.com/a2ui-project/a2ui/blob/main/swift/core/Sources/A2UICore/Processing/MessageErrorMapper.swift#L24) | `AgentToRendererErrorMapper` |
| `MessageParseError` | [swift](https://github.com/a2ui-project/a2ui/blob/main/swift/core/Sources/A2UICore/Errors/MessageParseError.swift#L18) | `AgentToRendererParseError` |
| `MessageProcessor.processPayload` | [dart](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/processing/processor.dart#L115) | `AgentToRendererProcessor.processJson` |
| `MessageProcessor.processMessages` | [dart](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/processing/processor.dart#L125), [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/processing/message_processor.py#L48), [swift](https://github.com/a2ui-project/a2ui/blob/main/swift/core/Sources/A2UICore/Processing/MessageProcessor.swift#L289) | `AgentToRendererProcessor.processResponses` |
| `A2uiValidator.parseMessages` | [dart](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/validation/validator.dart#L200) | `AgentToRendererValidator.parseResponses` |
| `A2uiValidator.parseMessagesFor` | [dart](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/validation/validator.dart#L213) | `AgentToRendererValidator.parseJson` |
| `Parser.decompile(a2ui_payload)` | [blueprint](https://github.com/a2ui-project/a2ui/blob/main/blueprints/modules/a2ui_agent.blueprint.md#L283) | `Parser.decompile(agent_to_renderer_responses)` |
| `InferenceFormat.generate_system_prompt(allowed_messages)`, `DirectJsonPromptGenerator.generate(allowed_messages)` | [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_format.py#L52), [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/direct_json/prompt_generator.py#L45) | `InferenceFormat.generate_system_prompt(allowed_response_types)`, `DirectJsonPromptGenerator.generate(allowed_response_types)` |
| `server_to_client.json`, `_list`, `_list_wrapper` | [specification](https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9/json/server_to_client.json), [web_core](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/schemas/server_to_client.json) | `agent_to_renderer_response*.json` |

`CreateSurfaceMessage`, `UpdateComponentsMessage`, `UpdateDataModelMessage` and `DeleteSurfaceMessage` keep their names. Each already names the one thing it does, they are only ever agent to renderer, and under the rule above variants take no suffix.

Swift names the union `ServerToClientMessage` while dart, ts and python name it `A2uiMessage`, so this one type needs two different renames. `processPayload` and `parseMessagesFor` are dart only; swift spells `processMessages` as `process(messages:)`; `a2ui_payload` exists in the blueprint but in no implementation.

### 2. Renderer to agent, request

| Current | Declarations | Proposed |
| :--- | :--- | :--- |
| `A2uiClientMessage` | [ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/schema/client-to-server.ts#L103), [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/schema/client_to_server.py#L101) | `RendererToAgentRequest` |
| `ClientToServerMessage` | [swift](https://github.com/a2ui-project/a2ui/blob/main/swift/core/Sources/A2UICore/Messages/ClientToServerMessage.swift#L18) | `RendererToAgentRequest` |
| `A2uiClientMessageList` | [ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/schema/client-to-server.ts#L110), [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/schema/client_to_server.py#L111) | `RendererToAgentRequestList` |
| `A2uiClientMessageListWrapper` | [ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/schema/client-to-server.ts#L119), [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/schema/client_to_server.py#L114) | `RendererToAgentRequestListWrapper` |
| `A2uiClientAction` | [dart](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/core/messages.dart#L257), [ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/schema/client-to-server.ts#L101), [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/schema/client_to_server.py#L22) | `RendererToAgentAction` |
| `A2uiClientActionMessage` | [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/schema/client_to_server.py#L91) | `RendererToAgentAction` |
| `A2uiClientErrorMessage` | [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/schema/client_to_server.py#L96) | `RendererToAgentError` |
| `A2uiClientErrorSchema` | [ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/schema/client-to-server.ts#L74) | `RendererToAgentErrorSchema` |
| `MessageProcessor.getClientCapabilities` | [dart](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/processing/processor.dart#L258), [ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/processing/message-processor.ts#L127), [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/processing/message_processor.py#L62) | `AgentToRendererProcessor.getRendererCapabilities` |
| `MessageProcessor.getClientDataModel` | [dart](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/processing/processor.dart#L354), [ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/processing/message-processor.ts#L238), [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/processing/message_processor.py#L83) | `AgentToRendererProcessor.getRendererDataModel` |
| `client_to_server*.json` | [specification](https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9/json/client_to_server.json), [web_core](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/schemas/client_to_server.json) | `renderer_to_agent_request*.json` |
| `client_capabilities.json` | [specification](https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9/json/client_capabilities.json) | `renderer_capabilities.json` |
| `client_data_model.json` | [specification](https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9/json/client_data_model.json) | `renderer_data_model.json` |
| `server_capabilities.json` | [specification](https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9/json/server_capabilities.json) | `agent_capabilities.json` |

The capabilities rename is already half done: dart has `A2uiRendererCapabilities` while the schema file it reads is still `client_capabilities.json`.

Python splits the union into `A2uiClientActionMessage` and `A2uiClientErrorMessage` while ts and dart carry the action alone, so the two rows collapse to `RendererToAgentAction` in different ways per language.

### 3. Agent to model, request. Model to agent, response

Neither direction has a name today. They hide behind `format_content`, `response` and `examples`. Everything here is python only; no other agent SDK implements these directions.

| Current | Declarations | Proposed |
| :--- | :--- | :--- |
| `unwrap_response` (module level) | [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/direct_json/parser.py#L28) | `unwrap_model_to_agent_response` (module level) |
| `DirectJsonParser.has_format_content` | [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/direct_json/parser.py#L91) | `DirectJsonParser.has_model_to_agent_response` |
| `DirectJsonParser.unwrap` | [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/direct_json/parser.py#L98) | `DirectJsonParser.unwrap_model_to_agent_response` |
| `DirectJsonParser.compile` | [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/direct_json/parser.py#L109) | `DirectJsonParser.compile`, unchanged: model to agent in, agent to renderer out |
| `DirectJsonParser.process_chunk` | [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/direct_json/parser.py#L129) | `DirectJsonParser.process_model_to_agent_chunk` |
| `DirectJsonParser.decompile` | [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/direct_json/parser.py#L144) | `DirectJsonParser.decompile`, unchanged |
| `A2uiRequestProcessor.examples`, `A2uiGenerator.examples` | [blueprint](https://github.com/a2ui-project/a2ui/blob/main/blueprints/modules/a2ui_agent.blueprint.md#L518) | `A2uiRequestProcessor.agent_to_model_examples` |

### 4. Validators

`A2uiValidator` reads as if it validates anything A2UI. It validates one direction.

| Current | Declarations | Proposed |
| :--- | :--- | :--- |
| `A2uiValidator` | [dart](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/validation/validator.dart#L117), [python core](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/validating/validator.py#L80), [python agent](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/validation/validator.py#L267), [kotlin](https://github.com/a2ui-project/a2ui/blob/main/kotlin/agent_sdk_legacy/src/main/kotlin/com/google/a2ui/schema/Validator.kt#L45) | `AgentToRendererValidator` |
| `A2uiValidator.validate` | [dart](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/validation/validator.dart#L302), [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/validating/validator.py#L240) | `AgentToRendererValidator.validate`, method name unchanged because the class names the direction |
| `A2uiValidator.validateStructure` | [dart](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/validation/validator.dart#L241) | `AgentToRendererValidator.validateStructure` |
| `A2uiValidator.validateAgainstCatalogs` | [dart](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/validation/validator.dart#L289) | `AgentToRendererValidator.validateAgainstCatalogs` |
| `ValidationConfig` | [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/validating/validator.py#L44), [swift](https://github.com/a2ui-project/a2ui/blob/main/swift/core/Sources/A2UICore/Validation/ValidationConfig.swift#L16) | `AgentToRendererValidationConfig` |
| `A2uiValidationError` (wire) | [ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/schema/client-to-server.ts#L42), [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/schema/client_to_server.py#L52) | `RendererToAgentValidationError` |
| `A2uiValidationError` (thrown) | [dart](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/primitives/errors.dart#L26), [ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/errors.ts#L50), [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/exceptions.py#L48) | unchanged |

The last two rows are a name collision, not just a vague name. In both ts and python, `A2uiValidationError` is a thrown error class and, separately, the wire shape a renderer sends an agent to report that validation failed. Two different things, opposite directions, same name, same package. The thrown class keeps its name.

Python declares `A2uiValidator` twice, once in a2ui_core and once in a2ui_agent, plus `A2uiValidatorWrapper` and `A2uiValidatorWrapperV10` in the same agent file. Whether those collapse is a separate question from this rename. There is no validator class in web_core; ts validates through zod schemas. Kotlin's lives in `agent_sdk_legacy`.

Leave alone: [`CatalogSchemaValidator`](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/validating/catalog_schema_validator.py#L42) and [`GraphTopologyValidator`](https://github.com/a2ui-project/a2ui/blob/main/swift/core/Sources/A2UICore/Validation/GraphTopologyValidator.swift#L19) validate catalog documents and component graphs, not envelopes, so no direction applies.

### 5. Needs a decision, not a mechanical rename

[`A2uiRequestProcessor`](https://github.com/a2ui-project/a2ui/blob/main/blueprints/modules/a2ui_agent.blueprint.md#L565) spans three of the four envelopes: it renders the agent to model request, parses the model to agent response, and validates the agent to renderer response. No direction fits. Worse under this proposal than before it, because `Request` becomes a reserved word naming two specific envelope kinds, and this class processes neither exclusively. Options are `A2uiTurnProcessor`, naming its scope rather than a direction, or splitting it along the three directions it serves.

[`A2uiGenerator`](https://github.com/a2ui-project/a2ui/blob/main/blueprints/modules/a2ui_agent.blueprint.md#L518) generates neither UI nor messages. It holds the agent's catalogs and hands out a processor per renderer capability signature. `A2uiCatalogRegistry` describes what it does.

Both are blueprint-only. Neither name appears in any implementation, so renaming them costs nothing today and settles the vocabulary before the python agent SDK grows into the specified shape.

### Note on the suffix

`Request` and `Response` are derivable from the direction: renderer to agent and agent to model are always requests, the two return directions are always responses. The suffix adds no information a reader could not infer, which is why the rule above keeps it off variants and off processors and validators, where it would double the length of a name that is already unambiguous. It earns its place on the four envelope union types, where naming the role is what makes the pairing visible.

### Out of scope

`validateMessageSecurity`, `IncomingWebFrameMessageSchema` and `postMessage` in `samples/community` are browser `postMessage` plumbing, unrelated to A2UI envelopes. The A2A SDK types (`SendMessageSuccessResponse`, `RequestContext`, `MessageSendParams`) belong to another protocol.

Protocol v0.8 is excluded. The `ServerToClientMessage` and `ClientToServerMessage` types under `renderers/*/src/v0_8/` stay as they are; the swift rows above are v0.9.1, which still uses that vocabulary.
