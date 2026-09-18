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
├── v1_0/
│   └── basic/          # Basic catalog for protocol v1.0 (with examples/)
│       └── catalog.json
└── mcp/                # MCP catalog
```

- `v1_0/basic/` keeps its protocol-version directory because existing consumers
  depend on that path. Do not add new versioned directories here.
- New catalogs are authored in flat, unversioned directories
  (`catalogs/<catalog>/catalog.json`).

Basic catalogs for protocol versions before v1.0 remain under
`specification/<version>/catalogs/`.

## Implementations

Language-specific implementations of these catalogs live in the corresponding
language directories, for example `typescript/catalogs/<catalog>/`. Each package
bundles the canonical `catalog.json` from this directory at build time, so
consumers installing a package also receive the schema it implements.
