# A2UI Protocol Evolution Guide: v0.9 to v1.0

This document serves as a comprehensive guide to the changes between A2UI version 0.9 (including 0.9.1) and version 1.0. It details the shifts in philosophy, architecture, and implementation, providing a reference for stakeholders and developers migrating between versions.

## 1. Executive summary

Version 1.0 differs from 0.9 in the following ways:

- Bidirectional RPC function calls are supported via explicit role-based messages: `callRendererFunction` for agent-initiated calls on the renderer (returning `rendererFunctionResponse`), and `callAgentFunction` for renderer-initiated calls on the agent (returning `agentFunctionResponse`). Execution results or errors are returned via shared `FunctionResponse` payloads. Runtime authorized callers (`allowedCallers`) and return types are defined in catalogs and verified at runtime.
- Catalogs can now be mixed within a single UI surface. Advertised `supportedCatalogIds` are mixable, allowing UI trees to combine components and functions from multiple catalogs simultaneously.
- Added `$defs/FunctionCommon` in `common_types.json` composed at the envelope level via `FunctionCall` for function-level catalog overrides, matching the `ComponentCommon` pattern.
- Added an optional `catalogId` property to `ComponentCommon` and `FunctionCall` to allow individual components and function calls to explicitly declare their source catalog.
- Retained `catalogId` on `createSurface` as an optional parameter that defines the default catalog for that surface.
- Added extensibility metadata support via `$defs/Extensions` in `common_types.json`, allowing `ComponentCommon`, `createSurface`, and `ComponentDefinition` to convey arbitrary extension key-value pairs (with Unicode UAX #31 keys and reserved `a2ui_` namespace).
- Defined explicit component and function call resolution logic: the renderer checks the component-level (or function call-level) `catalogId` first, then falls back to the surface default `catalogId`. If neither is defined, the renderer errors out and does not render the component (or rejects the function call). There is no fallback to catalogs declared in capabilities. Available catalogs for a surface include both `supportedCatalogIds` and any negotiated `inlineCatalogs`, and all mixed catalogs must use the same A2UI specification version.
- The `theme` property in the catalog and surface creation message is removed, along with `primaryColor`, to separate layout from branding.
- Components and initial data model states can be defined directly within the `createSurface` parameters. This allows for the creation of entire UIs in a single message, rather than a create followed by separate updates.
- The `functions` field in catalog meta-schemas (`catalog_definition.json`) is now formalized as a JSON object map of function name to its definition, matching the map structure used in catalog files.
- Standard JSON Schema metadata fields (`$schema`, `$id`, `title`, and `description`) are supported in catalogs, preventing validation failures on inline catalogs with strict property checks.
- Identifier naming rules across all catalog entities (component names, function names, and argument keys) must conform to Unicode Standard Annex #31 (UAX #31).
- The `@index` built-in function dynamically retrieves iteration indices during list template rendering. The `@` prefix is reserved for core system context evaluations.
- Standardized the names of core architectural components, renaming "client" to _renderer_ and "server" to _agent_ (e.g., `server_to_client` schemas are renamed to `agent_to_renderer`), because A2UI is sometimes generated on clients, and rendering sometimes happens on servers, making those terms ambiguous.
- Catalogs can now define composition constraints (`allowedParents` and `allowedChildren`) on component definitions, using `"Surface"` as the canonical root component type. Because JSON Schema cannot natively restrict child component types across a flat adjacency list of ID references, these rules allow catalogs to declare valid parent-child relationships without altering the wire format.
- `CheckRule` in `common_types.json` supports dynamic structured validation result objects (`ValidationResult`) returned directly by function evaluations or data bindings (containing `valid`, `code`, `message`, and `severity`), and `message` on `CheckRule` is made optional as a fallback error message.
- Enhanced `AccessibilityAttributes` in `common_types.json` with WAI-ARIA `live` region support (`"off"`, `"polite"`, `"assertive"`) and `hidden` (`DynamicBoolean`), while setting `"additionalProperties": false`. Established normative specification prose requiring catalog and renderer implementations to plumb accessibility attributes, infer default screen reader semantics from visible text properties, and enforce SDK linter checks.

## 2. Changes

### 2.1. Catalog definition schema

- Removed the `$defs/theme` schema and the `primaryColor` property from the Catalog schema.
- Formalized the `functions` property in `catalog_definition.json` as a map object, keyed by function name.
- Added `allowedCallers` (enum: `rendererOnly`, `agentOnly`, `rendererOrAgent`, default: `rendererOnly`) to `FunctionDefinition` to restrict which roles can invoke a function.
- Added `requiresUserActivation` (boolean, default: `false`) to `FunctionDefinition` to declare if a function requires user gesture/activation context to execute, conditionally restricting `allowedCallers` to `rendererOnly`.
- Added `$defs/ValidationResult` schema (`valid`, `code`, `message`, `severity`) as the standard schema definition for validation function return payloads.
- Added an optional `instructions` field to the `Catalog` schema to embed design guidelines and component usage rules directly in the catalog, replacing the external `rules.txt` file.
- Supported standard JSON Schema metadata fields (`$schema`, `$id`, `title`, and `description`) in the Catalog object definition. Since the Catalog schema restricts properties with `additionalProperties: false`, this ensures inline catalogs containing standard schema metadata do not fail schema validation.
- Added a `protocolVersion` field (e.g., `"protocolVersion": "1.0"`) to catalog definition metadata (`catalog_definition.json`). If omitted, `protocolVersion` defaults to `"0.9"` for backward compatibility; catalog definitions targeting `1.0` and beyond MUST specify `"protocolVersion"`.
- Enforced Unicode Standard Annex #31 (UAX #31) identifier naming constraints (`XID_Start`, `XID_Continue`) across component names, function names, and argument keys.
- Added optional `allowedParents` and `allowedChildren` properties to catalog component definitions (`catalog_definition.json`) to define parent-child composition constraints. Because JSON Schema cannot natively restrict child component types across a flat adjacency list of ID references, these rules allow catalogs to declare valid component relationships.
- Added `"propertyNames": { "not": { "const": "Surface" } }` to the `components` map in `catalog_definition.json` to enforce reserving `"Surface"` at the schema validation level.
- Added the canonical `"Surface"` container component type in `common_types.json` to represent the top-level container of a surface for `"allowedParents": ["Surface"]` rules. The protocol reserves the `"Surface"` component name. The `createSurface` message implicitly creates `Surface` with `"child": "root"`, and you cannot modify `Surface` using `updateComponents`. These schema additions are catalog-level metadata and do not alter the wire format of component instances in `createSurface` or `updateComponents`.
- Added static `metadata` (containing `extensions`) property to `ComponentDefinition` inside `catalog_definition.json`.

### 2.2. Standard catalogs (basic)

- Added `posterUrl` property to the `Video` component in `catalogs/basic/catalog.json`, allowing a preview image to be displayed before the video plays.
- Added `placeholder` prop to the `TextField` component schema.
- Added a `steps` property to the `Slider` component schema to snap values to discrete intervals.
- Updated `openUrl` function definition in `catalogs/basic/catalog.json` to set `"requiresUserActivation": true`.
- Refactored component definitions in `catalogs/basic/catalog.json` from `allOf: [ComponentCommon, ...]` and `unevaluatedProperties: false` to direct explicit property definitions (including explicit `component` const and `weight` props) or `$defs/Checkable`.
- Added an optional `instructions` field to the `Catalog` schema (`catalogs/basic/catalog.json`) to embed Markdown guidelines/rules directly, replacing the external `rules.txt` file.
- Updated return types on standard validation check functions (`required`, `regex`, `length`, `numeric`, `email`) in `catalogs/basic/catalog.json` from `"boolean"` to `"validationResult"`.
- Removed `$defs/theme` from the basic catalog.

### 2.3. Agent-to-renderer messages

- Replaced `callFunction` with `callRendererFunction` message structure (`CallRendererFunctionMessage`) to support agent-to-renderer function execution requests.
- Added `agentFunctionResponse` message structure (`AgentFunctionResponseMessage`) to `agent_to_renderer.json` so agents can return execution results or error payloads for renderer-initiated function calls (referencing `common_types.json#/$defs/FunctionResponse`).
- Updated the `createSurface` message (`CreateSurfaceMessage`) to remove the `theme` field, allowed passing initial `components` and `dataModel` directly inside the payload, made `catalogId` an optional parameter that acts as the surface's default catalog, and added optional surface-level `metadata` (containing `extensions`).
- Added an optional `catalogId` property to `ComponentCommon` and `FunctionCall` in `common_types.json` to enable mixing catalogs and explicitly designating the catalog on individual components or function calls.
- Added `$defs/Extensions` to `common_types.json` and added optional `metadata` (containing `extensions`, `$ref: "#/$defs/Extensions"`) to `ComponentCommon`.
- Added `$defs/Child` (`"$ref": "#/$defs/ComponentId"`), `$defs/FunctionCommon`, and `$defs/IndexSystemFunction` to `common_types.json`.
- Added the `Component` definition in `agent_to_renderer.json` (referenced by `ComponentsList`) to compose `ComponentCommon` (`$ref: "common_types.json#/$defs/ComponentCommon"`) and updated `FunctionCall` in `common_types.json` to compose `FunctionCommon` (`$ref: "#/$defs/FunctionCommon"`), so base component and function call properties are validated at the envelope level regardless of catalog structure.
- Updated all protocol version references and envelopes from `v0.9` or `v0.9.1` to `v1.0`.

### 2.4. Renderer-to-agent events

- Added `callAgentFunction` message structure to support renderer-initiated remote function execution requests sent to the agent.
- Added `rendererFunctionResponse` renderer-to-agent message structure to return function execution results (`value`) or failure payloads (`error`), referencing `common_types.json#/$defs/FunctionResponse`.
- Updated renderer `error` messages to support `functionCallId` when reporting function execution failures, enforcing mutual exclusivity with `surfaceId`.
- Added `"UNALLOWED_PARENT"` and `"UNALLOWED_CHILD"` error code values to `renderer_to_agent.json` for reporting validation errors when a component is placed under an unallowed parent or an unallowed child is placed inside a container.
- Updated all protocol version references from `v0.9` or `v0.9.1` to `v1.0`.

### 2.5. Agent card and transport metadata

- Standardized the official MIME type to `application/a2ui+json` to conform to IANA media type guidelines.
- Updated capabilities namespace in transport metadata and A2A metadata parameters from `v0.9`/`v0.9.1` to `v1.0`.
- Clarified that `supportedCatalogIds` in `rendererCapabilities` and `agentCapabilities` are mixable within a single UI surface.
- Simplified `renderer_capabilities.json` by removing local inline catalog `$defs` (`Catalog`, `FunctionDefinition`) and replacing `inlineCatalogs` items with a direct `$ref` to `https://a2ui.org/specification/v1_0/catalog_definition.json`.
- Relocated extension specification from `v0_9_1/docs/a2ui_extension_specification.md` to `v1_0/extensions/a2a/docs/a2ui_extension_specification.md`.

### 2.6. Data encoding

- Standardized data deletion behavior in `updateDataModel` by making the `value` property required. Setting a path's value to `null` deletes the key at that path. Omitting the `value` property is now a schema validation error.
- Removed `allowedCallers` and `returnType` properties and validation constraints from `FunctionCall` and dynamic value schemas in `common_types.json`, deferring boundary checking and return type validation entirely to runtime execution.
- Added built-in `@index` function (with optional `offset` parameter) under `FunctionCall` to retrieve the iteration index during list template rendering. Reserved the `@` prefix for core system context evaluations.
- Updated `CheckRule` in `common_types.json` to support dynamic `ValidationResult` objects returned directly by function evaluations or data model bindings, adding the `$defs/ValidationResult` schema (`valid`, `code`, `message`, `severity`) and making `CheckRule.message` optional as a fallback message.

### 2.7. Processing rules

- Defined strict component and function catalog resolution logic:
  1. Check the component's (or function call's) explicit `catalogId`.
  2. If not present, check the surface's default `catalogId` provided in `createSurface`.
  3. If neither exists, report an error and do not render the component (or fail the function call). There is no fallback to catalogs advertised in capabilities. Available catalogs include `supportedCatalogIds` and negotiated `inlineCatalogs`, and all mixed catalogs must use the same A2UI specification version.
