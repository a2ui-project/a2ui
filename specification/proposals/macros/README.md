# A2UI macros and typesafe API

This directory contains specifications and requirements for A2UI Macros (Macro Components) and the companion Typesafe API Generator.

## Active proposals and documents

- [Requirements for the A2UI typesafe API generator and macros](typesafe_api_generator_requirements.md): Exhaustive requirements covering macro component expansion, direct payload authoring, developer and maintainer ergonomics, compile-time diagnostics, and layout scenarios.
- [System design: A2UI typesafe API generator and macros](typesafe_api_generator_design.md): Architectural design detailing schema ingestion via `@a2ui/web_core`, the normalized intermediate representation (CatalogIR), TypeScript CLI (`@a2ui/cli` at `javascript/a2ui_cli`), Python emitter implementation, cross-language support, and protocol versioning.
- [Implementation plan: Typesafe API generator and programmatic macros](typesafe_api_generator_implementation_plan.md): Concrete implementation phases, file placement, testing plan, and sample app migration.

## Archived drafts

Exploratory design notes and early research documents are located in [archived/](archived/).
