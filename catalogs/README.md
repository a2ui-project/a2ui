# A2UI catalogs

This directory holds the canonical `catalog.json` schemas for the catalogs
maintained by the A2UI team. A catalog declares the components and functions an
agent may reference in A2UI messages, and is what renderers validate against.

Catalogs are versioned independently of the A2UI protocol from `v1` onward. Each
catalog declares the protocol version(s) it targets in its own definition, so a
catalog authored against one protocol version can keep working with later
compatible versions.

## Layout

```
catalogs/
├── basic/
│   ├── v0_9/               # Basic catalog, protocol v0.9
│   │   ├── catalog.json
│   │   ├── examples/
│   │   ├── rules.txt
│   │   └── basic_catalog_implementation_guide.md
│   ├── v0_9_1/             # Basic catalog, protocol v0.9.1
│   │   ├── catalog.json
│   │   ├── examples/
│   │   ├── rules.txt
│   │   └── basic_catalog_implementation_guide.md
│   └── v1/                 # Basic catalog, major version 1
│       ├── catalog.json
│       ├── examples/
│       └── basic_catalog_implementation_guide.md
├── mcp/                    # MCP catalog
│   ├── catalog.json        # Pre-1.0 MCP catalog, protocol v0.9
│   └── v1/                 # MCP catalog, major version 1 (protocol v1.0)
│       ├── catalog.json
│       ├── examples/
│       └── mcp_app_specification.md
├── minimal/                # Minimal starter catalog
│   └── v0_9/               # Minimal catalog, protocol v0.9
│       ├── README.md
│       ├── catalog.json
│       └── examples/
└── vegachart/              # VegaChart catalog
    ├── v0_9/               # VegaChart catalog, protocol v0.9
    │   └── catalog.json
    └── v1/                 # VegaChart catalog, major version 1 (protocol v1.0)
        └── catalog.json
```

- Catalogs are identified by the `$id` declared inside `catalog.json`, not by
  their path in this repository. The docs build keeps publishing catalogs at
  their existing `$id` URLs (such as
  `https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json` and
  `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json`), so moving
  files here does not affect consumers.
- From `v1` onward, `basic/` is versioned by catalog major version (`v1/`),
  independent of the protocol version; its pre-1.0 protocol snapshots live in
  `basic/v0_9/` and `basic/v0_9_1/` (and the v0.9 minimal catalog in
  `minimal/v0_9/`). Newer catalogs start unversioned
  (`catalogs/<catalog>/catalog.json`) and add a version directory only when
  they need a breaking change. The MCP catalog for protocol v0.9 stays at
  `catalogs/mcp/catalog.json`; its v1.0 successor lives in `mcp/v1/`. The
  VegaChart catalog keeps one directory per protocol version (`v0_9/`, `v1/`).
- Only the deprecated `v0.8` catalog schemas remain under
  `specification/v0_8/json/`.

## Documentation

The [Basic Catalog Implementation Guide](basic/v1/basic_catalog_implementation_guide.md)
(and the [v0.9.1 guide](basic/v0_9_1/basic_catalog_implementation_guide.md))
describes how renderers should implement each component and function of the
basic catalog. It is published on the docs site alongside the protocol
specification.

## Implementations

Language-specific implementations of these catalogs live in the corresponding
language directories, for example `typescript/catalogs/<catalog>/`. Each package
bundles the canonical `catalog.json` from this directory at build time, so
consumers installing a package also receive the schema it implements.
