# Pull Request: Refactor FunctionCall wire schema and align protocol specification

This pull request refactors the `FunctionCall` schema definition in the A2UI v0.10 specification to completely remove the redundant `callableFrom` and `returnType` properties from the wire-level payload. Enforcements and validations (such as execution boundaries and return type correctness) are moved entirely to client-side runtime verification against catalog registries rather than being validated on the wire.

Additionally, this pull request adds support for static `callableFrom` and `returnType` metadata inside the client capabilities catalog definition schema, aligns the official protocol documentation (`a2ui_protocol.md`) with all updated schemas, and comprehensively updates all test cases, JSONL streams, and basic catalog examples to remove these obsolete wire-level fields.

## Detailed changes

### Schemas

- **`common_types.json`**:
  - Removed the `callableFrom` and `returnType` properties from the core `FunctionCall` schema definition.
  - Removed static `returnType` constraints from `DynamicString`, `DynamicNumber`, `DynamicBoolean`, and `DynamicStringList` schema unions so they accept any `FunctionCall` on the wire and rely on client-side runtime type checking.
- **`server_to_client.json`**: Simplified the `CallFunctionMessage` payload's `callFunction` property, removing both `callableFrom` and `returnType` overrides and required constraints.
- **`testing_catalog.json` & `catalogs/minimal/catalog.json` & `catalogs/basic/catalog.json`**: Removed the `callableFrom` and `returnType` property definitions from catalog function schemas, keeping them strictly as validators for wire payloads.
- **`client_capabilities.json`**: Declared static `callableFrom` and `returnType` properties inside the `$defs/FunctionDefinition` catalog schema. This allows clients to statically advertise their custom functions' boundaries and return types to the server as metadata, separate from the wire payload.

### Test cases and Examples

- **Test Suites (`cases/*.json`, `cases/*.jsonl`)**: Performed an automated smart cleanup of positive and unrelated test payloads across all test cases (e.g., `checkable_components.json`, `button_checks.json`, `call_function_message.json`, `function_catalog_validation.json`) to strip `returnType` and `callableFrom` fields, while preserving their values in dedicated negative tests checking for schema rejection of unknown properties.
- **Catalog Examples (`catalogs/basic/examples/*.json`)**: Cleaned up all 36 basic catalog examples to strip the obsolete wire-level `returnType` field from their function call declarations.

### Documentation (`a2ui_protocol.md`)

- **`callFunction` specifications**: Aligned the `callFunction` property documentation and examples to remove wire-level `returnType` properties and updated the JSONL stream example.
- **Server-to-client envelopes**: Aligned the introductory list under `## Envelope message structure` to include the `callFunction` key. Added a new section detailing the `callFunction` message, its properties, and payload examples. Clarified how the client runtime extracts the `callableFrom` configuration from catalog definitions/annotations (defaulting to `"clientOnly"`).
- **Client-to-server event messages**: Restructured and expanded the documentation for client events. Fully detailed the property lists, mutual exclusion rules, and JSON examples for `action` events (including `wantResponse` and `actionId`), `functionResponse` execution results, and client `error` messages.
- **Capabilities and metadata**: Promoted transport-level capability and data model exchanges to a dedicated section. Aligned the documented properties of `server_capabilities.json`, `client_capabilities.json`, and `client_data_model.json` to correctly describe version-wrapped objects (`"v0.10"`) and the required `"version"` property. Documented that custom inline catalog function definitions support static `callableFrom` and `returnType` metadata to advertise function execution details.

## Verification results

All 107 test cases in the A2UI v0.10 schema validation suite pass successfully. The automated tests validated the modified JSON schemas against the updated test files under `/specification/v0_10/test/cases/`.
