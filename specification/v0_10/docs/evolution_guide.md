# A2UI Protocol Evolution Guide: v0.9 to v1.0

This document serves as a comprehensive guide to the changes between A2UI version 0.9 (including 0.9.1) and version 1.0. It details the shifts in philosophy, architecture, and implementation, providing a reference for stakeholders and developers migrating between versions.

## 1. Executive summary

Version 1.0 differs from 0.9 in the following ways:

* A new client-to-server RPC mechanism allows synchronous responses to client actions (`actionResponse`) using a unique `actionId`.
* Server-to-client RPC function calls are supported via the `callFunction` message. Clients return execution results via the `functionResponse` message. Runtime execution boundaries can be defined in catalogs using the `callableFrom` property.
* The `theme` property in the catalog and surface creation message is replaced by `surfaceProperties`, and `primaryColor` is removed to separate layout from branding.
* Components and initial data model states can be defined directly within the `createSurface` parameters. This allows for the creation of entire UIs in a single message, rather than a create followed by separate updates.
* The `functions` field in a Catalog is now defined as a map of function name to its definition, instead of a list.
* Standard JSON Schema metadata fields (`$schema`, `$id`, `title`, and `description`) are supported in catalogs, preventing validation failures on inline catalogs with strict property checks.

## 2. Changes

### 2.1. Catalog definition schema

* Added `posterUrl` property to the `Video` component in `catalogs/basic/catalog.json`, allowing a preview image to be displayed before the video plays.
* Added `placeholder` prop to the `TextField` component schema.
* Added a `steps` property to the `Slider` component schema to snap values to discrete intervals.
* Renamed `svgPath` to `path` in the custom SVG icon definition object schema.
* Renamed the `$defs/theme` schema to `$defs/surfaceProperties` in both the basic and minimal catalogs, and removed the `primaryColor` property.
* Changed the `functions` property in the Catalog schema from a list to a map object, keyed by function name.
* Added `callableFrom` (enum: `clientOnly`, `remoteOnly`, `clientOrRemote`) to `FunctionDefinition` to restrict where a function can be invoked.
* Added an optional `instructions` field to the `Catalog` schema to embed design guidelines and component usage rules directly in the catalog, replacing the external `rules.txt` file.
* Supported standard JSON Schema metadata fields (`$schema`, `$id`, `title`, and `description`) in the Catalog object definition. Since the Catalog schema restricts properties with `additionalProperties: false`, this ensures inline catalogs containing standard schema metadata do not fail schema validation.

### 2.2. Server-to-client message list schema

* Added `ActionResponseMessage` to allow the server to respond to a specific action call using an `actionId`.
* Added `CallFunctionMessage` to support server-initiated function execution.
* Updated `CreateSurfaceMessage` to allow `components` and `dataModel` directly inside the `createSurface` parameters.
* Updated all references from version `v0.9` or `v0.9.1` to `v1.0`.

### 2.3. Client-to-server message list schema

* Added `actionId` to the `action` message properties, which the client generates if a response is expected (`wantResponse: true`).
* Added `functionResponse` message type.
* Added optional `functionCallId` to client-side `error` messages.
* Enforced mutual exclusivity of `surfaceId` and `functionCallId` in `error` payloads.
* Updated all references from version `v0.9` or `v0.9.1` to `v1.0`.

### 2.4. Client capabilities schema

* Renamed `theme` capability block to `surfaceProperties` within the Catalog definition in `client_capabilities.json`.
* Added an optional `instructions` field to the `Catalog` object definition in `client_capabilities.json` to support design principles or component rules associated with a catalog.
* Updated required capability key from `v0.9` to `v1.0`.

### 2.5. Agent card

* Standardized the official MIME type to `application/a2ui+json` to conform to IANA media type guidelines.
* Updated capabilities namespace in transport metadata and A2A metadata `params` from `v0.9`/`v0.9.1` to `v1.0`.

