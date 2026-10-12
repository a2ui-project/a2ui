# A2UI Atom Inference Format

The `a2ui.inference_formats.experimental.atom` package implements the Atom S-expression inference format for A2UI.

Atom represents user interface component trees as compact, token-efficient S-expressions, reducing model token output overhead while maintaining catalog agnosticism.

---

## Core Components

| Class                     | Module                | Role                                                                                                     |
| :------------------------ | :-------------------- | :------------------------------------------------------------------------------------------------------- |
| **`AtomFormat`**          | `format.py`           | Strategy provider implementing `InferenceFormat`. Configures parser and prompt generator.                |
| **`AtomParser`**          | `parser.py`           | Extracts, unwraps, compiles, and decompiles Atom S-expression blocks enclosed in `<a2ui>` sentinel tags. |
| **`AtomCompiler`**        | `compiler.py`         | Compiles Atom text into A2UI messages for the catalogs' protocol version (v1.0, v0.9 or v0.9.1).         |
| **`AtomDecompiler`**      | `decompiler.py`       | Decompiles A2UI messages into Atom S-expressions that compile back to the same messages.                 |
| **`AtomPromptGenerator`** | `prompt_generator.py` | Builds system prompts, grammar instructions, and catalog signatures.                                     |

---

## Syntax Overview

Atom uses parenthesized S-expressions to represent component nodes and properties:

```lisp
<a2ui>
(Card
  (Column
    (Text "Order Confirmed!" :variant "caption")
    "Your package #12345 will arrive tomorrow."
    (Button :action (Event "trackPackage" :orderId "12345") (Text "Track Order"))))
</a2ui>
```

### Key Notation Features

- **Direct Tree Nesting**: Child components are nested directly inside parent container expressions. Component ids are generated; `:id "name"` is optional and only needed when a later update refers to the component.
- **Tagged & Positional Properties**: Attributes use colon prefixes (`:variant "caption"`) or sequential positional parameters matching catalog signature order.
- **Primitive Auto-Wrapping**: Raw string literals in container children lists are wrapped in the catalog's text component (the component whose only property is named `text`, `content`, `label` or `title`). String items inside an explicit `:children [...]` list are component id references.
- **Comments**: Comments start with `;`, or with `#` followed by a space, and run to the end of the line.
- **Data Bindings**: Data paths use `$/` prefixes (e.g. `$/user/name`); `(@path "relative/path")` writes any path exactly.
- **Data State Initialization**: Data state is initialized using `(data $/path "value")` or `(set! $/path "value")`.
- **Dynamic List Templates**: `(List :children (template :items $/items (ChildComponent $/item/name)))`.
- **Action Events**: Interactive controls express actions using `(Event "action_name" :param1 $/value)`.

### Messages

A block of Atom text can produce several messages, in source order:

| Form                                                                   | Message                                                                    |
| :--------------------------------------------------------------------- | :------------------------------------------------------------------------- |
| `(surface "id" [:catalogId "c"] [:sendDataModel true] ...)`            | Starts a `createSurface`; following trees and data belong to it.           |
| `(updateComponents "id" [:catalogId "c"])`                             | Starts an `updateComponents`; following trees (with `:id`) belong to it.   |
| `(updateDataModel "id" [:path "/p"] :value v)`                         | An `updateDataModel`. In v1.0 `:value` is required; `:value null` deletes. |
| `(deleteSurface "id")`                                                 | A `deleteSurface`.                                                         |
| `(callFunction "name" [:functionCallId "id"] [:catalogId "c"] :arg v)` | A `callRendererFunction` (v1.0 only).                                      |

Trees and data before any header create the format's default surface. Text with only data compiles to a root `updateDataModel`.

For v0.9 and v0.9.1 catalogs, a surface compiles to `createSurface`, `updateComponents` and `updateDataModel` messages, and the v1.0-only constructs (component and function `:catalogId` overrides, `callFunction`) are rejected.

### Multiple Catalogs

With several active catalogs (A2UI v1.0 and later), `createSurface` omits `catalogId` and the surface has no default catalog. Specifying `:catalogId` in a `(surface ...)` or `(updateComponents ...)` header is not permitted.

Instead, components and function calls without `:catalogId` are looked up by name across all active catalogs. A component or function expression needs an explicit `:catalogId "catalog_id"` argument only when its name is defined in more than one catalog.

---

## Python Usage Example

```python
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.experimental.atom import AtomFormat

# 1. Initialize format with catalog
catalog = BasicCatalog("1.0")
atom_fmt = AtomFormat([catalog], surface_id="main")

# 2. Generate system prompt instructions
prompt = atom_fmt.prompt_generator.generate(
    role_description="You are a UI generator assistant."
)

# 3. Parse and compile model responses
raw_response = """
<a2ui>
(Card
  (Column
    (Text "Hello World!")
    (Button :action (Event "buttonClick") (Text "Click Me"))))
</a2ui>
"""

parts = atom_fmt.create_parser().parse_response(raw_response)
print(parts[0].a2ui)
```

---

## Decompilation Example

```python
from a2ui.inference_formats import to_message_models
from a2ui.inference_formats.experimental.atom import AtomDecompiler

decompiler = AtomDecompiler([catalog])
json_payload = {
    "version": "v1.0",
    "createSurface": {
        "surfaceId": "main",
        "catalogId": catalog.catalog_id,
        "components": [
            {
                "id": "root",
                "component": "Card",
                "child": "col_1",
            },
            {
                "id": "col_1",
                "component": "Column",
                "children": ["txt_1"],
            },
            {
                "id": "txt_1",
                "component": "Text",
                "text": "Hello World!",
            },
        ],
    },
}

# `decompile` takes a sequence of AgentToRendererMessage models.
s_expr = decompiler.decompile(to_message_models([json_payload]))
print(s_expr)
# Output:
# (surface "main")
# (Card
#   (Column :id "col_1"
#     (Text :id "txt_1" :text "Hello World!")))
```
