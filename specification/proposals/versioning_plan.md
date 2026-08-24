# A2UI Protocol Versioning and Compatibility Plan: Analysis & Proposed Changes

**Author:** AI Agent (Pair Programming with jsimionato@)  
**Date:** August 21, 2026  
**Status:** Draft Proposal Analysis  
**Target Document:** `A2UI Versioning and Compatibility` Design Proposal

---

## 1. Executive Summary & Overview

This document provides a comprehensive technical analysis of the proposed **A2UI Versioning and Compatibility** design. It evaluates the proposal against the **A2UI v1.0 Specification** (`specification/v1_0/`) and the three primary module blueprints:
- [A2UI Core SDK Blueprint](../../blueprints/modules/a2ui_core.blueprint.md) (`a2ui_core`)
- [A2UI Agent SDK Blueprint](../../blueprints/modules/a2ui_agent.blueprint.md) (`a2ui_agent`)
- [A2UI Framework Adapter Blueprint](../../blueprints/modules/a2ui_framework_adapter.blueprint.md) (`a2ui_framework_adapter`)

The central design premise—**independent wire protocol versions mapping to a universal in-memory representation in the SDK layer**—is architecturally sound and aligns with modern multi-platform SDK principles. However, executing this vision requires resolving critical edge cases, updating inconsistent schemas and blueprints, and addressing non-trivial implementation challenges.

---

## 2. Analysis of the Proposal Document

### 2.1. What Doesn't Make Sense / Logic & Text Flaws

1. **Duplicated & Garbled Draft Text (Copy-Paste Error)**:
   - *Location*: Section **Properties -> Enough compatibility between agents and client for common use cases**.
   - *Issue*: The section contains an unformatted, duplicated block of text:
     > *"We expect agents and clients to Catalogs can be used with different protocol versions for which they were originally written This is important for developer ergonomics..."*
   - *Fix*: Remove the duplicate paragraph and format the bullet points clearly.

2. **Hypothetical Version References ("protocol v2", "protocol v3")**:
   - *Location*: Section **Properties -> Surfaces can be updated with messages from different protocol versions**.
   - *Issue*: The document references `"messages from protocol v2 can be updated with messages using protocol v3"`. Given that active protocol versions in the repository are `v0.8`, `v0.9`, `v0.9.1`, and `v1.0`, referencing v2/v3 without context creates confusion about current vs. future protocol scopes.
   - *Fix*: Frame examples using current concrete version transitions (e.g. upgrading a surface from `v0.9` to `v1.0`) while explicitly noting v2/v3 as hypothetical future versions.

3. **Protocol Version Deadlock on Cross-Version Surface Updates**:
   - *Location*: Section **Configurable upstream event format -> RendererToAgent messages** & **Surfaces can be updated with messages from different protocol versions**.
   - *Issue*: The proposal states that `SurfaceModel.initialProtocolVersion` is set by `createSurface` (e.g. `v0.9`), while `rendererToAgentProtocolVersion` defaults to `initialProtocolVersion`. It then permits updating that surface with messages from a newer protocol version (e.g. `v1.0`).
   - *The Deadlock*: Suppose an agent sends a `v1.0` `updateComponents` message (or a `v1.0` `callRendererFunction` message) to a surface created with `v0.9`. 
     - If `rendererToAgentProtocolVersion` remains locked at `v0.9`, how does the client respond to `callRendererFunction` when `v0.9` `RendererToAgent` has **no** `rendererFunctionResponse` message type?
     - If `rendererToAgentProtocolVersion` automatically upgrades to `v1.0`, but the backend agent is a legacy agent expecting `v0.9` `action` payloads, the agent's parser will reject the `v1.0` action envelope!
   - *Fix*: The proposal must clarify the negotiation rules for cross-version updates. A renderer should only accept cross-version updates if the resulting upstream messages can be encoded in a format mutually understood by both client and server agent.

4. **Ambiguity in Catalog Versioning vs. Catalog Format Versioning**:
   - *Location*: Section **Catalogs are versioned independently of protocol versions**.
   - *Issue*: The proposal states: *"Catalogs API JSON documents are expressed in a particular catalog description version. But each catalog has its own versioning scheme which is independent of the protocol version."* However, `catalog_definition.json` in v1.0 includes a top-level `"protocolVersion"` field.
   - *Fix*: Disambiguate **Catalog Data Schema Version** (the format of the catalog JSON file itself, e.g., v0.9 array-based functions vs v1.0 map-based functions) from **Catalog Identity Version** (e.g., `Material_v5`). The SDK in-memory layer must normalize different catalog JSON file formats into a universal `Catalog` model.

---

### 2.2. What Is Hard to Implement

