# Proposal: Python Fluent Template Builders

## Abstract

This document proposes a catalog-driven code generator and type-safe fluent builder library for authoring A2UI templates and dynamic server render functions in Python.

By analyzing an A2UI Component Catalog JSON Schema (`catalog.json`), a builder generator script automatically synthesizes strongly typed, IDE-friendly Python component classes (`Card`, `Column`, `Row`, `Text`, `Button`, `Divider`, `Icon`, `Image`, etc.). These builder classes enforce compile-time and runtime type safety, provide instant editor autocompletion, and seamlessly interoperate with the A2UI Python Agent SDK's polymorphic template engine.

---

## 1. Motivation

The A2UI Python SDK supports programmatic dynamic templates via server render functions:

```python
def render_team_dashboard(team_id: str) -> dict:
    ...
```

While authoring UI trees using raw Python dictionaries is flexible, it exposes developers to common mistakes:

- **Typo errors**: Accidentally typing `"algn": "center"` instead of `"align": "center"`.
- **Type mismatches**: Passing an integer `42` where a child component or string is expected.
- **Invalid enum variants**: Passing `variant="heading1"` instead of standard `variant="h1"`.
- **Lack of discoverability**: Developers must consult documentation or JSON schemas to know what properties a component accepts.

A catalog-driven fluent builder library solves these issues by turning JSON schemas into native Python classes with type annotations, docstrings, and constructor validation.

---

## 2. Architecture & Code Generation Workflow

The builder system is catalog-driven and catalog-agnostic:

```
+-------------------------------------------------------------------------------+
| A2UI Catalog JSON Schema (e.g. basic/catalog.json or custom_catalog.json)      |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| Generator CLI Tool: a2ui-build-builders                                       |
| 1. Ingests catalog schema (local file path or remote HTTPS URL)               |
| 2. Parses component definitions, slots, properties, and enum constraints       |
| 3. Emits type-annotated builder dataclasses with docstrings                   |
| 4. Formats output code with pyink / black                                     |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| Output Python Package: a2ui.inference_formats.experimental.template.builder   |
| - __init__.py                                                                 |
| - components.py (Card, Column, Row, Text, Button, Icon, Divider, Image...)   |
| - types.py (TextVariant, FlexAlign, FlexJustify, etc.)                        |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| Programmatic DynamicTemplate (render=render_fn)                               |
| Python functions return fluent builder trees with IDE autocompletion          |
+-------------------------------------------------------------------------------+
```

---

## 3. Package Architecture: Generated vs. Handcrafted Files

To maintain clean separation between runtime engine logic and generated code, the builder architecture splits into handcrafted runtime infrastructure and auto-generated catalog modules:

```
agent_sdks/python/
├── a2ui_agent/
│   ├── src/a2ui/inference_formats/experimental/template/
│   │   ├── builder/                      <-- Pre-bundled builders for Basic Catalog
│   │   │   ├── __init__.py               (Generated / Re-exported)
│   │   │   ├── base.py                   (Handcrafted Runtime Infrastructure)
│   │   │   ├── components.py             (Auto-Generated from basic/catalog.json)
│   │   │   └── types.py                  (Auto-Generated from basic/catalog.json)
│   │   ├── models.py                     (Handcrafted: normalize_node, DynamicTemplate)
│   │   └── processor.py                  (Handcrafted: TemplateProcessor)
│   └── tools/
│       └── codegen/
│           ├── __init__.py
│           └── builder_generator.py      (Handcrafted: The Codegen CLI Tool)
```

### A. Handcrafted Runtime Infrastructure (Static SDK Code, Never Regenerated)

These files provide the foundation and serialization contracts:

1. **`base.py` (`ComponentBuilder`, `DataBinding`)**:
   - `ComponentBuilder`: The abstract base class providing the `.to_dict()` protocol and equality checking.
   - `DataBinding`: Strongly typed wrapper for client-side reactive bindings (`path: str`).
   - `ActionRef`: Helper for dispatching user interaction events.
2. **`models.py` (`normalize_node`, `flatten_nested_layout`)**:
   - Handles duck-typing normalization. If a node implements `.to_dict()` (like `ComponentBuilder`), it automatically serializes it before flattening synthetic IDs.
3. **`processor.py` (`TemplateProcessor`)**:
   - The synchronous expansion engine that resolves dynamic functions and flattens layouts into standard Basic Catalog primitives.

### B. Auto-Generated Files (Synthesized from `catalog.json`)

These files are generated on demand from any A2UI catalog schema:

1. **`components.py`**:
   - Python `@dataclass` classes for every component in the catalog (`Text`, `Card`, `Column`, `Row`, `Button`, `Divider`, `Icon`, `Image`, etc.).
   - Explicit constructor parameters (no untyped `**kwargs`).
   - Python docstrings extracted directly from the `description` fields in the catalog schema.
   - Implementation of `.to_dict()` that recursively normalizes child slots and data bindings.
