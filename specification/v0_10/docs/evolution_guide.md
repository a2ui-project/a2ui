# A2UI Protocol Evolution Guide: v0.9 to v0.10

This document serves as a comprehensive guide to the changes between A2UI version 0.9 and version 0.10. It details the shifts in philosophy, architecture, and implementation, providing a reference for stakeholders and developers migrating between versions.

## 1. Executive Summary

Version 0.10 differs from 0.9 in the following ways:

- **Client-to-Server RPC**: Introduced `actionResponse` enabling synchronous responses to client-initiated actions. Added `actionId` for response correlation.
- **Surface Properties Refactoring**: Renamed `theme` to `surfaceProperties` at both the message and catalog level. Removed the `primaryColor` property entirely to decouple structural UI layout and branding customization from surface definition.

## 2. Changes

### 2.1. Catalog Definition Schema

- Added `posterUrl` property to the `Video` component in `catalogs/basic/catalog.json`, allowing a preview image to be displayed before the video plays.
- Added `placeholder` prop to the `TextField` component schema.
- Renamed the `$defs/theme` schema to `$defs/surfaceProperties` in both the basic and minimal catalogs, and removed the `primaryColor` property from it.

### 2.2. Server-to-Client Message List Schema

- Added `ActionResponseMessage` to allow the server to respond to a specific action call using an `actionId`.
- <TBD>

### 2.3. Client-to-Server Message List Schema

- Added `actionId` to the `action` message properties, which the client generates if a response is expected (`wantResponse: true`).
- <TBD>

### 2.4. Client Capabilities Schema

- Renamed `theme` capability block to `surfaceProperties` within the Catalog definition in `client_capabilities.json`.

### 2.5. AgentCard

- <TBD>

### 2.6. Data Encoding

- <TBD>

### 2.7. Processing Rules

- <TBD>

### 2.8. Server-to-Client Messages

- Added `actionResponse` message structure to support synchronous responses with a `value` or `error`.
- Updated `createSurface` message to rename the `theme` field to `surfaceProperties` (pointing to catalog surface properties definitions).

### 2.9. Client-to-Server Events

- Updated `action` message to include `actionId`.
- Updated `Action` type in `common_types.json` to include `wantResponse` and `responsePath` on event triggers.
- <TBD>

## 3. Migration Guide

- <TBD>
