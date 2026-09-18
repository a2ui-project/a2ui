# A2UI catalogs

This directory holds the canonical `catalog.json` schemas for the catalogs
maintained by the A2UI team. A catalog declares the components and functions an
agent may reference in A2UI messages, and is what renderers validate against.

Catalogs are versioned independently of the A2UI protocol. Each catalog declares
the protocol version(s) it targets in its own definition, so a catalog authored
against one protocol version can keep working with later compatible versions.

## Layout

```
catalogs/
├── basic/
│   └── v1/                 # Basic catalog, major version 1
│       ├── catalog.json
│       ├── examples/
│       └── basic_catalog_implementation_guide.md
└── mcp/                    # MCP catalog
    └── catalog.json
```

- Catalogs are identified by the `$id` declared inside `catalog.json`, not by
  their path in this repository. The docs build keeps publishing the basic
  catalog at its existing `$id` URL
  (`https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json`), so
  moving files here does not affect consumers.
- `basic/` is versioned by catalog major version (`v1/`), which is independent
  of the protocol version. Newer catalogs start unversioned
  (`catalogs/<catalog>/catalog.json`) and add a version directory only when
  they need a breaking change.
- Basic catalogs for protocol versions before v1.0 remain under
  `specification/<version>/catalogs/`.

## Documentation

The [Basic Catalog Implementation Guide](basic/v1/basic_catalog_implementation_guide.md)
describes how renderers should implement each component and function of the
basic catalog. It is published on the docs site alongside the protocol
specification.

## Implementations

Language-specific implementations of these catalogs live in the corresponding
language directories, for example `typescript/catalogs/<catalog>/`. Each package
bundles the canonical `catalog.json` from this directory at build time, so
consumers installing a package also receive the schema it implements.
