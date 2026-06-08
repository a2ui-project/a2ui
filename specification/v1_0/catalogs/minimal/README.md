# Minimal A2UI Catalog

This folder contains a minimal A2UI component catalog (`minimal_catalog.json`) to be used as a test bed for testing new renderer implementations.

## Purpose

The basic A2UI catalog is comprehensive and features many components, functions, and layout primitives. Building a new renderer from scratch to support the entire catalog can be overwhelming. The minimal catalog reduces the surface area to a core set of fundamental components:

- **Text**: For rendering text strings.
- **Row**: For horizontal flex layouts.
- **Column**: For vertical flex layouts.
- **Button**: For basic interactivity and action dispatching.
- **TextField**: For two-way data-bound user inputs.

By targeting this minimal catalog first, new renderer implementations can establish a solid foundation—covering layout algorithms, component nesting, data binding, and event handling—before scaling up to the full basic catalog.

## Examples

The `examples/` directory contains 5 JSON arrays of layout messages (`server_to_client_list` format) demonstrating various UI scenarios using only the components defined in this minimal catalog. They serve as basic integration tests.
