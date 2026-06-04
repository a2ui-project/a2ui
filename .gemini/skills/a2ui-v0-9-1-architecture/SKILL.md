---
name: a2ui-v0-9-1-architecture
description: Provides the comprehensive A2UI (Agent to UI) Protocol v0.9.1 specification, schemas, catalogs, and renderer guides. Use this skill when making architectural designs, implementing or changing A2UI client libraries, infrastructure, or renderers for version 0.9.1 of the protocol.
---

# A2UI Protocol v0.9.1 Architecture Skill

This skill provides expert knowledge and strict specification documents to guide architectural designs, changes, or implementations for A2UI client libraries, renderers, and infrastructure targeting protocol version 0.9.1.

## MANDATORY INITIALIZATION AND FULL FILE READING PROCEDURE

> **CRITICAL MANDATE: YOU MUST READ THESE FILES IN FULL.**
> All architectural designs, implementation changes, and code reviews targeting A2UI v0.9.1 MUST be guided by the authoritative specifications. You are NOT allowed to guess, assume, or approximate protocol semantics or schema structures.

### Mandatory Reading Checklist

Before proposing any architectural design, implementing any component, writing test cases, or changing any client library or renderer, **you MUST explicitly load and read the following seven core files IN FULL**. Use a platform-appropriate file-reading tool (such as your environment's `read_file` tool, a terminal tool like `cat`, or equivalent context retrieval tool):

1. **A2UI v0.9.1 Protocol Specification**
   - **Path:** `specification/v0_9_1/docs/a2ui_protocol.md`
   - **Why it is critical to read:** This document is the **semantic foundation for the entire A2UI ecosystem**. It defines the protocol philosophy, details the four core server-to-client messages (`createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`), outlines relative/absolute pointer scopes, explains two-way binding read/write contracts, and specifies validation error and user action schemas. Read this when designing network communication, parsing streams, or testing core message handlers.
2. **Client Unified Architecture & Design Principles**
   - **Path:** `specification/v0_9_1/docs/renderer_guide.md`
   - **Why it is critical to read:** This document is **absolutely essential for state-layer development, binders, and adapters**. It contains the comprehensive, framework-agnostic client architecture—explaining the separation of concerns, concrete state models (`SurfaceModel`, `ComponentModel`, `DataModel`, `MessageProcessor`), JSON Pointer resolution mechanics (with bubble/cascade triggers), component context, and strict mounting/unmounting subscription lifecycles to prevent memory leaks. Read this before writing any code that manages UI state or reactively binds properties.
3. **Server to Client (Envelope Schema)**
   - **Path:** `specification/v0_9_1/json/server_to_client.json`
   - **Why it is critical to read:** Outlines the exact JSON schema of incoming server-to-client stream envelopes. Read this to set up JSON parsers and incoming message routing.
4. **Client to Server (Events Schema)**
   - **Path:** `specification/v0_9_1/json/client_to_server.json`
   - **Why it is critical to read:** Dictates how user-initiated `action` payloads and client-side `error` messages (such as validation failures) must be structured when sent to the server.
5. **Common Primitives Schema**
   - **Path:** `specification/v0_9_1/json/common_types.json`
   - **Why it is critical to read:** Defines the blueprint for the core dynamic types used everywhere in A2UI—including `DynamicString`, `DynamicNumber`, `DynamicBoolean`, `ChildList`, and `FunctionCall`. Read this to correctly implement generic data binding types.
6. **Client Capabilities Schema**
   - **Path:** `specification/v0_9_1/json/client_capabilities.json`
   - **Why it is critical to read:** Governs the handshake parameters, inline/external catalog listings, and supported features exchanged during transport initialization.
7. **Basic Component & Function Catalog Schema**
   - **Path:** `specification/v0_9_1/catalogs/basic/catalog.json`
   - **Why it is critical to read:** The full standard design system and function catalog. Contains all standard interactive UI components (Video, Audio, Modal, Tabs, ChoicePickers, Sliders) and registered evaluation functions (formatting, currency, logic gates, and the `formatString` parser). This is the schema to target once your core architecture successfully passes the Minimal Catalog milestone.

### Execution Policy

- **No Speculative Coding:** Do not proceed with code generation or system architecture modification without first loading the above files into your active memory context.
- **Confirm Reading:** In your very first turn after this skill is activated, you must summarize the key architectural points from these read files to confirm that you have read them in full.

## Secondary & Task-Specific Reference Material

These files are highly valuable for specific target areas, but do not need to be read in full unless your specific task targets them:

### 1. Styling & Layout Principles

- **Component & Catalog Styling Guide**
  - **Path:** `specification/v0_9_1/docs/basic_catalog_implementation_guide.md`
  - **Why it is useful:** This document is the **visual and behavioral Bible for renderer implementations**. It provides precise rules on margins, paddings, borders, alignments, and sizing constraints (such as `weight` proportions). Read this when implementing the native framework widgets (e.g., Column, Row, Button, Tabs) to ensure layouts look professional, respond correctly to resizing, and conform perfectly to the design spec.

### 2. Specialized Schemas

The following schemas under `specification/v0_9_1/json/` define specific secondary protocol interactions:

- **Server Capabilities**: `specification/v0_9_1/json/server_capabilities.json`
  - **Why it is useful:** Defines supported server features and limits during handshake setup.
- **Client Data Model Sync**: `specification/v0_9_1/json/client_data_model.json`
  - **Why it is useful:** Outlines how the client must aggregate active surface models and send them inside transport metadata when the `sendDataModel` flag is enabled.
- **List & Wrapper Schemas**: `specification/v0_9_1/json/server_to_client_list.json`, `specification/v0_9_1/json/server_to_client_list_wrapper.json`, `specification/v0_9_1/json/client_to_server_list.json`, `specification/v0_9_1/json/client_to_server_list_wrapper.json`, `specification/v0_9_1/json/sample.json`
  - **Why they are useful:** Specify the envelope formats for batch lists of messages, essential when generating mock files, stream wrappers, or test runner cases.

### 3. Bootstrap/Minimal Catalog

- **Minimal Catalog**: `specification/v0_9_1/catalogs/minimal/catalog.json`
  - **Why it is useful:** The minimal bootstrap schema containing only five core components (Text, Row, Column, Button, TextField) and one validation function (`capitalize`). **Always target this catalog first** when bootstrapping a new renderer from scratch to prove your state machine and layout loops.
