---
name: a2ui-python-development
description: >-
  Grounding, architectural standards, Python best practices, package facade conventions, testing,
  and verification workflows for developing any Python code across the entire A2UI repository (core
  libraries, agent SDKs, evaluators, tooling, scripts, and samples). Use whenever implementing features,
  writing or refactoring Python code, organizing module exports, or writing tests in Python.
---

# Python Development and Best Practices Skill

This skill guides AI assistants and human contributors writing, maintaining, or refactoring any
Python code across the entire A2UI repository (including core state libraries, agent SDKs, builders,
evaluation pipelines, tools, scripts, and samples). These best practices apply uniformly to all Python
code in the codebase, not specific folders. It outlines package boundaries, coding standards, facade
architecture, avoidance of deep imports, and mandatory verification workflows.

---

## 1. Specification and Blueprint Grounding

Before modifying or implementing Python code, consult the authoritative specifications:

- **JSON Schemas**: [`specification/v0_9_1/json/`](../../../specification/v0_9_1/json/) and [`specification/v1_0/json/`](../../../specification/v1_0/json/) define wire-format types and validation constraints.
- **Component Catalogs**: [`catalogs/basic/v1/catalog.json`](../../../catalogs/basic/v1/catalog.json) defines components, properties, and function signatures.
- **Core Module Blueprint**: [`a2ui_core.blueprint.md`](../../../blueprints/modules/a2ui_core.blueprint.md) specifies state containers (`DataModel`, `SurfaceModel`), `MessageProcessor`, and validation semantics.
- **Agent SDK Blueprint**: [`a2ui_agent.blueprint.md`](../../../blueprints/modules/a2ui_agent.blueprint.md) specifies `A2uiGenerator`, `A2uiRequestProcessor`, inference format strategies, and prompt generation.
- **Typesafe Builder Blueprint**: [`typesafe_builder_api.blueprint.md`](../../../blueprints/features/typesafe_builder_api.blueprint.md) specifies Pydantic v2 fluent builder hierarchies.

---

## 2. Target Architecture & Package Boundaries

Python code across the repository spans SDK libraries, agent implementations, evaluation harnesses, tooling, and scripts. The primary SDK library packages are managed as a `uv` workspace under `python/`:

- **`a2ui_core`** (`python/a2ui_core/`):
  - Framework-agnostic runtime state and processing engine.
  - Implements `DataModel` (reactive JSON pointer mutations), `SurfaceModel`, `MessageProcessor`, and `PayloadValidator`.
  - **Boundary rule**: `a2ui_core` contains _no_ LLM prompting, parsing, or agent orchestration logic.
- **`a2ui_agent`** (`python/a2ui_agent/`):
  - Agent-side orchestration and prompting framework.
  - Implements `A2uiGenerator`, `A2uiRequestProcessor`, format strategies (`DirectJsonFormat`, `ExpressFormat`), and prompt generators.
- **`a2ui.builder`** (`python/a2ui_agent/src/a2ui/builder/`):
  - Strongly typed Pydantic v2 fluent builders for components and basic catalogs.
  - Versioned by protocol (e.g. `a2ui.builder.v0_9`) to ensure protocol immutability.
- **`catalogs/mcp`** (`python/catalogs/mcp/`):
  - Model Context Protocol (MCP) catalog bindings.
- **Evaluators, Tools, Scripts, and Samples** (`eval/`, `tools/`, `scripts/`, `samples/agent/`):
  - Evaluation harnesses, developer utilities, repository automation scripts, and sample agents that consume or support the Python SDKs.
  - Must adhere to the same architectural standards, clean facade imports, and code hygiene rules.

---

## 3. Public Facades vs. Deep Module Imports

### The Architectural Rule

**Never expose, rely on, or demonstrate deep internal submodule import paths.**

```python
# ❌ BAD: Deep import into internal implementation details
from a2ui.builder.v0_9.catalogs.basic import Card, Column, Text, Button
from a2ui.core.processing.message_processor import MessageProcessor
from a2ui.core.state.data_model import DataModel

# ✅ GOOD: Importing from public package facades
from a2ui.builder.v0_9 import Action, ActionEvent, Button, Card, Column, Text
from a2ui.core import DataModel, MessageProcessor, PayloadValidator
```

### Why Deep Imports are Dangerous

