# Data Binding

Data binding connects UI components to application state using JSON Pointer paths ([RFC 6901](https://tools.ietf.org/html/rfc6901)). It allows A2UI to efficiently define layouts for large arrays of data and to show updated content without regenerating it from scratch.

## Structure vs. State

A2UI separates:

1. **UI Structure** (Components): What the interface looks like
2. **Application State** (Data Model): What data it displays

This enables:

- Reactive updates.
- Data-driven UIs.
- Reusable templates.
- Bidirectional binding.

## The Data Model

Each surface has a JSON object holding state:

```json
{
  "user": {"name": "Alice", "email": "alice@example.com"},
  "cart": {
    "items": [{"name": "Widget", "price": 9.99, "quantity": 2}],
    "total": 19.98
  }
}
```

## JSON Pointer Paths

**Syntax:**

- `/user/name` - Object property
- `/cart/items/0` - Array index (zero-based)
- `/cart/items/0/price` - Nested path

**Example:**

```json
{"user": {"name": "Alice"}, "items": ["Apple", "Banana"]}
```

- `/user/name` → `"Alice"`
- `/items/0` → `"Apple"`

## Literal vs. Path Values

=== "v0.8"

    **Literal (fixed):**
    ```json
    {
      "id": "title",
      "component": {
        "Text": {
          "text": { "literalString": "Welcome" }
        }
      }
    }
    ```

    **Data-bound (reactive):**
    ```json
    {
      "id": "username",
      "component": {
        "Text": {
          "text": { "path": "/user/name" }
        }
      }
    }
    ```

=== "v0.9 and later"

    **Literal (fixed):**
    ```json
    {
      "id": "title",
      "component": "Text",
      "text": "Welcome"
    }
    ```

    **Data-bound (reactive):**
    ```json
    {
      "id": "username",
      "component": "Text",
      "text": { "path": "/user/name" }
    }
    ```

When `/user/name` changes from "Alice" to "Bob", the text **automatically updates** to "Bob".

## Reactive Updates

Components bound to data paths automatically update when the data changes:

=== "v0.8"

    ```json
    {
      "id": "status",
      "component": {
        "Text": {
          "text": {"path": "/order/status"}
        }
      }
    }
    ```

=== "v0.9 and later"

    ```json
    {
      "id": "status",
      "component": "Text",
      "text": {"path": "/order/status"}
    }
    ```

- **Initial:** `/order/status` = "Processing..." → displays "Processing..."
- **Update:** Send a data model update with `status: "Shipped"` → displays "Shipped"

No component updates needed—just data updates.

## Dynamic Lists

Use templates to render arrays:

=== "v0.8"

    ```json
    {
      "id": "product-list",
      "component": {
        "Column": {
          "children": {
            "template": {
              "dataBinding": "/products",
              "componentId": "product-card"
            }
          }
        }
      }
    }
    ```

=== "v0.9 and later"

    ```json
    {
      "id": "product-list",
      "component": "Column",
      "children": {
        "path": "/products",
        "componentId": "product-card"
      }
    }
    ```

**Data:**

```json
{
  "products": [
    {"name": "Widget", "price": 9.99},
    {"name": "Gadget", "price": 19.99}
  ]
}
```

**Result:** Two cards rendered, one per product.

### Scoped Paths

Inside a template, paths are scoped to the array item:

=== "v0.8"

    ```json
    {
      "id": "product-name",
      "component": {
        "Text": {
          "text": {"path": "/name"}
        }
      }
    }
    ```

    - For `/products/0`, `/name` resolves to `/products/0/name` → "Widget"
    - For `/products/1`, `/name` resolves to `/products/1/name` → "Gadget"

=== "v0.9 and later"

    ```json
    {
      "id": "product-name",
      "component": "Text",
      "text": {"path": "name"}
    }
    ```

    - For `/products/0`, `name` resolves to `/products/0/name` → "Widget"
    - For `/products/1`, `name` resolves to `/products/1/name` → "Gadget"

Adding/removing items automatically updates the rendered components.

## Input Bindings

Interactive components update the data model bidirectionally:

=== "v0.8"

    | Component          | Example                                     | User Action      | Data Update                |
    | ------------------ | ------------------------------------------- | ---------------- | -------------------------- |
    | **TextField**      | `{"text": {"path": "/form/name"}}`          | Types "Alice"    | `/form/name` = `"Alice"`   |
    | **CheckBox**       | `{"value": {"path": "/form/agreed"}}`       | Checks box       | `/form/agreed` = `true`    |
    | **MultipleChoice** | `{"selections": {"path": "/form/country"}}` | Selects "Canada" | `/form/country` = `["ca"]` |

=== "v0.9 and later"

    | Component          | Example                                     | User Action      | Data Update                |
    | ------------------ | ------------------------------------------- | ---------------- | -------------------------- |
    | **TextField**      | `{"value": {"path": "/form/name"}}`         | Types "Alice"    | `/form/name` = `"Alice"`   |
    | **CheckBox**       | `{"value": {"path": "/form/agreed"}}`       | Checks box       | `/form/agreed` = `true`    |
    | **ChoicePicker**   | `{"value": {"path": "/form/country"}}`      | Selects "Canada" | `/form/country` = `["ca"]` |

## Best Practices

- **Use granular updates**: Update only changed paths.

=== "v0.8"

    ```json
    {
      "dataModelUpdate": {
        "path": "/user",
        "contents": [{"key": "name", "valueString": "Alice"}]
      }
    }
    ```

=== "v0.9 and later"

    ```json
    {
      "version": "v0.9.1",
      "updateDataModel": {
        "surfaceId": "user_profile",
        "path": "/user/name",
        "value": "Alice"
      }
    }
    ```

- **Organize by domain**: Group related data.

    ```json
    {"user": {...}, "cart": {...}, "ui": {...}}
    ```

- **Pre-compute display values**: Formats data (currency, dates) on the agent before sending.

    ```json
    {"price": "$19.99"} // Not: {"price": 19.99}
    ```