1. **Universal In-Memory Model Normalization**:
   - The SDK's in-memory model (`SurfaceModel`, `ComponentModel`, `DataModel`, `Catalog`) must represent the strict **superset** of all supported protocol versions:
     - `createSurface`: Legacy `theme` dictionary (v0.8/v0.9) vs embedded initial `components` and `dataModel` (v1.0).
     - Component envelope: Baseline envelope properties vs v1.0 `allowedParents` / `allowedChildren`.
     - Functions: Array-based representation (v0.9) vs Map-based dictionary (v1.0), plus v1.0 fields (`allowedCallers`, `requiresUserActivation`).
   - *Challenge*: The `MessageProcessor` and `VersionAdapter` pipeline must perform robust normalization during parsing while retaining structural rules so that validation checks (e.g. rejecting `theme` in a `v1.0` `createSurface` payload) remain strict per protocol version.

2. **Multi-Version Capability Payload Export**:
   - The proposal requires `MessageProcessor.getRendererCapabilities()` to emit a map containing capabilities across all versions in `clientCapabilitiesProtocolVersions` simultaneously:
     ```json
     {
       "v0.9": { "supportedCatalogIds": ["cat_1"] },
       "v1.0": { "supportedCatalogIds": ["cat_1"], "inlineCatalogs": [...] }
     }
     ```
   - *Challenge*: Exporting `inlineCatalogs` for `v0.9` requires generating JSON Schemas conforming to v0.9 catalog structure (array-based functions), while `v1.0` requires exporting maps conforming to `catalog_definition.json` (v1.0). `getRendererCapabilities()` must incorporate version-aware catalog serializers.

3. **Lossy Conversion Functions**:
   - Implementing bi-directional JSON-to-JSON lossy converters between non-adjacent major versions (e.g., `v1.0` <-> `v0.8`/`v0.9`) requires heuristics for dropped capabilities:
     - `callRendererFunction` (v1.0) has no equivalent in v0.9 -> Must be dropped or transformed into a fallback state update.
     - Embedded `components` in `v1.0` `createSurface` -> Must be unrolled into discrete `createSurface` + `updateComponents` + `updateDataModel` messages for v0.8/v0.9.

---

### 2.3. Inconsistencies with Existing Specification & Blueprints

| Location | Existing Design | Proposed Change | Required Update |
| :--- | :--- | :--- | :--- |
| **`specification/v1_0/json/renderer_capabilities.json`** | Hardcodes top-level `"v1.0"` property as `required: ["v1.0"]`. | Supports multiple version keys (e.g. `"v0.9"`, `"v1.0"`) in parallel. | Relax JSON schema to allow pattern properties (`^v[0-9]+\\.[0-9]+`) for version keys. |
| **`a2ui_core.blueprint.md` (`Catalog`)** | `Catalog` interface binds `readonly protocolVersion: A2uiProtocolVersion`. | Catalogs decoupled from single protocol version. | Update `Catalog` interface to allow multi-version compatibility or load-time adaptation. |
| **`a2ui_core.blueprint.md` (`SurfaceModel`)** | `SurfaceModel` has `id`, `catalog`, `dataModel`, `componentsModel`, `theme`, `sendDataModel`. | Tracks `initialProtocolVersion` and mutable `rendererToAgentProtocolVersion`. | Add `initialProtocolVersion` and `rendererToAgentProtocolVersion` to `SurfaceModel`. |
| **`a2ui_core.blueprint.md` (`MessageProcessor`)** | `constructor(catalogs, actionHandler)` without multi-version config. | Configurable `clientCapabilitiesProtocolVersions`. | Add `clientCapabilitiesProtocolVersions` to `MessageProcessor` options. |
| **`a2ui_agent.blueprint.md` (`CatalogProvider`)** | `BundledCatalogProvider` & `FileSystemCatalogProvider` enforce strict `protocol_version` check on load. | Catalogs loaded independently of protocol version. | Update providers to adapt catalog file formats into normalized `Catalog` models. |
| **`a2ui_agent.blueprint.md` (`resolve_catalogs`)** | Assumes single-version `RendererCapabilities`. | Handles multi-version `RendererCapabilities` map. | Update catalog resolution logic to select highest mutually supported version. |
| **`specification/v1_0/docs/a2ui_protocol.md`** | Assumes single protocol version per surface session. | Details SemVer rules (branch only for major), surface updates across versions, and multi-version capabilities. | Update documentation sections on Protocol Versioning, Capabilities, and Envelope Messages. |

---

## 3. Concrete Proposed Changes

### 3.1. Changes to Specification (`specification/v1_0/`)

1. **Update `specification/v1_0/json/renderer_capabilities.json`**:
   - Replace rigid `"required": ["v1.0"]` with pattern properties or optional multi-version map entries (`v0.9`, `v0.9.1`, `v1.0`, etc.):
   ```json
   {
     "$schema": "https://json-schema.org/draft/2020-12/schema",
     "$id": "https://a2ui.org/specification/v1_0/renderer_capabilities.json",
     "title": "A2UI Renderer Capabilities Schema",
     "type": "object",
     "additionalProperties": {
       "type": "object",
       "properties": {
         "supportedCatalogIds": {
           "type": "array",
           "items": {"type": "string"}
         },
         "inlineCatalogs": {
           "type": "array",
           "items": {
             "$ref": "https://a2ui.org/specification/v1_0/catalog_definition.json"
           }
         }
       },
       "required": ["supportedCatalogIds"]
     }
   }
   ```

