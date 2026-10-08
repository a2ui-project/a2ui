# A2UI Atom technical specification

A2UI Atom is an ultra-compact, model-optimized declarative inference format based on S-expressions (Lisp-style parenthesized ASTs). It is designed to minimize token usage, maximize streaming time-to-first-component (TTFC), and guarantee 100% schema-resilient parsing for generative user interfaces.

A host-side compiler parses this S-expression text stream and compiles it into standard A2UI wire protocol messages for the protocol version of its catalogs (v1.0, v0.9.1 or v0.9).

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
; Initial data state
(data $/title "Notification")

(Card
  (Column :align "center"
    (Icon $/icon)
    (Text $/title)
    "Get alerts for order status changes"
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
- **Tagged Keyword Attributes:** Properties prefixed with a colon `:` map directly to catalog schema keys (e.g., `:align "stretch"`, `:variant "body"`). Tagged keywords support space separation (`:align "center"`) as well as assignment shorthand (`:align="center"`), and are order-independent.
- **Positional Attributes:** For high-frequency components, positional arguments map sequentially to catalog property definitions according to catalog schema order.
- **Child Elements & Auto-wrapping:** Any nested parenthesized expression `(Component ...)` that is not bound to a specific property key is treated as a child element of the parent container's primary slot (`children` or `child`). Direct text string literals inside container children lists are automatically wrapped into primitive text components (e.g. `(Text "content")`).
- **Comments:** Single-line comments starting with `;` (or `;;` or `#`) are supported and stripped by the parser.

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
- **Relative Paths:** Prefixed with `$/` or `$` or relative symbol name (e.g., `$/item/name`, `item/name`, `$name`). Resolves within template iteration contexts.
- **Root Context:** A lone `$` represents the root item itself in template lists.

---

### Data Model Population

To populate or initialize data in the shared model directly from the stream, Atom supports top-level or embedded data assignment expressions:

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

`(data ...)` also supports nested map and list structures:

```lisp
(data
  $/user (:name "Alice" :role "admin")
  $/items [(:id 1 :title "First") (:id 2 :title "Second")])
```

The compiler extracts these assignments and populates the `dataModel` payload in the resulting `createSurface` message. If the stream contains only `set!` or `data` expressions, no component tree and no surface header, the compiler emits a standalone `updateDataModel` message for the root path.

---

### Dynamic List Templates

Dynamic list repetition uses the `template` helper expression:

```lisp
(List :items $/breeds
  (template :item item
    (Card
      (Text $/item/name))))
```

The template expression accepts `:item <var>` to define the relative iteration variable name (defaulting to `item`). Relative property paths inside the template (such as `$/item/name` or `item/name`) resolve relative to each item in the list context. The compiler translates this into the standard A2UI v1.0 `ChildList` template node payload.

---

### Validation and Logic Expressions

Validation rules and logic functions are expressed using nested function expressions inside the `:checks` property:

```lisp
(TextField "Zip code" $/user/zip
  :checks [ (required) (regex :pattern "^[0-9]{5}$" :message "Zip code must be 5 digits") ])
```

The functions come from the catalog; the compiler has no built-in list of them. A check that leaves out the `value` argument checks the component's own `value` binding, and `:message` sets the check's error message. The compiler wraps each check in a `CheckRule`, `{"condition": <FunctionCall>, "message": ...}`, in the component's `checks` array.

Check arguments can also be positional. When a check's first catalog argument is `value` and it is bound implicitly (the component has a `value` and the first positional argument is not a data binding) or passed as `:value`, positional arguments fill the arguments after `value`. A string past the last argument is the message. So `(regex "^[0-9]{5}$" "Zip code must be 5 digits")` is the same check as the keyword form above, and `(regex $/other "^a$" "Must be a")` checks `$/other` instead.

---

### Action Events

Interactive controls trigger action events using the `Event` helper:

```lisp
(Button :action (Event "submitForm" :formId "user_form" :value $/user/zip)
  (Text "Submit"))
```

Action expressions support both tagged parameter pairs (`:param value`) and positional arguments. The compiler formats these into standard A2UI action event objects: `{"event": {"name": "action_name", "context": {...}}}`.

---

### Messages and surfaces

A block of Atom text can produce several messages, in source order. Header forms start a message, and the trees and data that follow belong to it until the next header:

| Form                                                                   | Message                                                                                                          |
| :--------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| `(surface "id" [:catalogId "c"] [:sendDataModel true])`                | A `createSurface` with the following trees and data.                                                             |
| `(updateComponents "id" [:catalogId "c"])`                             | An `updateComponents` with the following trees. Give each tree an `:id` so it replaces the component it targets. |
| `(updateDataModel "id" [:path "/p"] :value v)`                         | An `updateDataModel`. In v1.0 `:value` is required, and `:value null` deletes the value at the path.             |
| `(deleteSurface "id")`                                                 | A `deleteSurface`.                                                                                               |
| `(callFunction "name" [:functionCallId "id"] [:catalogId "c"] :arg v)` | A `callRendererFunction`. It exists only in v1.0.                                                                |

Trees and data before any header create the compiler's default surface. A `(surface ...)` header with only data still creates the surface. Component ids are generated; an explicit `:id` never collides with a generated id.

```lisp
(updateComponents "dashboard-surface-1")
(Text :id "status_text" "Updated 1m ago" "caption")
(updateDataModel "dashboard-surface-1" :path "/metrics/sales" :value 15800)
(callFunction "openUrl" :functionCallId "open_1" :url "https://example.com")
(deleteSurface "old-surface")
```

For v0.9 and v0.9.1 catalogs, a surface compiles to `createSurface`, `updateComponents` and `updateDataModel` messages, and the compiler rejects the constructs that only v1.0 has: a `:catalogId` on a single component or function call, and `callFunction`.

### Catalogs

With a single catalog, `createSurface` carries that catalog's `catalogId` (and `(surface "id" :catalogId "c")` is optional). With more than one catalog (supported in v1.0 and newer), `createSurface` omits `catalogId`, naming `:catalogId` on `surface` or `updateComponents` is an error, and every compiled component and function call carries its own `catalogId`. A component or function call written without `:catalogId` resolves by name across the active catalogs when exactly one catalog defines it, and requires an explicit `:catalogId "c"` when multiple catalogs define that name:

```lisp
(surface "main")
(Column
  (Chart $/sales :catalogId "https://example.com/charts.json")
  (Text $/summary))
```

For v1.0 catalogs, the compiler writes data bindings as `{"@path": ...}` and function calls as `{"@call": ..., "args": ...}`. For v0.9 and v0.9.1 catalogs, it writes `path` and `call`.

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
    "Get alerts for order status changes"
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
    "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
    "components": [
      {
        "id": "root",
        "component": "Card",
        "child": "node_0"
      },
      {
        "id": "node_0",
        "component": "Column",
        "align": "center",
        "children": ["node_1", "node_2", "node_3", "node_4"]
      },
      {
        "id": "node_4",
        "component": "Row",
        "justify": "center",
        "children": ["node_5", "node_7"]
      },
      {
        "id": "node_7",
        "component": "Button",
        "action": {
          "event": {
            "name": "decline"
          }
        },
        "child": "node_8"
      },
      {
        "id": "node_8",
        "component": "Text",
        "text": "No"
      },
      {
        "id": "node_5",
        "component": "Button",
        "action": {
          "event": {
            "name": "accept"
          }
        },
        "child": "node_6"
      },
      {
        "id": "node_6",
        "component": "Text",
        "text": "Yes"
      },
      {
        "id": "node_3",
        "component": "Text",
        "text": "Get alerts for order status changes"
      },
      {
        "id": "node_2",
        "component": "Text",
        "text": {
          "@path": "/title"
        }
      },
      {
        "id": "node_1",
        "component": "Icon",
        "name": {
          "@path": "/icon"
        }
      }
    ],
    "dataModel": {
      "icon": "check",
      "title": "Enable notification",
      "description": "Get alerts for order status changes"
    }
  }
}
```
