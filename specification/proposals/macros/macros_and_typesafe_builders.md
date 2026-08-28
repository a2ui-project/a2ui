# Programmatic macros and type-safe catalog builders

This proposal describes the design for programmatic macros and type-safe component builders in A2UI.

---

## Concept of macros

In standard A2UI workflows, a language model emits full component trees directly over the wire (either as raw JSON messages or through inference formats such as Express). While this approach provides layout control, it has limitations in production agent applications:

* **Token overhead and latency:** Generating repetitive layout scaffolding (cards, rows, column containers, styling wrappers) repeatedly increases model generation latency and inference costs.
* **Inconsistent UI quality:** Language models frequently introduce layout mistakes, missing attributes, or inconsistent spacing when constructing complex component hierarchies from scratch.
* **Sensitive data leakage:** Displaying confidential backend data (such as employee compensation or account numbers) often requires sending that data to the model first so the model can include it in the generated UI.

A macro addresses these problems. A macro is a parameterized, server-side layout function authored in code. When the language model generates an interface, it invokes the macro by name with high-level arguments rather than constructing the underlying UI tree:

```python
# Model output (compact Express invocation)
@SalaryCard(employee_name="Marcus Vance", role="Lead Systems Architect")
```

The macro function runs on the agent server, populating the full component hierarchy programmatically before sending standard A2UI protocol messages to the client renderer. This provides three concrete benefits:

1. **Reduced generation latency:** The model outputs tens of tokens instead of hundreds of tokens of layout scaffolding.
2. **Server-side data resolution:** The macro function can query private databases or internal services directly on the server to populate sensitive fields without exposing those values to model context.
3. **Deterministic styling:** Designers and engineers define layout structure and styling rules in code once.

### Comparison with static templates

Earlier designs evaluated declarative template formats such as YAML or JSON with string substitution placeholders (e.g. `{{baseSalary}}`). Programmatic code macros supersede static templates for several reasons:

* **Control flow:** Code functions natively support conditionals (`if/else`), loops (`for item in items`), and arithmetic transformations without requiring a custom expression engine in the protocol.
* **Refactoring and static analysis:** Code functions are checked by existing linters, type checkers, and IDE autocompletion tools.
* **No protocol changes:** A macro expands into standard A2UI components on the server. The client renderer receives standard `createSurface` and `updateComponents` messages without requiring client-side template engines.

---

## Code generation architecture

To author macros efficiently, developers require a type-safe way to build component trees in their backend language. The `@a2ui/cli` package generates native, typed component builder classes from A2UI catalog JSON schemas.

### Why code generation is implemented in TypeScript

The code generator is implemented as a TypeScript CLI (`@a2ui/cli`) within the repository for two primary reasons:

1. **Single source of truth for validation:** The core definition of catalogs, schemas, and component interfaces in this repository resides in `@a2ui/web_core`. Implementing the generator in TypeScript allows it to import schema definitions directly from `@a2ui/web_core`, eliminating the need to maintain duplicate JSON Schema parsers in multiple SDK languages.
2. **Standard distribution:** Distributing the tool as an npm package (`@a2ui/cli`) allows developers across different language ecosystems (Python, Go, Kotlin) to run code generation via `npx @a2ui/cli codegen` without configuring separate language runtimes for the build tool.

### Adding JSON schema ingestion to web core

Historically, catalog schemas in `web_core` were hardcoded TypeScript structures. However, catalogs are defined and exchanged externally as JSON schemas conforming to `specification/<version>/json/catalog.json`.

To bridge this gap, `@a2ui/web_core` introduces a static factory method:

```typescript
import { Catalog } from '@a2ui/web_core';

const catalog = Catalog.fromJson(rawJsonSchema);
```

`Catalog.fromJson()` parses the raw JSON schema, maps JSON Schema data types (`string`, `number`, `boolean`, `array`, `object`, `oneOf`) into typed `ComponentApi` objects with Zod validation schemas, and extracts enum constraints. Both the TypeScript CLI and client renderers use this method to inspect catalog definitions.

---

## Python fluent builder API

The Python Agent SDK provides a fluent builder library that allows developers to construct A2UI component trees with static type checking.

### The component builder node foundation

All generated component classes inherit from `ComponentBuilderNode`. A `ComponentBuilderNode` represents an in-memory component definition prior to serialization. It stores component properties, tracks child nodes, and handles identifier assignment during tree flattening.

