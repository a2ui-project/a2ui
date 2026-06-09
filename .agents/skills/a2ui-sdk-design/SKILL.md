---
name: a2ui-sdk-design
description: Provides guidelines and design principles for implementing, expanding, or modifying A2UI client libraries, SDK adapters, and backend integrations across different protocol versions.
---

# A2UI SDK & Adapter Design Skill

This skill provides architectural guidance for developing or modifying A2UI client libraries, SDK adapters, state layers, and communication infrastructure across all protocol versions.

## Specifications Navigation

The repository supports multiple versions under the `specification/` folder:

- **Navigation:** Navigate to the relevant version folder (e.g., `specification/v0_9_1/`). Use your file system tools to explore it dynamically; do not hardcode active schemas.

### Critical Sources of Truth

For the targeted version, analyze these core files to inform your design, typically reading each file _in full_:

1. **JSON Schemas (`json/*.json`)**: Absolute authority for message format compliance. Check `server_to_client.json` for stream envelopes, `client_to_server.json` for action events, and `common_types.json` for dynamic binding primitives and other schema `$defs`.
2. **Component & Function Catalogs (`catalogs/<catalog-name>/catalog.json`)**: Authoritative definitions of supported visual components and registered evaluation/validation functions.
3. **Protocol Semantics (`docs/a2ui_protocol.md`)**: Semantic foundation covering message stream structures, pointer scopes, and two-way binding agreements.
4. **SDK APIs and architecture design (`docs/renderer_guide.md`)**: Required mechanics for state layer separation, reactive models, and component subscription lifecycles to prevent memory leaks.