2. **Update `specification/v1_0/docs/a2ui_protocol.md`**:
   - **Section: Versioning & Compatibility**: Document the SemVer policy:
     - **Major Version Bumps**: Create a new version directory (e.g., `specification/v2_0/`).
     - **Minor & Patch Bumps**: Updated inline within existing version directory (`specification/v1_0/`) with a Changelog section appended at the end. Branching directories for minor/patch releases (like `v0_9_1`) is explicitly deprecated.
   - **Section: Surface Lifecycle & Protocol Versioning**: Define rules for multi-version surface updates and upstream event encoding.

---

### 3.2. Changes to Blueprints (`blueprints/modules/`)

#### 1. `blueprints/modules/a2ui_core.blueprint.md`:
- **Section 2 & 3.A (Catalog Layer)**: Update `Catalog` definition to reflect load-time format adaptation and decouple identity from transport versioning.
- **Section 3.B (Processing Layer)**:
  - Add `initialProtocolVersion` (readonly) and `rendererToAgentProtocolVersion` (mutable) to `SurfaceModel`.
  - Update `MessageProcessor` interface to accept `clientCapabilitiesProtocolVersions: A2uiProtocolVersion[]`.
  - Update `getRendererCapabilities()` signature and behavior to return multi-version capabilities dictionaries.
  - Document `VersionAdapter` normalization and strict per-version validation rules in `A2uiValidator`.

#### 2. `blueprints/modules/a2ui_agent.blueprint.md`:
- **Section 3.F (Catalog Providers)**: Update `CatalogProvider` subclasses (`BundledCatalogProvider`, `FileSystemCatalogProvider`, `InMemoryCatalogProvider`) to load and normalize catalog files of any schema format version into the universal `Catalog` model.
- **Section 3.G (Utility Helpers)**: Update `resolve_catalogs()` to parse multi-version `RendererCapabilities` maps, select the highest mutually supported protocol version, and return active negotiated catalogs.

#### 3. `blueprints/modules/a2ui_framework_adapter.blueprint.md`:
- **Section 2 & 5 (View-Layer & Lifecycles)**: Update `Surface` framework entry view to respect `rendererToAgentProtocolVersion` when dispatching actions and handling component events across message updates.

---

### 3.3. Changes to Codebases (`renderers/`, `agent_sdks/`)

1. **`renderers/web_core/` (Core Web SDK)**:
   - Implement `VersionAdapter` factory supporting `v0.8`, `v0.9`, `v0.9.1`, and `v1.0`.
   - Update `SurfaceModel` to hold `initialProtocolVersion` and `rendererToAgentProtocolVersion`.
   - Update `MessageProcessor.getRendererCapabilities()` to construct multi-version capability objects.
   - Add lossy conversion module under `renderers/web_core/src/converters/`.

2. **`agent_sdks/python/` (Python Agent SDK)**:
   - Update `CatalogProvider` classes to normalize legacy catalog JSON structures.
   - Update `resolve_catalogs()` in `a2ui.utils.catalog_resolver` to accept multi-version capability inputs.
   - Update `A2uiGenerator` to negotiate optimal protocol version per session.

---

## 4. Actionable Task & Bug Filing List

When ready to track and implement these changes, the following work items / bugs should be filed:

1. **[SPEC] Relax `renderer_capabilities.json` schema for multi-version payloads**: Update JSON schema to support key-value pairs per protocol version string.
2. **[SPEC] Document A2UI SemVer and Spec Branching Policy in `a2ui_protocol.md`**: Clarify major (directory branch) vs minor/patch (inline update + changelog) policy.
3. **[BLUEPRINT] Update `a2ui_core.blueprint.md` for Protocol Compatibility Model**: Add `initialProtocolVersion`, `rendererToAgentProtocolVersion`, multi-version `MessageProcessor` configs, and `VersionAdapter` normalization specs.
4. **[BLUEPRINT] Update `a2ui_agent.blueprint.md` for Multi-Version Capability Resolution**: Update `CatalogProvider` and `resolve_catalogs()` signatures and behaviors.
5. **[BLUEPRINT] Update `a2ui_framework_adapter.blueprint.md` for Upstream Versioning**: Document framework binding rules for `rendererToAgentProtocolVersion`.
6. **[CODEBASE] Implement Multi-Version `MessageProcessor` and Adapters in `web_core`**: Build `VersionAdapter` suite and multi-version `getRendererCapabilities()` output.
7. **[CODEBASE] Implement Lossy Converter Utilities**: Build standalone JSON-to-JSON converters for cross-version message transformation.
8. **[CODEBASE] Update Python Agent SDK Capability Resolution**: Update `resolve_catalogs` to negotiate across multi-version capability payloads.