### Key features and examples

#### 1. Nested component hierarchies

Component constructors accept child nodes directly as constructor arguments:

```python
from a2ui.inference_formats.experimental.macros.builder import (
    Button,
    Card,
    Column,
    Row,
    Text,
)

layout = Card(
    child=Column(
        children=[
            Text(text="Quarterly Review", variant="h2"),
            Text(text="All performance goals have been completed.", variant="body"),
            Row(
                children=[
                    Button(text="View Details", variant="primary"),
                    Button(text="Dismiss", variant="secondary"),
                ]
            ),
        ]
    )
)
```

#### 2. Data binding

Properties can be bound to client data model paths using `bind()`, or bound to computed expressions using `bind_expr()`:

```python
from a2ui.inference_formats.experimental.macros.builder import Text, bind, bind_expr

# Bind directly to a data model path
title = Text(text=bind("/user/profile/displayName"))

# Bind to an expression evaluated by the client
status_label = Text(text=bind_expr("user.isOnline ? 'Active' : 'Offline'"))
```

#### 3. Dynamic child lists

Repeating collections driven by arrays in the data model use `DynamicChildList`:

```python
from a2ui.inference_formats.experimental.macros.builder import (
    Column,
    DynamicChildList,
    Row,
    Text,
    bind,
)

# Renders a row for each item in the /team/members array
member_list = Column(
    children=DynamicChildList(
        template=Row(
            children=[
                Text(text=bind("/name")),
                Text(text=bind("/role")),
            ]
        ),
        binding=bind("/team/members"),
    )
)
```

#### 4. User actions and event payloads

Interactive elements define user actions with event names and optional payloads:

```python
from a2ui.inference_formats.experimental.macros.builder import Action, Button

submit_button = Button(
    text="Approve Request",
    action=Action(
        event={
            "name": "approval_submitted",
            "payload": {"requestId": "req_8472", "decision": "approved"},
        }
    ),
)
```

#### 5. External component references

When referencing an existing component on the surface that was declared outside the current builder tree, developers use `ExternalComponentBuilderNode`:

```python
from a2ui.inference_formats.experimental.macros.builder import (
    Column,
    ExternalComponentBuilderNode,
    Text,
)

container = Column(
    children=[
        Text(text="Embedded Section:"),
        ExternalComponentBuilderNode(component_id="existing_chart_surface_1"),
    ]
)
```

---

## Code generation inputs, outputs, and usage

The `@a2ui/cli` tool reads standard A2UI catalog JSON files and generates native Python builder modules.

### Command-line interface

```bash
npx @a2ui/cli codegen --catalog ./catalogs/basic/catalog.json --out ./agent/builders/basic.py
```

Supported options:
* `--catalog <path>`: Path to the input A2UI catalog JSON file (required).
* `--out <path>`: Destination `.py` file path or output directory (required). If a directory is provided, the tool emits `<catalog_name>.py` into that directory.
* `--base-import <module>`: Custom Python module path for builder base classes (defaults to `a2ui.inference_formats.experimental.macros.builder.base`).
* `--spec-version <version>`: Explicit protocol version (e.g. `v0.9.1`).

### Single-file catalog output

Running `a2ui codegen` generates the entire catalog into a single self-contained Python module (e.g. `basic.py`). This keeps all related types, component dataclasses, helper functions, and re-exports in one cohesive file:

1. **Types and Enums:** `Literal[...]` type aliases derived from catalog constraints.
2. **Component Builders:** `@dataclass` classes inheriting from `ComponentBuilderNode`.
3. **Function Wrappers:** Type-safe helper functions generating `FunctionCall` objects.
4. **Re-exports:** An explicit `__all__` list exposing all components, enums, functions, and core builder utilities (`Action`, `DataBinding`, `bind`, `Surface`).

### Input and output example

#### Input catalog schema (`catalog.json` snippet)

```json
{
  "catalogId": "https://a2ui.dev/catalogs/basic.json",
  "components": {
    "Card": {
      "description": "Container card with optional elevation and title.",
      "properties": {
        "title": { "type": "string" },
        "elevation": {
          "type": "string",
          "enum": ["none", "low", "high"],
          "default": "low"
        },
        "child": { "$ref": "#/definitions/ComponentRef" }
      },
      "required": ["child"]
    }
  }
}
```