- Explicitly specified that `surfaceId` must be globally unique per renderer session. Creating a surface with an ID that already exists (without first deleting it) is an error.
- Enforced runtime lookup of function execution boundaries and return types. If a renderer receives a remote call to a function configured as `rendererOnly` or if the function is unregistered, it rejects the call and returns an error with the code `INVALID_FUNCTION_CALL`.
- Enforced catalog entity naming compliance with Unicode Standard Annex #31 (UAX #31).
- Restricted `@index` evaluation scope strictly to template instantiation loops (Collection Scope). Calling `@index` outside of template iteration results in an evaluation error.

### 2.8. Terminology standardization

- Renamed **client** to **renderer** and **server** to **agent** globally across all protocol schemas, capabilities, and message list definitions.
- Renamed all client-to-server and server-to-client JSON schema files to use renderer/agent filenames:
  - `server_to_client.json` -> `agent_to_renderer.json`
  - `client_to_server.json` -> `renderer_to_agent.json`
  - `client_capabilities.json` -> `renderer_capabilities.json`
  - `server_capabilities.json` -> `agent_capabilities.json`
  - `client_data_model.json` -> `renderer_data_model.json`
- Renamed batch message list and list wrapper schema files:
  - `server_to_client_list.json` -> `agent_to_renderer_list.json`
  - `server_to_client_list_wrapper.json` -> `agent_to_renderer_list_wrapper.json`
  - `client_to_server_list.json` -> `renderer_to_agent_list.json`
  - `client_to_server_list_wrapper.json` -> `renderer_to_agent_list_wrapper.json`

