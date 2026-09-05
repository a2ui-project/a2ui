# **Descriptive naming in A2UI SDK**

## **TL;DR**

## **Background**

1. A2UI protocol enables interaction between **agent** and **renderer**.  
     
2. A2UI SDK consists of the packages, implemented in multiple languages: a2ui_core, a2ui_agent, a2ui_renderer.

3. The packages are specified by language-agnostic [blueprints](https://github.com/a2ui-project/a2ui/tree/main/blueprints/modules).

4. **a2ui\_agent** enables interaction between three parties: model, agent, renderer.

5. **a2ui\_agent** deals with four types of envelopes:

   1. ​renderer to agent request  
   2. ​agent to model request  
   3. ​model to agent response  
   4. ​agent to renderer response

## **Problem**

API, declared in [blueprints](https://github.com/a2ui-project/a2ui/tree/main/blueprints/modules) uses words **‘payload’, ‘message’ and ‘request’**. It takes **significant mental effort** for developers (both contributors and users) to map **payload/message/request** to one of the four envelopes.

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

Every name says its direction.

Use `Request` or `Response` in place of a vague word, not on top of one. If a name contains `Message` or `Payload`, the postfix replaces that word. If the name is already specific, drop the postfix.

The envelope union [`A2uiMessage`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/core/messages.dart#L19) becomes `AgentToRendererResponse`. Here `Response` replaces `Message`.

[`MessageProcessor`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/processing/processor.dart#L50) becomes `AgentToRendererProcessor`, not `AgentToRendererResponseProcessor`. `Processor` is already a clear word, so it stays. [`MessageParser`](https://github.com/a2ui-project/a2ui/blob/main/swift/core/Sources/A2UICore/Processing/MessageParser.swift#L18) and [`A2uiValidator`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/validation/validator.dart#L117) follow the same rule.

Variants keep their names. [`CreateSurfaceMessage`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/core/messages.dart#L175) already says what it is, and it is only ever agent to renderer.

Methods and parameters do not repeat the direction. The class or the parameter type already gives it. So [`MessageProcessor.processPayload`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/processing/processor.dart#L115) becomes `AgentToRendererProcessor.processJson`, not `processAgentToRendererResponseJson`.

When the method name itself contains `Messages`, the postfix replaces that word too. [`MessageProcessor.processMessages`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/processing/processor.dart#L125) becomes `processResponses`.

Each row below links every declaration of the element. Methods appear as `Class.method`. The proposed column uses the new class name, so it shows the full name after both renames.

Some elements exist in one language only. That is a gap in the other SDKs, not an omission here. The note under each table says which.

v0.9 and v0.9.1 are published, so their schemas cannot change. [`specification/v0_9/`](https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9/json) and [`specification/v0_9_1/`](https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9_1/json) are out of scope, and so are the copies each SDK keeps of those files. Only [`specification/v1_0/`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json) is in scope.

SDK code that implements v0.9 is still in scope. A schema file is a published contract. A type name is our own choice. [`A2uiMessage`](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/schema/server-to-client.ts#L130) in [`server-to-client.ts`](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/schema/server-to-client.ts) is a name we picked, not one the protocol requires.

v1.0 has already made this rename. Its files are [`agent_to_renderer.json`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/agent_to_renderer.json), [`renderer_to_agent.json`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/renderer_to_agent.json), [`agent_capabilities.json`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/agent_capabilities.json), [`renderer_capabilities.json`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/renderer_capabilities.json) and [`renderer_data_model.json`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/renderer_data_model.json). v0.9 has [`server_to_client.json`](https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9/json/server_to_client.json), [`client_to_server.json`](https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9/json/client_to_server.json) and the rest.

So this proposal does not invent a vocabulary. It brings the SDKs to the one v1.0 already uses.

### 1. Agent to renderer response

The envelopes [`createSurface`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/core/messages.dart#L175), [`updateComponents`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/core/messages.dart#L202), [`updateDataModel`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/core/messages.dart#L220) and [`deleteSurface`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/core/messages.dart#L244), and everything that carries them.

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

**`CreateSurfaceMessage` and the other variants -> unchanged:**

[`CreateSurfaceMessage`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/core/messages.dart#L175), [`UpdateComponentsMessage`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/core/messages.dart#L202), [`UpdateDataModelMessage`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/core/messages.dart#L220) and [`DeleteSurfaceMessage`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/core/messages.dart#L244) keep their names. Each already says what it is, and each is only ever agent to renderer.

**`ServerToClientMessage` and `A2uiMessage` -> `AgentToRendererResponse`:**

Swift calls the union [`ServerToClientMessage`](https://github.com/a2ui-project/a2ui/blob/main/swift/core/Sources/A2UICore/Messages/ServerToClientMessage.swift#L21). Dart, ts and python call it [`A2uiMessage`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/core/messages.dart#L19). So one type needs two different renames.

**Elements that exist in one language only:**

[`processPayload`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/processing/processor.dart#L115) and [`parseMessagesFor`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/validation/validator.dart#L213) exist in dart only. Swift spells [`processMessages`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/processing/processor.dart#L125) as [`process(messages:)`](https://github.com/a2ui-project/a2ui/blob/main/swift/core/Sources/A2UICore/Processing/MessageProcessor.swift#L289). [`a2ui_payload`](https://github.com/a2ui-project/a2ui/blob/main/blueprints/modules/a2ui_agent.blueprint.md#L283) appears in the blueprint but in no implementation.

**`server_to_client.json` -> out of scope:**

The v0.9 schema files behind these types are published, so they are not listed.

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

**`getClientCapabilities` -> `getRendererCapabilities`:**

The capabilities rename is half done. Dart already has [`A2uiRendererCapabilities`](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/core/renderer_capabilities.dart#L93), but the v0.9 schema file it reads is still [`client_capabilities.json`](https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9/json/client_capabilities.json). That file is published and cannot change, so only the accessors appear above.

**`A2uiClientActionMessage` and `A2uiClientErrorMessage` -> `RendererToAgentAction`:**

Python splits the union into [`A2uiClientActionMessage`](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/schema/client_to_server.py#L91) and [`A2uiClientErrorMessage`](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/schema/client_to_server.py#L96). Ts and dart carry the action alone. So these entries reach `RendererToAgentAction` differently in each language.

### 3. Agent to model request, model to agent response

Neither direction has a name today. Model output arrives as `content` in [`unwrap_response`](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/direct_json/parser.py#L28) and [`unwrap`](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/direct_json/parser.py#L98), and as `chunk` in [`process_chunk`](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/direct_json/parser.py#L129). Prompt examples travel as [`examples`](https://github.com/a2ui-project/a2ui/blob/main/blueprints/modules/a2ui_agent.blueprint.md#L518). No enclosing type carries the direction, so these names spell it out in full.

All of this is python only. No other agent SDK implements these directions. [`compile`](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/direct_json/parser.py#L109) and [`decompile`](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/direct_json/parser.py#L144) already say what they do, so they are not listed.

| Current | Declarations | Proposed |
| :--- | :--- | :--- |
| `unwrap_response` (module level) | [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/direct_json/parser.py#L28) | `unwrap_model_to_agent_response` (module level) |
| `DirectJsonParser.unwrap` | [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/direct_json/parser.py#L98) | `DirectJsonParser.unwrap_model_to_agent_response` |
| `DirectJsonParser.process_chunk` | [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/direct_json/parser.py#L129) | `DirectJsonParser.process_model_to_agent_chunk` |
| `A2uiRequestProcessor.examples`, `A2uiGenerator.examples` | [blueprint](https://github.com/a2ui-project/a2ui/blob/main/blueprints/modules/a2ui_agent.blueprint.md#L518) | `A2uiProcessor.agent_to_model_examples` |

### 4. Validators

`A2uiValidator` reads as if it validates anything A2UI. It validates one direction.

| Current | Declarations | Proposed |
| :--- | :--- | :--- |
| `A2uiValidator` | [dart](https://github.com/a2ui-project/a2ui/blob/main/dart/a2ui_core/lib/src/validation/validator.dart#L117), [python core](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/validating/validator.py#L40), [python agent](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/validation/validator.py#L267), [kotlin](https://github.com/a2ui-project/a2ui/blob/main/kotlin/agent_sdk_legacy/src/main/kotlin/com/google/a2ui/schema/Validator.kt#L45) | `AgentToRendererValidator` |
| `ValidationConfig` | [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/validating/validator.py#L44), [swift](https://github.com/a2ui-project/a2ui/blob/main/swift/core/Sources/A2UICore/Validation/ValidationConfig.swift#L16) | `AgentToRendererValidationConfig` |
| `A2uiValidationError` (wire) | [ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/schema/client-to-server.ts#L42), [python](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/schema/client_to_server.py#L52) | `RendererToAgentValidationError` |

**`A2uiValidationError` -> `RendererToAgentValidationError`:**

This is a name collision, not just a vague name. `A2uiValidationError` means two different things in both ts and python.

It is a thrown error class, in [`errors.ts`](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/errors.ts#L50) and [`exceptions.py`](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/exceptions.py#L48). It is also the wire shape a renderer sends an agent to report a validation failure. Same name, same package, opposite directions.

The thrown class keeps its name, so renaming the wire model is what tells them apart.

**`A2uiValidator` -> `AgentToRendererValidator`:**

Python declares `A2uiValidator` twice, in [a2ui_core](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/validating/validator.py#L40) and in [a2ui_agent](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/validation/validator.py#L267). The agent file also has [`A2uiValidatorWrapper`](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/validation/validator.py#L66) and [`A2uiValidatorWrapperV10`](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/validation/validator.py#L91). Whether those merge is a separate question.

Web_core has no validator class, because ts validates through zod schemas. Kotlin's validator lives in [`agent_sdk_legacy`](https://github.com/a2ui-project/a2ui/blob/main/kotlin/agent_sdk_legacy/src/main/kotlin/com/google/a2ui/schema/Validator.kt#L45).

**`CatalogSchemaValidator` and `GraphTopologyValidator` -> unchanged:**

[`CatalogSchemaValidator`](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/src/a2ui/core/validating/catalog_schema_validator.py#L42) and [`GraphTopologyValidator`](https://github.com/a2ui-project/a2ui/blob/main/swift/core/Sources/A2UICore/Validation/GraphTopologyValidator.swift#L19) validate catalog documents and component graphs, not envelopes. No direction applies, so they stay as they are.

### 5. The agent facade, which spans every direction

| Current | Declarations | Proposed |
| :--- | :--- | :--- |
| `A2uiRequestProcessor` | [blueprint](https://github.com/a2ui-project/a2ui/blob/main/blueprints/modules/a2ui_agent.blueprint.md#L565) | `A2uiProcessor` |
| `A2uiGenerator` | [blueprint](https://github.com/a2ui-project/a2ui/blob/main/blueprints/modules/a2ui_agent.blueprint.md#L518) | unchanged |

**`A2uiRequestProcessor` -> `A2uiProcessor`:**

[`A2uiRequestProcessor`](https://github.com/a2ui-project/a2ui/blob/main/blueprints/modules/a2ui_agent.blueprint.md#L565) touches three of the four envelopes. It renders the agent to model request, parses the model to agent response, and validates the agent to renderer response. No direction fits all three, so the rule above gives no answer.

`Request` is the word to drop. Here it means an inbound user request, which is not an A2UI envelope.

This proposal also gives `Request` a second, precise meaning: the renderer to agent and agent to model envelopes. So after the rename, a class called `...RequestProcessor` that processes neither would mislead more than it does today.

That leaves `A2uiProcessor`. The `A2ui` prefix works here, even though the Problem section rejects it elsewhere. It is useless on envelope types because every envelope is an A2UI envelope. This is not an envelope type. It is the facade over all four, so the prefix fits it and nothing else.

The missing direction then reads as information. `AgentToRendererProcessor` handles one direction. `A2uiProcessor` handles all of them.

**`A2uiGenerator` -> unchanged:**

[`A2uiGenerator`](https://github.com/a2ui-project/a2ui/blob/main/blueprints/modules/a2ui_agent.blueprint.md#L518) is imprecise: the class generates no UI and no messages. But it is a lifecycle object, not anything on the wire, so no envelope word misleads a reader.

Renaming it would take this proposal past the payload, message and request problem it is meant to fix.

**Neither name is implemented yet:**

Both are blueprint-only, so this rename costs nothing today. It settles the vocabulary before the python agent SDK is built to the specified shape.

### Where the postfix does not fit

Three places where `Request` and `Response` do not hold up against v1.0. None of them blocks the proposal. All are worth knowing before anyone applies the postfix by hand.

v1.0 carries calls and responses in both directions. [`agent_to_renderer.json`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/agent_to_renderer.json) defines [`callRendererFunction`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/agent_to_renderer.json#L176) and [`agentFunctionResponse`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/agent_to_renderer.json#L208). [`renderer_to_agent.json`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/renderer_to_agent.json) defines [`callAgentFunction`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/renderer_to_agent.json#L56) and [`rendererFunctionResponse`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/renderer_to_agent.json#L75).

So `RendererToAgentRequest` is a request that contains [`rendererFunctionResponse`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/renderer_to_agent.json#L75). The postfix names the usual role of the direction, not the contents of every envelope in it.

The v1.0 filenames use the direction alone: `agent_to_renderer.json`, not `agent_to_renderer_response.json`. So a postfixed type name will not match the schema file it implements.

Dropping the postfix from the four union types would close that gap. It would also lose the pairing the postfix shows.

`Response` already has a meaning one level down: the result of a function call. `AgentToRendererResponse` will contain [`AgentFunctionResponseMessage`](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/json/agent_to_renderer.json#L202), where the word means something else.

### Out of scope

[`validateMessageSecurity`](https://github.com/a2ui-project/a2ui/blob/main/samples/community/client/angular/projects/mcp_calculator/src/a2ui-catalog/web-frame-messages.ts#L161), [`IncomingWebFrameMessageSchema`](https://github.com/a2ui-project/a2ui/blob/main/samples/community/client/angular/projects/mcp_calculator/src/a2ui-catalog/web-frame-messages.ts#L44) and `postMessage` in [`samples/community`](https://github.com/a2ui-project/a2ui/blob/main/samples/community) are browser `postMessage` plumbing. They have nothing to do with A2UI envelopes. The A2A SDK types (`SendMessageSuccessResponse`, `RequestContext`, `MessageSendParams`) belong to another protocol.

Protocol v0.8 is excluded. [`ServerToClientMessage`](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_8/types/types.ts#L327) and [`ClientToServerMessage`](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_8/types/client-event.ts#L43) under `renderers/*/src/v0_8/` stay as they are. The swift rows above are v0.9.1, which still uses that vocabulary.

Published schemas are excluded: [`specification/v0_9/`](https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9/json), [`specification/v0_9_1/`](https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9_1/json), and the copies each SDK keeps, such as [`renderers/web_core/src/v0_9/schemas/`](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/schemas). Renaming them would break every deployed renderer and agent. The v0.9 SDK code that reads them is still in scope.
