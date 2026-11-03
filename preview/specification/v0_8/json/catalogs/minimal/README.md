# Minimal A2UI Catalog (v0.8)

This folder contains a minimal A2UI component catalog (`minimal_catalog.json`) to be used as a test bed for testing new renderer implementations for the v0.8 protocol.

## Purpose

The standard A2UI catalog is comprehensive and features many components, functions, and layout primitives. Building a new renderer from scratch to support the entire catalog can be overwhelming. The minimal catalog reduces the surface area to a core set of fundamental components:

- **Text**: For rendering text strings.
- **Row**: For horizontal flex layouts.
- **Column**: For vertical flex layouts.
- **Button**: For basic interactivity and action dispatching.
- **TextField**: For user inputs.

By targeting this minimal catalog first, new renderer implementations can establish a solid foundation—covering layout algorithms, component nesting, data binding, and event handling—before scaling up to the full standard catalog.

## Strict Subset

The v0.8 minimal catalog is a **strict subset** of the A2UI v0.8 standard catalog (`https://a2ui.org/specification/v0_8/standard_catalog_definition.json`). This means that any A2UI message that is valid against this minimal catalog is also valid against the standard catalog. This allows developers to use these minimal examples to test existing v0.8 renderers that might be hardcoded to use the standard catalog.

## Examples

The `examples/` directory contains JSON arrays of layout messages (`server_to_client_list` format) demonstrating various UI scenarios using only the components defined in this minimal catalog. These examples follow the A2UI v0.8 protocol.