1. **Tight Coupling to File Layouts**: Deep imports tie external callers to internal folder structures, filenames, and module boundaries.
2. **Refactoring Friction Across Codebases**: When internal directories are restructured (e.g., modularizing submodules, reorganizing package layouts, or splitting catalogs), every deep import breaks downstream call sites, requiring tedious and fragile codebase-wide migrations.
3. **Loss of API Guarantees**: Internal submodule symbols may change behavior, be renamed, or be removed between releases without notice.

### How to Implement Public Facades

1. **Use `__init__.py` with Explicit `__all__`**:
   Every public package must curate its public API in `__init__.py` and define an explicit `__all__` list.
2. **Hide Internal Submodules**:
   Submodules that are internal implementation details should either be prefixed with an underscore (`_internal.py`), placed in private directories (`_compat.py`), or omitted from `__all__`.
3. **Example and Documentation Hygiene**:
   All `README.md` files, docstring examples, blueprints, and sample applications must exclusively demonstrate imports using public package facades.

### The Constants Exception

Constants that are formally part of the public protocol API (e.g., `SPEC_VERSION`, `PROTOCOL_VERSION`) may be exported from a lightweight, dependency-free leaf module (e.g., `a2ui.core.schema.v0_9.constants` or `a2ui.schema.constants`):

- Callers requiring _only_ protocol constants should be able to depend on the leaf module without pulling in the entire agent or runtime dependency tree.
- When refactoring packages, keep existing leaf constant imports stable while ensuring the new structure exposes them through the canonical versioned schema facade.

---

## 4. Coding Standards & Python Best Practices

### Modern Typing & Pydantic v2

- **Strict Type Annotations**: All function signatures and module APIs must be fully typed. Use modern Python typing features (`T | None` instead of `Optional[T]`, `list[T]` instead of `List[T]`).
- **Pydantic v2 Patterns**:
  - Use `model_dump(by_alias=True, exclude_none=True)` for serialization.
  - Use `TypeAdapter` or Pydantic models for JSON validation rather than hand-rolled validators.
  - Parameter metadata: Prefer `typing.Annotated[T, Field(description="...")]` or `Annotated[T, "description"]` over fragile, hand-rolled docstring parsing.

### Error Hierarchy & Exception Handling

- **Base Exception**: All exceptions in the SDK inherit from `A2uiError` in `a2ui.core`.
- **Specialized Exceptions**:
  - `A2uiValidationError`: Schema, property, or constraint violations.
  - `A2uiParseError`: Syntax or formatting errors in LLM output.
  - `A2uiStateError`: Surface lifecycle or state inconsistencies.
  - `A2uiCatalogError`: Catalog negotiation or lookup failures.
  - `A2uiExpressionError`: Local expression or function evaluation failures.
- **Fail Loudly**: Avoid silent fallbacks that swallow errors or mask invalid inputs. When an unknown schema node or format is encountered, raise an informative error naming the offending property or path.

### Catalog-Agnostic Design

- Do not hardcode catalog-specific component names, property rules, or syntax filters into core parsers, prompt generators, or compilers.
- Component property rules, constraints, and hints must be dynamically derived from the component catalog JSON schema.

---

## 5. Tooling & Mandatory Verification Workflow

All Python code across the entire repository must pass formatting, type checking, and unit testing via `uv` before submission.

### 1. Synchronize Dependencies

```bash
uv sync --all-packages
```

### 2. Format Checking (Pyink)

Code must be formatted using Pyink:

```bash
# Check formatting
uv run pyink --check .

# Auto-format in place
uv run pyink .
```

### 3. Type Checking (Mypy)

Strict type checking must pass across all workspace packages:

```bash
uv run mypy .
```

### 4. Unit & Conformance Tests (Pytest)

Run all pytest test suites:

```bash
# Run all tests
uv run pytest

# Run specific package tests
uv run pytest python/a2ui_core/tests
uv run pytest python/a2ui_agent/tests
```

### 5. Build Verification

Verify that all packages build valid distributions:

```bash
uv build --all
```

---

## 6. Pre-Submission Checklist for Python PRs

- [ ] Grounded in authoritative `specification/` schemas and `blueprints/`.
- [ ] Public symbols exported through package-level `__init__.py` with explicit `__all__`.
- [ ] No deep internal module imports in code, tests, docstrings, or READMEs.
- [ ] `uv run pyink --check .` passes cleanly.
- [ ] `uv run mypy .` passes with zero errors.
- [ ] `uv run pytest` passes 100%.
- [ ] `uv build --all` completes successfully.
