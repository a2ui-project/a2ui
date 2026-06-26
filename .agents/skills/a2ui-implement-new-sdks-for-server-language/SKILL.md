---
name: a2ui-implement-new-sdks-for-server-language
description: Step-by-step phased instructions for building new headless A2UI Server and Agent/Inference SDKs from scratch, utilizing CLIs and conformance suites for validation.
---

# A2UI Headless Server & Agent SDK Porting Guide

This skill provides concise instructions for porting the A2UI server or agent integration SDK to a new language from scratch. Because server environments are **headless** (lacking visual renderers), validation relies heavily on CLI tools, mock stream testing, and our centralized conformance test suite.

---

## **1. Implementation Phases**

### **Phase 1: Ingestion & Planning**
- Review `blueprints/modules/a2ui_inference.blueprint.md`.
- Select standard JSON parsing, streaming, and schema validation libraries in the target language.
- Ensure your language runtime is equipped to handle asynchronous streams (e.g. Kotlin Coroutines, Rust async/await, Java Streams).

### **Phase 2: Headless Foundation & Prompts**
- **Catalog Loader**: Implement `CatalogConfig`, `Provider`, and `A2uiCatalog` to load and represent component catalogs (typically `catalog.json` files).
- **Prompt Generator**: Implement `generateSystemPrompt`. This formats the active catalog schemas into a unified system instruction markdown block.
- **CLI Verification**: Build a lightweight Command Line Interface (CLI) utility that takes a catalog file path as input and prints the compiled system prompt to standard output. Use this to manually verify markdown and schema integrity.

### **Phase 3: Parsing, Healing & Validation**
- **LLM Parser**: Implement `parseResponse` to parse streaming text outputs from the LLM into structured updates.
- **Schema Validation**: Integrate your language's standard JSON Schema validator.
- **Unit Testing**: Write unit tests that feed incomplete or malformed JSON chunks to the parser to verify parsing resilience and error handling.

### **Phase 4: Conformance & Integration Testing**
Because there is no visual UI renderer to test against, you must verify correctness using our testing frameworks:
1.  **Centralized Conformance Tests**: Hook your SDK's parser and validator into the test runner in [agent_sdks/conformance/](file:///Users/jsimionato/development/a2ui_repos/spec-driven/A2UI/agent_sdks/conformance/). This runner executes standard YAML-based test suites to verify that your parser, stream handler, and capability negotiator produce identical results to the reference Python implementation.
2.  **CLI Test Agent**: Build a simple local CLI agent harness. This harness should:
    *   Initialize the SDK with a sample catalog (e.g. `restaurant_finder`).
    *   Connect to a mock or live LLM provider.
    *   Simulate a conversation, printing the raw outbound messages and inbound stream events directly to the console for inspection.
