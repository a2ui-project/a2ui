# Subskill: Python Architecture, Package Boundaries & Public Facades

## Activation Criteria

Activate this subskill when:

- Modifying modules or package boundaries in `python/a2ui_core/`, `python/a2ui_agent/`, or `python/catalogs/mcp/`.
- Adding, renaming, or reorganizing exported symbols in `__init__.py` or `__all__`.
- Adding imports across Python packages, tests, scripts, or sample agents.
- Implementing wire-format models, state containers, or fluent builders grounded in protocol specifications.

---

## 1. Target Architecture & Package Boundaries

Python code across the repository spans SDK libraries, agent implementations, evaluation harnesses, tooling, and scripts. The primary SDK library packages are managed as a `uv` workspace under `python/`:

- **`a2ui_core`** (`python/a2ui_core/`):
  - Framework-agnostic runtime state and processing engine.
  - Implements `DataModel` (reactive JSON pointer mutations), `SurfaceModel`, `MessageProcessor`, and `PayloadValidator`.
  - **Boundary rule**: `a2ui_core` contains _no_ LLM prompting, parsing, or agent orchestration logic.
- **`a2ui_agent`** (`python/a2ui_agent/`):
  - Agent-side orchestration and prompting framework.
  - Implements `A2uiGenerator`, `A2uiRequestProcessor`, format strategies (`DirectJsonFormat`, `ExpressFormat`), and prompt generators.
  - **Boundary rule**: `a2ui_agent` is agent-framework agnostic. It must not import or depend on agent frameworks or model SDKs (`a2a`, `google.adk`, `google.genai`, ...). `python/a2ui_agent/tests/test_framework_agnostic.py` enforces this.
- **`a2ui_a2a`** (`python/a2ui_a2a/`, distribution `a2ui-a2a`):
  - A2A protocol extension (`a2ui.a2a`): extension URI negotiation and A2A part helpers.
- **`a2ui_adk`** (`python/a2ui_adk/`, distribution `a2ui-adk`):
  - Agent Development Kit integration (`a2ui.adk`): `SendA2uiToClientToolset` and `A2uiProcessorStore`.
  - The ADK-to-A2A converters (`a2ui.adk.a2a`) and A2A orchestration helpers (`a2ui.adk.orchestration`) need the `a2a` extra and are exported lazily from `a2ui.adk`.
- **Namespace rule**: `a2ui` is a PEP 420 namespace package shared by all of these distributions. Never add `src/a2ui/__init__.py`, and never ship the same subpackage from two distributions.
- **`a2ui.builder`** (`python/a2ui_agent/src/a2ui/builder/`):
  - Strongly typed Pydantic v2 fluent builders for components and basic catalogs.
  - Versioned by protocol (e.g. `a2ui.builder.v0_9`) to ensure protocol immutability.
- **`catalogs/mcp`** (`python/catalogs/mcp/`):
  - Model Context Protocol (MCP) catalog bindings.
- **Evaluators, Tools, Scripts, and Samples** (`eval/`, `tools/`, `scripts/`, `samples/agent/`):
  - Evaluation harnesses, developer utilities, repository automation scripts, and sample agents that consume or support the Python SDKs.
  - Must adhere to the same architectural standards, clean facade imports, and code hygiene rules.

---

## 2. Public Facades vs. Deep Module Imports

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

Constants that are formally part of the public protocol API (e.g., `SPEC_VERSION`, `PROTOCOL_VERSION`) may be exported from a lightweight, dependency-free leaf module (e.g., `a2ui.core.schema.v0_9.constants` or `a2ui.constants`):

- Callers requiring _only_ protocol constants should be able to depend on the leaf module without pulling in the entire agent or runtime dependency tree.
- When refactoring packages, keep existing leaf constant imports stable while ensuring the new structure exposes them through the canonical versioned schema facade.
