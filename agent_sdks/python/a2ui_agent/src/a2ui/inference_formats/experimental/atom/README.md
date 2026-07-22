# A2UI Atom Inference Format

The `a2ui.inference_formats.experimental.atom` package implements the Atom S-expression inference format for A2UI.

Atom represents user interface component trees as compact, token-efficient S-expressions, reducing model token output overhead while maintaining catalog agnosticism.

---

## Core Components

| Class                     | Module                | Role                                                                                                     |
| :------------------------ | :-------------------- | :------------------------------------------------------------------------------------------------------- |
| **`AtomFormat`**          | `format.py`           | Strategy provider implementing `InferenceFormat`. Configures parser and prompt generator.                |
| **`AtomParser`**          | `parser.py`           | Extracts, unwraps, compiles, and decompiles Atom S-expression blocks enclosed in `<a2ui>` sentinel tags. |
| **`AtomCompiler`**        | `compiler.py`         | Compiles S-expression ASTs into standard A2UI v1.0 JSON payloads.                                        |
| **`AtomDecompiler`**      | `decompiler.py`       | Decompiles A2UI v1.0 JSON payloads into clean Atom S-expressions.                                        |
| **`AtomPromptGenerator`** | `prompt_generator.py` | Builds system prompts, grammar instructions, and catalog signatures.                                     |

---

## Syntax Overview

Atom uses parenthesized S-expressions to represent component nodes and properties:

```lisp
<a2ui>
(Card
  (Column
    (Text "Order Confirmed!" :variant "h2")
    "Your package #12345 will arrive tomorrow."
    (Button :action (Event "trackPackage" :orderId "12345") (Text "Track Order"))))
</a2ui>
```

### Key Notation Features

- **Direct Tree Nesting**: Child components are nested directly inside parent container expressions without requiring explicit IDs or flat adjacency lists.
- **Tagged & Positional Properties**: Attributes use colon prefixes (`:variant "h2"`, `:align="center"`) or sequential positional parameter ordering matching catalog signatures.
- **Primitive Auto-Wrapping**: Raw string literals in container children lists are automatically wrapped into primitive text components (e.g., `(Text "content")`).
- **Comments**: Single-line comments starting with `;`, `;;`, or `#` are supported and ignored by the parser.
- **Data Bindings**: Data paths use `$/` prefixes (e.g. `$/user/name`).
- **Data State Initialization**: Data state is initialized using `(data $/path "value")` or `(set! $/path "value")`.
- **Dynamic List Templates**: List templates use `(template :item item (ChildComponent $/item/name))`.
- **Action Events**: Interactive controls express actions using `(Event "action_name" :param1 $/value)`.

---

## Python Usage Example

```python
from a2ui.basic_catalog import BasicCatalog
from a2ui.inference_formats.experimental.atom import AtomFormat

# 1. Initialize format with catalog
catalog = BasicCatalog()
atom_fmt = AtomFormat(catalog=catalog, surface_id="main")

# 2. Generate system prompt instructions
prompt = atom_fmt.prompt_generator.generate(
    role_description="You are a UI generator assistant."
)

# 3. Parse and compile model responses
raw_response = """
<a2ui>
(Card
  (Column
    (Text "Hello World!" :variant "h1")
    (Button :action (Event "buttonClick") (Text "Click Me"))))
</a2ui>
"""

compiled_messages = atom_fmt.parser.compile(raw_response)
print(compiled_messages[0])
```

---

## Decompilation Example

```python
from a2ui.inference_formats.experimental.atom import AtomDecompiler

decompiler = AtomDecompiler(catalog=catalog)
json_payload = {
    "createSurface": {
        "surfaceId": "main",
        "components": [
            {
                "id": "card_1",
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
    }
}

s_expr = decompiler.decompile(json_payload)
print(s_expr)
# Output: (Card (Column (Text "Hello World!")))
```
