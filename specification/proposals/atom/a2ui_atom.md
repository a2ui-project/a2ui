# A2UI Atom technical specification

A2UI Atom is an ultra-compact, model-optimized declarative inference format based on S-expressions (Lisp-style parenthesized ASTs). It is designed to minimize token usage, maximize streaming time-to-first-component (TTFC), and guarantee 100% schema-resilient parsing for generative user interfaces.

A host-side compiler parses this S-expression text stream and compiles it into standard A2UI v1.0 wire protocol payloads.

---

## Core design goals

- **Token efficiency:** Eliminates left-hand variable assignment boilerplate (`var_1 = ...`), array bracket markers (`children=[...]`), and closing tag repetition (`</ui-column>`), achieving a **25% to 50% token footprint reduction** compared to A2UI Express and Elemental.
- **Top-Down Streaming TTFC:** Parent container nodes (e.g. `(Column ...)` or `(Card ...)`) are emitted _before_ their child nodes. The host renderer can instantiate visible layout skeleton bounds immediately at token index 0 without waiting for child node completion.
- **100% Schema Resilience:** Properties are specified using tagged keyword pairs (`:justify "center"` `:align "stretch"`) or schema-driven positional parameters. Adding optional parameters to a catalog schema or reordering properties never breaks existing Atom payloads.
- **Deterministic Auto-Healing:** Structural boundaries are defined entirely by single-token parentheses `(` and `)`. If an LLM stream terminates early, the parser deterministically auto-closes missing `)` tokens at EOF to yield a renderable partial UI.

---

## Syntax and grammar

A2UI Atom layout blocks must be enclosed inside `<a2ui>` and `</a2ui>` sentinel tags:

```lisp
<a2ui>
(Card
  (Column :align "center"
    (Icon $/icon)
    (Text $/title)
    (Text $/description "body")
    (Row :justify "center"
      (Button :action (Event "accept") (Text "Yes"))
      (Button :action (Event "decline") (Text "No")))))
</a2ui>
```

---

### Expressions and Component Declarations

Every component definition in A2UI Atom is a parenthesized expression starting with the component name:

```lisp
(ComponentName :propKey1 value1 :propKey2 value2 child1 child2 ...)
```

- **Component Identifier:** The first symbol inside an expression is the catalog component name (e.g., `Card`, `Column`, `Text`, `Button`).
- **Tagged Keyword Attributes:** Properties prefixed with a colon `:` map directly to catalog schema keys (e.g., `:align "stretch"`, `:variant "body"`). Tagged keywords are order-independent.
- **Positional Attributes:** For high-frequency components, positional arguments map sequentially to catalog property definitions according to catalog schema order.
- **Child Elements:** Any nested parenthesized expression `(Component ...)` that is not bound to a specific property key is treated as a child element of the parent container's primary slot (`children` or `child`).

---

### Core Primitive Types

1. **Strings:**
   - Standard double-quoted strings: `"Hello World"`, `"Line 1\nLine 2"`. Supports `\n`, `\t`, `\\`, and `\"` escape sequences.
   - Multi-line strings: Triple double-quoted `"""Multi-line content"""`.
2. **Numbers:** Plain integers or decimals: `42`, `-3.14`.
3. **Booleans:** `true` or `false`.
4. **Null values:** `null`.

---

### Data Binding and Reactive Paths

To connect component properties to the application data model, path references use the `$` prefix:

- **Absolute Paths:** Prefixed with `$/` (e.g., `$/user/email`, `$/flight/status`). Resolves from the root of the shared data model.
- **Relative Paths:** Prefixed with `$` (e.g., `$name`, `$price`). Resolves within template iteration contexts.
- **Root Context:** A lone `$` represents the root item itself in template lists.

---

### Data Model Population

To populate or initialize data in the shared model directly from the stream, Atom supports top-level data assignment expressions:

```lisp
(set! $/user/name "Alice")
(set! $/user/age 30)
```

Or a single combined data block:

```lisp
(data
  $/icon "check"
  $/title "Enable notification"
  $/description "Get alerts for order status changes")
```

The compiler extracts these assignments and populates the `dataModel` payload in the resulting `createSurface` message. If the block contains only `set!` or `data` expressions and no component tree, the compiler emits a standalone `updateDataModel` protocol message.

---

### Dynamic List Templates

Dynamic list repetition uses the `template` helper expression:

```lisp
(List :items $/breeds
  (template :item item
    (Card
      (Text :text item/name))))
```

The compiler translates this into the standard A2UI v1.0 `ChildList` template node payload.

---

### Validation and Logic Expressions

Validation rules are expressed using nested logic expressions:

```lisp
(TextInput :value $/user/zip
  :checks [ (required) (regex "^[0-9]{5}$" "Zip code must be 5 digits") ])
```

The compiler maps these into standard `FunctionCall` objects in the component's `checks` array.

---

### Standalone Operations (Surface Lifecycle & RPC)

1. **Deleting a Surface:**
   ```lisp
   (deleteSurface "dashboard-surface-1")
   ```
2. **Executing Client RPC Functions:**
   ```lisp
   (callFunction "openUrl" :url "https://example.com")
   ```

---

## Compilation Example

### Input A2UI Atom Stream

```lisp
<a2ui>
(data
  $/icon "check"
  $/title "Enable notification"
  $/description "Get alerts for order status changes")

(Card
  (Column :align "center"
    (Icon $/icon)
    (Text $/title)
    (Text $/description "body")
    (Row :justify "center"
      (Button :action (Event "accept") (Text "Yes"))
      (Button :action (Event "decline") (Text "No")))))
</a2ui>
```

### Compiled A2UI v1.0 JSON Message

```json
{
  "version": "v1.0",
  "createSurface": {
    "surfaceId": "main",
    "catalogId": "basic",
    "components": [
      {"id": "node_0", "component": "Card", "child": "node_1"},
      {
        "id": "node_1",
        "component": "Column",
        "children": ["node_2", "node_3", "node_4", "node_5"],
        "align": "center"
      },
      {"id": "node_2", "component": "Icon", "name": {"path": "/icon"}},
      {"id": "node_3", "component": "Text", "text": {"path": "/title"}},
      {"id": "node_4", "component": "Text", "text": {"path": "/description"}, "variant": "body"},
      {"id": "node_5", "component": "Row", "children": ["node_6", "node_8"], "justify": "center"},
      {"id": "node_6", "component": "Button", "child": "node_7", "action": {"event": "accept"}},
      {"id": "node_7", "component": "Text", "text": "Yes"},
      {"id": "node_8", "component": "Button", "child": "node_9", "action": {"event": "decline"}},
      {"id": "node_9", "component": "Text", "text": "No"}
    ],
    "dataModel": {
      "icon": "check",
      "title": "Enable notification",
      "description": "Get alerts for order status changes"
    }
  }
}
```
