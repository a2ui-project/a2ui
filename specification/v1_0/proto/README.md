# A2UI Protocol v1.0 Protobuf Specifications

This directory contains the Protocol Buffers (Protobuf) schema definitions for version 1.0 of the A2UI (Agent-to-UI) protocol. These definitions conform to the Protobuf Editions specification (`edition = "2023"`).

## Overview

The Protobuf schemas provide strongly-typed, cross-language definitions mirroring the canonical JSON schemas in `../json`.

### Protobuf Schema Files

- [`common_types.proto`](common_types.proto): Core primitive types used throughout the protocol, including dynamic values (`DynamicString`, `DynamicNumber`, `DynamicBoolean`, `DynamicStringList`), data bindings (`DataBinding`), function invocations (`FunctionCall`), child references (`ChildList`), accessibility attributes (`AccessibilityAttributes`), and actions (`Action`).
- [`agent_to_renderer.proto`](agent_to_renderer.proto): Envelope messages sent from the agent to the renderer (`CreateSurfaceMessage`, `UpdateComponentsMessage`, `UpdateDataModelMessage`, `DeleteSurfaceMessage`, `CallRendererFunctionMessage`, `AgentFunctionResponseMessage`).
- [`agent_to_renderer_list.proto`](agent_to_renderer_list.proto): Array/list message container for sequences of Agent-to-Renderer messages.
- [`agent_to_renderer_list_wrapper.proto`](agent_to_renderer_list_wrapper.proto): Top-level wrapper object enclosing an `AgentToRendererMessageList`.
- [`renderer_to_agent.proto`](renderer_to_agent.proto): Event and error messages sent from the renderer back to the agent (`ActionEventMessage`, `CallAgentFunctionMessage`, `RendererFunctionResponseMessage`, `RendererErrorMessage`).
- [`renderer_to_agent_list.proto`](renderer_to_agent_list.proto): Array/list message container for sequences of Renderer-to-Agent messages.
- [`renderer_to_agent_list_wrapper.proto`](renderer_to_agent_list_wrapper.proto): Top-level wrapper object enclosing a `RendererToAgentMessageList`.
- [`catalog_definition.proto`](catalog_definition.proto): Metadata and structural definitions for UI component and function catalogs (`CatalogDefinition`, `ComponentDefinition`, `FunctionDefinition`, `ValidationResult`).
- [`agent_capabilities.proto`](agent_capabilities.proto): Capability negotiation payload advertising an agent's supported catalogs and inline catalog support.
- [`renderer_capabilities.proto`](renderer_capabilities.proto): Capability negotiation payload advertising a renderer's supported catalogs and inline catalog definitions.
- [`renderer_data_model.proto`](renderer_data_model.proto): Full data model state representation for active surfaces used during state synchronization.
- [`sample.proto`](sample.proto): Self-contained UI sample demonstration schema.

## Compiling Protobuf Definitions

To compile the Protobuf definitions using `protoc`:

```bash
protoc --proto_path=specification/v1_0/proto specification/v1_0/proto/*.proto
```
