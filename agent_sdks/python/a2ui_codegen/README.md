# A2UI Codegen

The A2UI Typesafe API Generator generates typed classes, constructors, function wrappers, and serialization helpers from A2UI Component Catalog JSON schemas.

## Features

- **Schema Ingestion**: Ingests official A2UI catalogs (Basic Catalog, Minimal Catalog) as well as custom enterprise catalogs.
- **Algebraic Type System**: Maps JSON Schema semantic types to host-language constructs (`Literal` unions, `ComponentBuilderNode`, `DataBinding`, `FunctionCall`, `Action`).
- **Zero-Config Python Emitter**: Emits self-contained Python modules (`components.py`, `functions.py`, `types.py`, `__init__.py`, `py.typed`).
- **CLI Tool**: Usable standalone or via `uvx a2ui-codegen` / `pipx run a2ui-codegen`.

## Installation

```bash
pip install a2ui-codegen
```

## CLI Usage

```bash
a2ui-codegen --catalog ./path/to/catalog.json --lang python --out ./src/my_catalog
```