## 3. Migration guide

This section outlines the steps required to migrate existing applications and components from version 0.9 (including 0.9.1) to version 1.0.

### For agents

- Set the `version` field in all streamed JSON envelopes to `"v1.0"`.
- Change the MIME type of A2UI payloads in transport layers from `application/json+a2ui` to `application/a2ui+json`.
- Remove the `theme` field from `createSurface` messages. You can pass initial `components`, `dataModel`, and optional `metadata.extensions` directly in the `createSurface` payload, and `catalogId` is now optional (acting as the default catalog for that surface).
- When mixing components from multiple catalogs, specify the optional `catalogId` on individual components or function calls.
- Formalize the `functions` property in catalog definitions as a JSON object map keyed by function name.
- Remove the `$defs/theme` catalog definition and the `primaryColor` field.
- Ensure all generated catalog entity names conform to UAX #31 identifier rules.
- Do not include `allowedCallers` or `returnType` properties in wire-level `FunctionCall` payloads. Set static `allowedCallers`, `returnType`, and optional `requiresUserActivation` metadata in catalog function definitions where needed.
- Update `Video`, `TextField`, and `Slider` components to support optional `posterUrl`, `placeholder`, and `steps` properties. Update `openUrl` functions to specify `"requiresUserActivation": true`.
- Explicitly set values to `null` in `updateDataModel` messages to delete keys at specified paths. The `value` property is now required, and omitting it is a schema validation error.
- Handle remote function execution requests from renderers (`callAgentFunction`) and respond with `agentFunctionResponse` messages.
- Rename all references, constants, and endpoints mapping to `server_to_client.json` or `server_capabilities.json` to use `agent_to_renderer.json` and `agent_capabilities.json`.

