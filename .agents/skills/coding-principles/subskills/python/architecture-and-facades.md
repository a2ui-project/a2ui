# Subskill: Python Architecture, Package Boundaries & Public Facades

## Activation Criteria

Activate this subskill when:

- Modifying modules or package boundaries in `python/a2ui_core/`, `python/a2ui_agent/`, or `python/catalogs/mcp/`.
- Adding, renaming, or reorganizing exported symbols in `__init__.py` or `__all__`.
- Adding imports across Python packages, tests, scripts, or sample agents.
- Implementing wire-format models, state containers, or fluent builders grounded in protocol specifications.

---

## 1. Specification and Blueprint Grounding

Before modifying or implementing Python code, consult the authoritative specifications:

- **JSON Schemas**: [`specification/v0_9_1/json/`](../../../../../specification/v0_9_1/json/) and [`specification/v1_0/json/`](../../../../../specification/v1_0/json/) define wire-format types and validation constraints.
- **Component Catalogs**: [`catalogs/basic/v1/catalog.json`](../../../../../catalogs/basic/v1/catalog.json) defines components, properties, and function signatures.
- **Core Module Blueprint**: [`a2ui_core.blueprint.md`](../../../../../blueprints/modules/a2ui_core.blueprint.md) specifies state containers (`DataModel`, `SurfaceModel`), `MessageProcessor`, and validation semantics.
- **Agent SDK Blueprint**: [`a2ui_agent.blueprint.md`](../../../../../blueprints/modules/a2ui_agent.blueprint.md) specifies `A2uiGenerator`, `A2uiRequestProcessor`, inference format strategies, and prompt generation.
- **Typesafe Builder Blueprint**: [`typesafe_builder_api.blueprint.md`](../../../../../blueprints/features/typesafe_builder_api.blueprint.md) specifies Pydantic v2 fluent builder hierarchies.

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
# BAD: Deep import into internal implementation details
from a2ui.builder.v0_9.catalogs.basic import Card, Column, Text, Button
from a2ui.core.processing.message_processor import MessageProcessor
from a2ui.core.state.data_model import DataModel

# GOOD: Importing from public package facades
from a2ui.builder.v0_9 import Action, ActionEvent, Button, Card, Column, Text
from a2ui.core import DataModel, MessageProcessor, PayloadValidator
```

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