2. **`types.py`**:
   - Strict `Literal[...]` unions for all string enums defined in the catalog (e.g. `TextVariant`, `FlexAlign`, `FlexJustify`, `ButtonVariant`).
3. **`__init__.py`**:
   - Re-exports all generated component classes alongside `DataBinding` and `ComponentBuilder` for clean imports (`from a2ui.inference_formats.experimental.template.builder import Card, Column, Text, DataBinding`).

---

## 4. Code Generation CLI & Distribution

### 4.1 CLI Entry Point Registration

The code generator is distributed as part of `a2ui-agent-sdk` (and standalone via `a2ui-core`). It is registered as a console script in `pyproject.toml`:

```toml
[project.scripts]
a2ui-build-builders = "a2ui.tools.codegen.builder_generator:main"
```

### 4.2 Pre-bundled Builders (Zero-Setup for Standard Users)

For standard A2UI development using the official **Basic Catalog**, developers do not need to run any code generation steps. The `a2ui-agent-sdk` package ships with pre-generated, tested builders directly under `a2ui.inference_formats.experimental.template.builder`.

Developers simply write:

```python
from a2ui.inference_formats.experimental.template.builder import Card, Column, Text, Icon, Divider, DataBinding
```

### 4.3 Generating Builders for Custom / Enterprise Catalogs

When an enterprise team defines a custom component catalog (e.g. `finance_catalog.json` with `StockTicker`, `OrderBook`, `CandlestickChart`), they can run the CLI generator to produce their own custom builder package:

```bash
# Run via uv in any project
uv run a2ui-build-builders \
  --catalog ./catalogs/finance/catalog.json \
  --output ./src/my_app/ui_builders \
  --package-name my_app.ui_builders
```

#### CLI Options & Flags:

| Flag              | Type                     | Description                                                   |
| :---------------- | :----------------------- | :------------------------------------------------------------ |
| `--catalog`, `-c` | `str` (Required)         | Path to local `catalog.json` or remote HTTPS schema URL.      |
| `--output`, `-o`  | `str` (Required)         | Target directory where Python builder files will be written.  |
| `--package-name`  | `str` (Optional)         | Custom Python package namespace for generated imports.        |
| `--format`        | `bool` (Default: `True`) | Automatically format generated code using `pyink` or `black`. |
| `--strict-types`  | `bool` (Default: `True`) | Emit `Literal` enum types and strict primitive unions.        |

### 4.4 Hatchling / Build Hook Integration

In the A2UI repository, the builder generation is wired into the build lifecycle (`pack_specs_hook.py` or `wireit`). When specifications under `specification/v0_9_1/catalogs/` update, the build hook regenerates `a2ui.template.builder` automatically before wheels are built.

---

## 5. Type Mapping Rules

The generator maps JSON schema types to Python type annotations:

| A2UI Catalog JSON Type   | Generated Python Type Annotation                                            | Description                                            |
| :----------------------- | :-------------------------------------------------------------------------- | :----------------------------------------------------- |
| `DynamicString`          | `Union[str, DataBinding]`                                                   | Literal string or client data model binding.           |
| `DynamicNumber`          | `Union[int, float, DataBinding]`                                            | Numeric literal or client data model binding.          |
| `DynamicBoolean`         | `Union[bool, DataBinding]`                                                  | Boolean flag or client data model binding.             |
| `ComponentId` / `child`  | `Union[ComponentBuilder, Dict[str, Any], str]`                              | Single child component, raw dict AST, or ID reference. |
| `ChildList` / `children` | `Union[List[Union[ComponentBuilder, Dict[str, Any], str]], Dict[str, Any]]` | Multi-child list or inline loop definition.            |
| `Action`                 | `Union[ActionRef, Dict[str, Any], str]`                                     | Action event definition or action ID.                  |
| `enum` (e.g. `variant`)  | `Literal["h1", "h2", "h3", "h4", "h5", "caption", "body"]`                  | Strict string literals for IDE auto-complete.          |

---

## 6. Generated Class Structure Example

Here is the exact code emitted by `a2ui-build-builders` for standard components:

```python
# a2ui/inference_formats/experimental/template/builder/components.py
# AUTO-GENERATED BY a2ui-build-builders. DO NOT EDIT DIRECTLY.

from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, Union
from a2ui.inference_formats.experimental.template.models import normalize_node
from .base import ComponentBuilder, DataBinding, ActionRef
from .types import TextVariant, FlexAlign, FlexJustify, DividerAxis

@dataclass
class Text(ComponentBuilder):
    """Text component for structured typographic display.

    Parameters:
        text: The text content to display, or a DataBinding path.
        variant: Typographic hierarchy level ('h1' through 'h5', 'caption', 'body').
        id: Optional explicit component identifier.
    """
    text: Union[str, DataBinding]
    variant: Optional[TextVariant] = "body"
    id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        res: Dict[str, Any] = {
            "component": "Text",
            "text": self.text.to_dict() if isinstance(self.text, DataBinding) else self.text,
        }
        if self.variant:
            res["variant"] = self.variant
        if self.id:
            res["id"] = self.id
        return res


@dataclass
class Column(ComponentBuilder):
    """Vertical layout container.

    Parameters:
        children: List of child component builders or raw AST dicts.
        align: Cross-axis alignment ('start', 'center', 'end', 'stretch').
        justify: Main-axis distribution ('start', 'center', 'end', 'spaceBetween', 'spaceAround').
        id: Optional explicit component identifier.
    """
    children: Union[List[Union[ComponentBuilder, Dict[str, Any], str]], Dict[str, Any]]
    align: Optional[FlexAlign] = None
    justify: Optional[FlexJustify] = None
    id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        res: Dict[str, Any] = {"component": "Column"}
        if isinstance(self.children, list):
            res["children"] = [normalize_node(c) for c in self.children]
        else:
            res["children"] = normalize_node(self.children)
        if self.align:
            res["align"] = self.align
        if self.justify:
            res["justify"] = self.justify
        if self.id:
            res["id"] = self.id
        return res


@dataclass
class Card(ComponentBuilder):
    """Visual surface container card.

    Parameters:
        child: Single child component contained within the card surface.
        id: Optional explicit component identifier.
    """
    child: Union[ComponentBuilder, Dict[str, Any], str]
    id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        res: Dict[str, Any] = {
            "component": "Card",
            "child": normalize_node(self.child),
        }
        if self.id:
            res["id"] = self.id
        return res
```

---

## 7. Developer Experience: Programmatic Dynamic Templates

With fluent builders, developers author server render functions with complete IDE autocompletion, type safety, and inline docstrings:

```python
from a2ui.inference_formats.experimental.template.builder import Card, Column, Row, Text, Icon, Divider, DataBinding
from a2ui.inference_formats.experimental.template import dynamic_template

@dynamic_template(
    name="ProjectStatusCard",
    catalogs=["https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"],
    description="Live project tracking card with milestones.",
)
def project_status_card(project_id: str):
    project = project_db.get(project_id)

    # 1. Native Python conditionals
    status_icon = "check_circle" if project.status == "ON_TRACK" else "warning"

    # 2. Native Python list comprehensions
    milestone_rows = [
        Row(
            justify="spaceBetween",
            children=[
                Text(m.name, variant="body"),
                Text(f"Due: {m.due_date}", variant="caption"),
            ]
        )
        for m in project.milestones
    ]

    # 3. Reactive two-way client DataBinding
    approval_binding = DataBinding(path=f"/projects/{project_id}/budgetApproved")

    # 4. Construct type-safe component tree
    return Card(
        child=Column(
            children=[
                Row(
                    justify="spaceBetween",
                    align="center",
                    children=[
                        Text(project.name, variant="h2"),
                        Icon(name=status_icon),
                    ]
                ),
                Divider(),
                Text(f"Lead Architect: {project.lead_name}", variant="caption"),
                Text(f"Sprint Velocity: {project.velocity} pts", variant="body"),
                Divider(),
                Text("Milestones", variant="h3"),
                Column(children=milestone_rows),
            ]
        )
    )
```

---

## 8. Static Type Checking & IDE Feedback

When developers write code using fluent builders, IDEs (VS Code / Pylance, PyCharm, Cursor) and static type checkers (`mypy`, `pyright`) catch errors before runtime:

### 1. Typo Prevention

```python
# Mypy Error: Unexpected keyword argument "algn" for "Column"
Column(children=[], algn="center")
```

### 2. Slot Type Validation

```python
# Mypy Error: Argument "child" to "Card" has incompatible type "int"; expected "ComponentBuilder | dict | str"
Card(child=123)
```

### 3. Enum Variant Checking

```python
# Mypy Error: Argument "variant" to "Text" has incompatible type 'Literal["heading1"]'; expected 'Literal["h1", "h2", ...]'
Text("Title", variant="heading1")
```

---

## 9. Polymorphic Engine Interoperability

Because the engine's [`flatten_nested_layout()`](file:///Users/jsimionato/development/a2ui_repos/templates/a2ui/agent_sdks/python/a2ui_agent/src/a2ui/template/models.py#L358) includes duck-type normalization (`hasattr(node, "to_dict")`), fluent builder trees:

- Are flattened automatically into canonical Basic Catalog primitives with synthetic IDs (`root`, `{parent}_{slot}_{index}_{type}`).
- Can be freely mixed with raw dictionaries, dataclasses, or Pydantic models anywhere in the hierarchy.
- Require zero modifications to `TemplateProcessor` or `TemplateInferenceFormat`.
