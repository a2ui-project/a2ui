# @a2ui/web_core

The `@a2ui/web_core` package contains the core logic, state management, and protocol handling for the A2UI framework. It is designed to be framework-agnostic, providing the foundation for specific renderer implementations like Angular, React, or Lit.

## Features

- **Protocol Handling**: Implements A2UI specification (v0.8 and v0_9) message processing and validation.
- **State Management**: Reactive data models using `@preact/signals-core`.
- **DataContext**: Advanced data binding and function execution logic with support for dependency tracking and automatic updates.
- **Catalog System**: Extensible registry for components and functions, enabling cross-renderer reuse.
- **Schema Validation**: Built-in Zod-based validation for protocol messages and component properties.

## Architecture

### Version v0_9 (Recommended)

The v0_9 architecture centers around a decoupled model where rendering is driven by a `SurfaceGroupModel` and its constituent `SurfaceModel`s.

- **Internal Models**: `DataModel` manages the application state, while `SurfaceComponentsModel` tracks the components rendered on a surface.
- **DataContext**: Provides the execution environment for expressions and functions defined in the A2UI protocol.
- **Processing**: `MessageProcessor` translates incoming A2A messages into state updates.

### Version v0_8 (Legacy)

Maintains compatibility with the initial A2UI specification version, focusing on static component mapping and direct data binding.

## Installation

```bash
npm install @a2ui/web_core
```

## Development

### Building

The package uses `wireit` for optimized build orchestration:

```bash
npm run build
```

### Testing

Run the test suite using the native Node.js test runner:

```bash
npm test
```

Generate coverage reports:

```bash
npm run test:coverage
```

## Legal Notice

This library is part of the A2UI project. Please refer to the top-level documentation for security considerations and developer responsibilities when handling untrusted agent data.
