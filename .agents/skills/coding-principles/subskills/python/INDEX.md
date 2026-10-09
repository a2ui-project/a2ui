# Python Progressive Discovery Router

Use this router whenever a pull request or local change modifies Python files across `python/`, `eval/`, `samples/agent/`, `tools/`, or `scripts/`.

---

## Evaluate Python Subskill Triggers

Inspect the Python files in `git diff main --stat` and read the subskill documents below whose activation criteria match your changes:

### 1. Specification Grounding, Package Architecture & Public Facades

- **Document**: [`architecture-and-facades.md`](architecture-and-facades.md)
- **Activate if**:
  - Any package boundary or module layout under `python/` (`a2ui_core`, `a2ui_agent`, `a2ui.builder`, `catalogs/mcp`) is modified.
  - Package entrypoints (`__init__.py`, `__all__`) or cross-package imports are added or modified.
  - Protocol schemas, component catalogs, or constants (`SPEC_VERSION`, `PROTOCOL_VERSION`) are touched.
  - Examples, docstrings, READMEs, or sample agents demonstrate package imports.

### 2. Python Coding Standards, Typing, Error Hierarchy & Verification

- **Document**: [`coding-standards-and-verification.md`](coding-standards-and-verification.md)
- **Activate if**:
  - Any Python source or test file (`*.py`) is added, modified, or refactored.
  - Pydantic v2 models, type annotations, or serialization logic (`model_dump`, `TypeAdapter`) are touched.
  - Exceptions (`A2uiError` subclasses) or validation error paths are added or modified.
  - Parsers, prompt generators, or compilers are updated (enforces catalog-agnostic design).
  - Running local formatting (`pyink`), type checking (`mypy`), unit testing (`pytest`), or package builds (`uv build`).

### 3. Specialized Task Skills (Load Only When Applicable)

- **Generating Pydantic Models from JSON Schemas**: Read [`a2ui-generate-pydantic-models`](../../../a2ui-generate-pydantic-models/SKILL.md) when regenerating or updating schema-backed Pydantic models.
- **Releasing Python Packages to PyPI**: Read [`a2ui-release-python`](../../../a2ui-release-python/SKILL.md) when cutting a release for `a2ui-core` or `a2ui-agent-sdk`.
