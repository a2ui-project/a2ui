# A2UI Protocol Evolution Guide: v0.9 to v0.9.1

This document describes the changes between A2UI version 0.9 and version 0.9.1. For changes from version 0.8 to 0.9, please refer to the [v0.9 Evolution Guide](../../v0_9/docs/evolution_guide.md).

## 1. Executive Summary

Version 0.9.1 is a minor refinement of the v0.9 specification. The key changes are:

1. **MIME Type Standardization**: Standardized all references to the A2UI message payload MIME type to `application/a2ui+json` (replacing the legacy `application/json+a2ui`).
2. **Surface ID Uniqueness Relaxation**: Relaxed the requirement for `surfaceId` to be globally unique for the renderer's lifetime. It must still be unique among currently active surfaces, and it remains an error to call `createSurface` on an existing surface without first deleting it, but the explicit lifetime uniqueness constraint is removed.

## 2. Detailed Changes

### 2.1. MIME Type Standardization

In previous draft iterations of the v0.9 extension specification, the legacy `application/json+a2ui` MIME type was referenced. Version 0.9.1 standardizes all specification guides and extension metadata examples to use `application/a2ui+json`.

### 2.2. Surface ID Requirements

In `a2ui_protocol.md`, the definition and requirements for `surfaceId` were updated:

- The restriction that `surfaceId` "must be globally unique for the renderer's lifetime" is removed.
- Instead, the uniqueness constraint is limited to active surfaces: it remains an error to send `createSurface` for a `surfaceId` that already exists without first deleting it.

## 3. Migration Guide

Since v0.9.1 is fully compatible with v0.9 payloads (the version fields in schemas accept both `"v0.9"` and `"v0.9.1"`), clients and servers can upgrade seamlessly.

- **Action for Implementers**: Update any hardcoded MIME type references from `application/json+a2ui` to `application/a2ui+json`.
