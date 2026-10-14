# Subskill: Python Coding Standards, Typing & Verification Workflow

## Activation Criteria

Activate this subskill when:

- Authoring, refactoring, or reviewing any Python file (`*.py`) across `python/`, `eval/`, `samples/agent/`, `tools/`, or `scripts/`.
- Adding or modifying Pydantic v2 models, validators, exceptions, or imports.
- Running local Python formatting, type checking, unit tests, or build checks.

---

## 1. Coding Standards & Python Best Practices

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

### Import Organization and Sorting

Maintain strict, predictable import organization following standard Python (PEP 8) conventions:

1. **Future Imports**: Place `from __future__ import annotations` at the very top of the file (directly below the module docstring/license header).
2. **Three-Group Hierarchy**: Group imports into three distinct sections separated by a single blank line:
   - **Standard library** (e.g., `import os`, `import sys`, `from typing import Any, Mapping`)
   - **Third-party packages** (e.g., `import pytest`, `from pydantic import BaseModel, Field`)
   - **First-party / repository packages** (e.g., `from a2ui.builder.v0_9 import Button, Card`, `from a2ui.core import DataModel`)
3. **Alphabetical Sorting**:
   - Within each group, sort import statements alphabetically by module name.
   - For multi-symbol `from <module> import (...)` statements, sort the imported symbols alphabetically (e.g., `from a2ui.builder.v0_9 import Action, ActionEvent, Button, Card, Column, Text`).
4. **No Wildcard Imports**: Never use wildcard imports (`from module import *`) in application, library, or test code. Explicitly name every imported symbol.

---

## 2. Tooling & Mandatory Verification Workflow

All Python code across the entire repository must pass formatting, type checking, and unit testing via `uv` before submission.

### 1. Synchronize Dependencies

```bash
uv sync --all-packages
```

### 2. Formatting (`fix_format.sh` / Pyink)

Directly run the repository's formatting script to format code in place (faster and saves tokens compared to checking first):

```bash
./scripts/fix_format.sh
```

Or format Python code directly in place:

```bash
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

## 3. Pre-Submission Checklist for Python PRs

- [ ] Grounded in authoritative `specification/` schemas and `blueprints/`.
- [ ] Public symbols exported through package-level `__init__.py` with explicit `__all__`.
- [ ] No deep internal module imports in code, tests, docstrings, or READMEs.
- [ ] Imports grouped (standard library, third-party, local) and sorted alphabetically.
- [ ] Formatted with `./scripts/fix_format.sh` (or `uv run pyink .`).
- [ ] `uv run mypy .` passes with zero errors.
- [ ] `uv run pytest` passes 100%.
- [ ] `uv build --all` completes successfully.