### 2.6. Data encoding

* Standardized data deletion behavior in `updateDataModel`. Setting a path's value to `null` deletes the key at that path. Removing or omitting keys in `updateDataModel` is no longer used for deletion.
* Removed returnType validation constraints from dynamic value schemas in `common_types.json`, deferring boundary checking to runtime execution.

### 2.7. Processing rules

* Explicitly specified that `surfaceId` must be globally unique per client session. Creating a surface with an ID that already exists (without first deleting it) is an error.
* Enforced runtime lookup of function execution boundaries. If a client receives a remote call to a function configured as `clientOnly` or if the function is unregistered, it rejects the call and returns an error with the code `INVALID_FUNCTION_CALL`.

### 2.8. Server-to-client messages

* Added `actionResponse` message structure to support synchronous responses with a `value` or `error`.
* Added `callFunction` message structure to support server-initiated function execution.
* Updated the `createSurface` message to rename the `theme` field to `surfaceProperties`, and allowed passing initial `components` and `dataModel` directly inside the payload.

### 2.9. Client-to-server events

* Updated `action` message to include `actionId`.
* Updated `Action` type in `common_types.json` to include `wantResponse` and `responsePath`.
* Removed the `returnType` property from the wire-level `FunctionCall` definition in `common_types.json`.

## 3. Migration guide

This section outlines the steps required to migrate existing applications and components from version 0.9 (including 0.9.1) to version 1.0.

### For agents and servers

* **Update version strings**: Set the `version` field in all streamed JSON envelopes to `"v1.0"`.
* **Update MIME types**: Change the MIME type of A2UI payloads in transport layers from `application/json+a2ui` to `application/a2ui+json`.
* **Update surface creation**:
  * Rename the `theme` field to `surfaceProperties` in the `createSurface` message.
  * Remove `primaryColor` from the properties object.
  * Optionally, include the initial `components` and `dataModel` directly in the `createSurface` payload instead of sending them in separate `updateComponents` and `updateDataModel` messages.
* **Update catalog definitions**:
  * Convert the `functions` property from an array of function definitions to a JSON object map, where each key is the function name.
  * Rename the `$defs/theme` definition to `$defs/surfaceProperties`, and remove the `primaryColor` field.
  * For any function that the server needs to call remotely, add the `callableFrom` metadata field set to `"remoteOnly"` or `"clientOrRemote"`. If omitted, the default is `"clientOnly"`.
* **Update components**:
  * For `Icon` components using custom paths, rename `svgPath` to `path` in the custom SVG icon definition object.
  * Update `Video` components to optionally specify `posterUrl`.
  * Update `TextField` components to optionally specify `placeholder`.
  * Update `Slider` components to optionally specify `steps`.
* **Handle data deletion**: In `updateDataModel` messages, explicitly set values to `null` to delete keys at the specified path. Do not omit keys or send undefined to indicate deletion.

### For renderers and clients

* **Implement function execution**:
  * Add support for parsing and executing `callFunction` messages.
  * Retrieve the function's boundary definition from the catalog. If `callableFrom` is `"clientOnly"` (or omitted) and the server attempts to call it, immediately reject the call and return a client-to-server `error` message with the code `"INVALID_FUNCTION_CALL"`.
  * If `wantResponse` is true, return a `functionResponse` message containing the execution result value.
* **Support synchronous action responses**:
  * When executing a component action with `wantResponse: true`, generate a unique `actionId` and send it in the client-to-server `action` message.
  * Listen for `actionResponse` messages matching the generated `actionId`. If `responsePath` is specified on the component action, write the returned value into the local data model at that JSON Pointer path.
* **Enforce surface uniqueness**: Raise an error if a `createSurface` message is received for a `surfaceId` that already exists in the current session.
* **Update error reporting**: Update the client-to-server error message parser and generator to handle `functionCallId` and enforce mutual exclusivity with `surfaceId`.
