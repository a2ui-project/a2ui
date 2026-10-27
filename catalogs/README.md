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
│       ├── patterns.json   # Abstract block pattern templates for Basic v1
│       ├── examples/
│       └── basic_catalog_implementation_guide.md
├── decision/               # Catalog-agnostic layout archetype grammar & schemas
│   ├── README.md
│   └── v1/
│       ├── archetypes.json
│       ├── archetype_definition.json
│       └── pattern_definition.json
├── mcp/                    # MCP catalog
│   ├── catalog.json        # Pre-1.0 MCP catalog, protocol v0.9
│   └── v1/                 # MCP catalog, major version 1 (protocol v1.0)
│       ├── catalog.json
│       ├── examples/
│       └── mcp_app_specification.md
└── vegachart/              # VegaChart catalog
    ├── v0_9/               # VegaChart catalog, protocol v0.9
    │   └── catalog.json
    └── v1/                 # VegaChart catalog, major version 1 (protocol v1.0)
        └── catalog.json
```

- Catalogs are identified by the `$id` declared inside `catalog.json`, not by
  their path in this repository. The docs build keeps publishing the basic
  catalog at its existing `$id` URL
  (`https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json`), so
  moving files here does not affect consumers.
- `basic/v1/patterns.json` maps the 17 abstract block patterns (`page`, `banner`,
  `picture`, `media`, `filters`, `headline`, `facts`, `prose`, `collection`,
  `comparison`, `steps`, `form`, `groups`, `actions`, `outcome`, `conversation`,
  `compose`) onto Basic Catalog components for decision-model layout synthesis,
  while `decision/v1/archetypes.json` (with `archetype_definition.json` and
  `pattern_definition.json`, documented in `decision/README.md`) defines the
  catalog-agnostic layout archetype grammar (`ArchetypeGrammar`).
- `basic/` is versioned by catalog major version (`v1/`), which is independent
  of the protocol version. Newer catalogs start unversioned
  (`catalogs/<catalog>/catalog.json`) and add a version directory only when
  they need a breaking change. The MCP catalog for protocol v0.9 stays at
  `catalogs/mcp/catalog.json`; its v1.0 successor lives in `mcp/v1/`. The
  VegaChart catalog keeps one directory per protocol version (`v0_9/`, `v1/`).
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