### For renderers

- Implement multi-catalog mixing by supporting components and function calls from any catalog in `supportedCatalogIds` or negotiated `inlineCatalogs`. All catalogs mixed within a surface must use the same A2UI specification version.
- Implement component and function resolution order: (1) explicit component/call `catalogId`, (2) surface default `catalogId`, (3) error if neither exists (no fallback to capabilities).
- Implement function execution by adding support for parsing `callRendererFunction` messages from the agent, checking authorized callers in the catalog (`allowedCallers`), rejecting invalid calls with `INVALID_FUNCTION_CALL`, and returning `rendererFunctionResponse` messages.
- Implement renderer-initiated function calls by sending `callAgentFunction` messages to the agent and handling incoming `agentFunctionResponse` messages.
- Support simultaneous version handling during session initialization by inspecting the `version` property (e.g., `"v1.0"`) to route payloads to version-specific controllers.
- Enforce surface uniqueness by raising an error if `createSurface` is received for an existing `surfaceId`.
- Update error reporting to handle `functionCallId` and enforce mutual exclusivity with `surfaceId`.
- Enforce Unicode identifier naming by verifying that all catalog entity names (components, functions, prop keys) conform to UAX #31 identifier rules.
- Support built-in `@index` evaluation during list template rendering (Collection Scope) to provide the 0-based iteration index, adjusted by any `offset` parameter.
- Support dynamic `ValidationResult` objects (`valid`, `code`, `message`, `severity`) returned by component validation check conditions, falling back to static `CheckRule.message` if present.
- Rename all references, constants, and endpoints mapping to `client_to_server.json` or `client_capabilities.json` to use `renderer_to_agent.json` and `renderer_capabilities.json`.