#### Generated single-file module (`basic.py` snippet)

```python
from dataclasses import dataclass, field
from typing import Any, Mapping, Literal, Optional, Sequence, Union

from a2ui.inference_formats.experimental.macros.builder.base import (
    Action,
    ComponentBuilderNode,
    DataBinding,
    FunctionCall,
    Surface,
    bind,
)

# =============================================================================
# Types & Enums
# =============================================================================

CardElevation = Literal["none", "low", "high"]

# =============================================================================
# Components
# =============================================================================

@dataclass(kw_only=True)
class Card(ComponentBuilderNode):
    """Container card with optional elevation and title."""
    child: ComponentBuilderNode
    title: Optional[Union[str, DataBinding]] = None
    elevation: Optional[CardElevation] = "low"
    id: Optional[str] = None
    component_name: str = field(default="Card", init=False)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"component": self.component_name}
        if self.child is not None:
            d["child"] = _serialize_prop(self.child)
        if self.title is not None:
            d["title"] = _serialize_prop(self.title)
        if self.elevation is not None:
            d["elevation"] = _serialize_prop(self.elevation)
        if self.id is not None:
            d["id"] = self.id
        return d

# =============================================================================
# Exports
# =============================================================================

__all__ = ["Card", "CardElevation", "Action", "DataBinding", "Surface", "bind"]
```

---

## Macro execution engine and identifier management

The macro engine coordinates macro registration, system prompt formatting, and runtime expansion.

### Authoring macros with `@macro`

Developers define macros using the `@macro` decorator on pure Python functions. The decorator inspects type annotations and docstrings:

```python
from a2ui.inference_formats.experimental.macros import macro
from a2ui.inference_formats.experimental.macros.builder import Card, Column, Text

@macro
def UserCard(username: str, role: str = "Member") -> Card:
    """Display user profile summary.

    Args:
        username: Full name of the user.
        role: Organizational role title.
    """
    return Card(
        child=Column(
            children=[
                Text(text=username, variant="h3"),
                Text(text=role, variant="caption"),
            ]
        )
    )
```

The decorator parses the function signature and docstrings to create metadata containing:
* The macro identifier (`UserCard`).
* Parameter names, types, default values, and parameter descriptions.
* A component description derived from the summary docstring.

### Macro inference format

`MacroInferenceFormat` wraps an underlying inference format (such as Express) to integrate macros into model prompts:

1. **System prompt augmentation:** The format registers each macro as an available component in the system prompt rules. The model sees the macro signature alongside standard catalog components.
2. **Inference interception:** When the model outputs `@UserCard(username="Marcus Vance")`, the parser identifies the macro invocation, validates supplied arguments against the macro signature, and passes the arguments to `MacroProcessor`.

### Macro processor and execution lifecycle

`MacroProcessor` executes the macro function and transforms the returned builder tree into standard A2UI messages:

1. **Invocation:** `MacroProcessor.expand_macro("UserCard", {"username": "Marcus Vance"})` calls the registered Python function.
2. **Evaluation:** The Python function executes, running any server-side database lookups or conditional logic, and returns the root `ComponentBuilderNode`.
3. **Serialization:** The processor calls `.to_dict()` or `Surface.to_messages()` on the root node to generate standard A2UI `createSurface` and `updateComponents` dictionaries.

### Identifier management and tree flattening

The A2UI wire protocol requires flat arrays of components with unique identifiers, where parent components reference children by string ID (e.g. `children: ["comp_1", "comp_2"]`). Manually managing string IDs in nested UI structures is error-prone.

The builder system automates identifier management during tree serialization:

1. **ID assignment phase:** During serialization, the builder traverses the node hierarchy depth-first. If a node has an explicit identifier set by the author (`Card(..., id="main_card")`), that identifier is preserved. If `id` is omitted, the serializer assigns a sequential deterministic identifier (`comp_0`, `comp_1`, `comp_2`).
2. **Reference resolution phase:** Parent containers (`Column`, `Row`, `Card`) holding child builder nodes automatically replace child node instances with their assigned string identifiers in the serialized output dictionary:
   ```json
   {
     "id": "comp_0",
     "component": "Column",
     "children": ["comp_1", "comp_2"]
   }
   ```
3. **Flattening:** All component dictionaries in the tree are collected into a single flat list, producing a valid A2UI `updateComponents` message payload.
