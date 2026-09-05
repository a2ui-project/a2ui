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

### Overview

Update A2UI SDK to use words that are easy to map to envelopes.

Specifically:

1. rendererToAgentRequest  
2. agentToModelRequest  
3. modelToAgentResponse  
4. agentToRendererResponse

Where sometimes postfix 'request'/'response' can be used instead of 'message' and 'payload', and sometimes dropped.

### Naming rule

Every name carries its direction. The `Request` or `Response` postfix then takes the place of a vague word rather than being added on top of one: where a name says `Message` or `Payload`, the postfix replaces it, and where a name says something specific already, the postfix is dropped.

So the envelope union [`A2uiMessage`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/core/messages.dart#L19) becomes `AgentToRendererResponse`, the postfix standing in for the word it drops. The class that handles it, [`MessageProcessor`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/processing/processor.dart#L50), becomes `AgentToRendererProcessor` rather than `AgentToRendererResponseProcessor`, because `Processor` is a real noun and needs no help; [`MessageParser`](https://github.com/a2ui-project/a2ui/blob/main/swift/core/Sources/A2UICore/Processing/MessageParser.swift#L18) and [`A2uiValidator`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/validation/validator.dart#L117) lose their postfix for the same reason. Variants keep their names: [`CreateSurfaceMessage`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/core/messages.dart#L175) already names one thing, and is only ever agent to renderer.

Methods and parameters do not repeat the direction, because the enclosing type or the parameter type already says it. [`MessageProcessor.processPayload`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/processing/processor.dart#L115) becomes `AgentToRendererProcessor.processJson`, not `processAgentToRendererResponseJson`. Where the method itself says `Messages`, the postfix replaces that word too, so [`MessageProcessor.processMessages`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/processing/processor.dart#L125) becomes `processResponses`.

Each row links every declaration of the element. Methods are written as `Class.method`, using the name the class has in that column, so the proposed column shows the full name after both renames. An element declared in one language only is a gap, not an oversight, and the note under the table says which.

Protocol v0.9 and v0.9.1 are published, so their specifications cannot change. Everything under [`specification/v0_9/`](https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9/json) and [`specification/v0_9_1/`](https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9_1/json) is out of scope, along with the copies each SDK vendors of those files. Only [`specification/v1_0/`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json) is in scope. SDK code that implements v0.9 is not a specification and stays in scope: `A2uiMessage` in `web_core/src/v0_9/schema/server-to-client.ts` is a type this project chose, not one the protocol dictates.

The v1.0 specification has already made this rename. Its files are [`agent_to_renderer.json`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/agent_to_renderer.json), [`renderer_to_agent.json`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/renderer_to_agent.json), [`agent_capabilities.json`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/agent_capabilities.json), [`renderer_capabilities.json`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/renderer_capabilities.json) and [`renderer_data_model.json`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/renderer_data_model.json), where v0.9 has `server_to_client.json`, `client_to_server.json` and the rest. So this proposal is not inventing a vocabulary. It is bringing the SDKs to the one v1.0 already uses.

### 1. Agent to renderer response

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

`CreateSurfaceMessage`, `UpdateComponentsMessage`, `UpdateDataModelMessage` and `DeleteSurfaceMessage` keep their names. Each already names the one thing it does, they are only ever agent to renderer, and under the rule above a name that is already specific takes no postfix.

Swift names the union `ServerToClientMessage` while dart, ts and python name it `A2uiMessage`, so this one type needs two different renames. `processPayload` and `parseMessagesFor` are dart only; swift spells `processMessages` as `process(messages:)`; `a2ui_payload` exists in the blueprint but in no implementation. The v0.9 schema files these types encode are published and out of scope, so they are not listed.

### 2. Renderer to agent request

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

The capabilities rename is already half done: dart has `A2uiRendererCapabilities` while the v0.9 schema file it reads is still `client_capabilities.json`. That file is published and cannot change, which is why only the accessors appear above.

Python splits the union into `A2uiClientActionMessage` and `A2uiClientErrorMessage` while ts and dart carry the action alone, so those entries collapse to `RendererToAgentAction` in different ways per language.

### 3. Agent to model request, model to agent response

Neither direction has a name today. They hide behind `format_content`, `response` and `examples`. No enclosing type carries the direction here, so these names spell it out in full. Everything here is python only; no other agent SDK implements these directions. `compile` and `decompile` already name what they do and are not listed.

| Current | Declarations | Proposed |
| :--- | :--- | :--- |
| `unwrap_response` (module level) | [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/direct_json/parser.py#L28) | `unwrap_model_to_agent_response` (module level) |
| `DirectJsonParser.has_format_content` | [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/direct_json/parser.py#L91) | `DirectJsonParser.has_model_to_agent_response` |
| `DirectJsonParser.unwrap` | [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/direct_json/parser.py#L98) | `DirectJsonParser.unwrap_model_to_agent_response` |
| `DirectJsonParser.process_chunk` | [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/direct_json/parser.py#L129) | `DirectJsonParser.process_model_to_agent_chunk` |
| `A2uiRequestProcessor.examples`, `A2uiGenerator.examples` | [blueprint](https://github.com/a2ui-project/a2ui/blob/main/blueprints/modules/a2ui_agent.blueprint.md#L518) | `A2uiRequestProcessor.agent_to_model_examples` |

### 4. Validators

`A2uiValidator` reads as if it validates anything A2UI. It validates one direction.

| Current | Declarations | Proposed |
| :--- | :--- | :--- |
| `A2uiValidator` | [dart](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/validation/validator.dart#L117), [python core](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/validating/validator.py#L40), [python agent](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/validation/validator.py#L267), [kotlin](https://github.com/a2ui-project/a2ui/blob/main/kotlin/agent_sdk_legacy/src/main/kotlin/com/google/a2ui/schema/Validator.kt#L45) | `AgentToRendererValidator` |
| `ValidationConfig` | [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/validating/validator.py#L44), [swift](https://github.com/a2ui-project/a2ui/blob/main/swift/core/Sources/A2UICore/Validation/ValidationConfig.swift#L16) | `AgentToRendererValidationConfig` |
| `A2uiValidationError` (wire) | [ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/schema/client-to-server.ts#L42), [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/schema/client_to_server.py#L52) | `RendererToAgentValidationError` |

That row is a name collision, not just a vague name. In both ts and python, `A2uiValidationError` is also a thrown error class, in [`errors.ts`](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/errors.ts#L50) and [`exceptions.py`](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/exceptions.py#L48), separately from the wire shape a renderer sends an agent to report that validation failed. Two different things, opposite directions, same name, same package. The thrown class keeps its name, so renaming the wire model is what separates them.

Python declares `A2uiValidator` twice, once in a2ui_core and once in a2ui_agent, plus `A2uiValidatorWrapper` and `A2uiValidatorWrapperV10` in the same agent file. Whether those collapse is a separate question from this rename. There is no validator class in web_core; ts validates through zod schemas. Kotlin's lives in `agent_sdk_legacy`.

Leave alone: [`CatalogSchemaValidator`](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/validating/catalog_schema_validator.py#L42) and [`GraphTopologyValidator`](https://github.com/a2ui-project/a2ui/blob/main/swift/core/Sources/A2UICore/Validation/GraphTopologyValidator.swift#L19) validate catalog documents and component graphs, not envelopes, so no direction applies.

### 5. Needs a decision, not a mechanical rename

[`A2uiRequestProcessor`](https://github.com/a2ui-project/a2ui/blob/main/blueprints/modules/a2ui_agent.blueprint.md#L565) spans three of the four envelopes: it renders the agent to model prompt, parses the model to agent output, and validates the agent to renderer result. No direction fits, so the mechanical rule above gives no answer. The misleading word is `Request`, which here means an inbound user request and not any A2UI envelope. Options are `A2uiTurnProcessor`, naming its scope rather than a direction, or splitting it along the three directions it serves.

[`A2uiGenerator`](https://github.com/a2ui-project/a2ui/blob/main/blueprints/modules/a2ui_agent.blueprint.md#L518) generates neither UI nor messages. It holds the agent's catalogs and hands out a processor per renderer capability signature. `A2uiCatalogRegistry` describes what it does.

Both are blueprint-only. Neither name appears in any implementation, so renaming them costs nothing today and settles the vocabulary before the python agent SDK grows into the specified shape.

### Where the postfix does not fit

Three places where `Request` and `Response` do not survive contact with v1.0. None blocks the proposal, all are worth knowing before the postfix is applied by hand.

v1.0 carries calls and responses in both directions. [`agent_to_renderer.json`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/agent_to_renderer.json) defines `callRendererFunction` alongside `agentFunctionResponse`, and [`renderer_to_agent.json`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/renderer_to_agent.json) defines `callAgentFunction` alongside `rendererFunctionResponse`. So `RendererToAgentRequest` is a request that contains `rendererFunctionResponse`. The postfix describes the direction's usual role, not the contents of every envelope in it.

The v1.0 filenames use direction alone, `agent_to_renderer.json` rather than `agent_to_renderer_response.json`, so a postfixed type name will not match the schema file it implements. Dropping the postfix on the four union types would close that gap, at the cost of the pairing the postfix makes visible.

`Response` is already spent one level down, on the result of a function call. `AgentToRendererResponse` will contain `AgentFunctionResponseMessage`, and the word means something different in each.

### Out of scope

`validateMessageSecurity`, `IncomingWebFrameMessageSchema` and `postMessage` in `samples/community` are browser `postMessage` plumbing, unrelated to A2UI envelopes. The A2A SDK types (`SendMessageSuccessResponse`, `RequestContext`, `MessageSendParams`) belong to another protocol.

Protocol v0.8 is excluded. The `ServerToClientMessage` and `ClientToServerMessage` types under `renderers/*/src/v0_8/` stay as they are; the swift rows above are v0.9.1, which still uses that vocabulary.

Published specifications are excluded: `specification/v0_9/`, `specification/v0_9_1/`, and the copies of those files each SDK vendors, such as `renderers/web_core/src/v0_9/schemas/`. Renaming them would break every deployed renderer and agent. The v0.9 SDK code that reads them is still in scope; a type name is this project's choice, a wire schema filename is a published contract.
