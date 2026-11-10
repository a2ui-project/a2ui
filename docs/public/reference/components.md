# Component Gallery

This page showcases all A2UI components with examples and usage patterns.

> NOTE: Schema Files
>
> === "v1.0"
>
>     [:material-code-json: Basic Catalog Definition (JSON Schema)](../../../catalogs/basic/v1/catalog.json)
>
> === "v0.9.1"
>
>     [:material-code-json: Basic Catalog Definition (JSON Schema)](../../../specification/v0_9_1/catalogs/basic/catalog.json)

---

## Layout Components

### Row

Horizontal layout container. Children are arranged left-to-right.

**Properties:** `children` (array or template), `justify`, `align`

```json
{
  "id": "toolbar",
  "component": "Row",
  "children": [
    "btn1",
    "btn2",
    "btn3"
  ],
  "justify": "spaceBetween",
  "align": "center"
}
```

### Column

Vertical layout container. Children are arranged top-to-bottom.

**Properties:** `children` (array or template), `justify`, `align`

```json
{
  "id": "content",
  "component": "Column",
  "children": [
    "header",
    "body",
    "footer"
  ],
  "justify": "start",
  "align": "stretch"
}
```

### List

Scrollable list of items. Supports static children and dynamic templates.

**Properties:** `children` (array or template), `direction`, `align`

```json
{
  "id": "message-list",
  "component": "List",
  "children": {
    "componentId": "message-item",
    "path": "/messages"
  },
  "direction": "vertical"
}
```

---

## Display Components

### Text

Display text content with styling hints.

=== "v1.0"

    **Properties:** `text` (string or dynamic value), `variant`

    `variant` values: `caption`, `body`. Text supports simple Markdown, so use Markdown headings (`#`, `##`) for titles.

    ```json
    {
      "id": "title",
      "component": "Text",
      "text": "# Welcome to A2UI"
    }
    ```

=== "v0.9.1"

    **Properties:** `text` (string or DataBinding), `variant`

    `variant` values: `h1`, `h2`, `h3`, `h4`, `h5`, `caption`, `body`

    ```json
    {
      "id": "title",
      "component": "Text",
      "text": "Welcome to A2UI",
      "variant": "h1"
    }
    ```

### Image

Display images from URLs.

**Properties:** `url` (string or dynamic value), `description`, `fit`, `variant`

```json
{
  "id": "hero",
  "component": "Image",
  "url": "https://example.com/hero.png",
  "description": "Product hero image",
  "fit": "cover",
  "variant": "header"
}
```

### Icon

Display icons from the basic set defined in the catalog.

**Properties:** `name` (string or DataBinding)

```json
{
  "id": "check-icon",
  "component": "Icon",
  "name": "check"
}
```

### Video

Play a video from a URL.

=== "v1.0"

    **Properties:** `url` (string or dynamic value), `posterUrl`

    ```json
    {
      "id": "intro-video",
      "component": "Video",
      "url": "https://example.com/intro.mp4",
      "posterUrl": "https://example.com/intro-poster.png"
    }
    ```

=== "v0.9.1"

    **Properties:** `url` (string or dynamic value)

    ```json
    {
      "id": "intro-video",
      "component": "Video",
      "url": "https://example.com/intro.mp4"
    }
    ```

### Divider

Visual separator line.

**Properties:** `axis`

```json
{
  "id": "separator",
  "component": "Divider",
  "axis": "horizontal"
}
```

---

## Interactive Components

### Button

Clickable button that triggers an action.

**Properties:** `child` (component ID), `variant`, `action`, `checks`

```json
{
  "id": "submit-btn",
  "component": "Button",
  "child": "submit-text",
  "variant": "primary",
  "action": {
    "event": {
      "name": "submit_form"
    }
  }
}
```

### TextField

Text input field with optional validation.

=== "v1.0"

    **Properties:** `label`, `value` (required), `placeholder`, `variant`, `checks`

    `variant` values: `shortText`, `longText`, `number`, `obscured`. Use `checks` with the `regex` function to validate the input.

    ```json
    {
      "id": "email-input",
      "component": "TextField",
      "label": "Email Address",
      "value": {
        "@path": "/user/email"
      },
      "placeholder": "name@example.com",
      "variant": "shortText",
      "checks": [
        {
          "condition": {
            "@call": "email",
            "args": {
              "value": {
                "@path": "/user/email"
              }
            }
          },
          "message": "Enter a valid email address"
        }
      ]
    }
    ```

=== "v0.9.1"

    **Properties:** `label`, `value`, `variant`, `validationRegexp`, `checks`

    `variant` values: `shortText`, `longText`, `number`, `obscured`

    ```json
    {
      "id": "email-input",
      "component": "TextField",
      "label": "Email Address",
      "value": {
        "path": "/user/email"
      },
      "variant": "shortText"
    }
    ```

### CheckBox

Boolean toggle.

=== "v1.0"

    **Properties:** `label`, `value` (boolean)

    ```json
    {
      "id": "terms-checkbox",
      "component": "CheckBox",
      "label": "I agree to the terms",
      "value": {
        "@path": "/form/agreedToTerms"
      }
    }
    ```

=== "v0.9.1"

    **Properties:** `label`, `value` (boolean)

    ```json
    {
      "id": "terms-checkbox",
      "component": "CheckBox",
      "label": "I agree to the terms",
      "value": {
        "path": "/form/agreedToTerms"
      }
    }
    ```

### Slider

Numeric range input.

=== "v1.0"

    **Properties:** `value`, `min`, `max`, `steps`, `label`

    ```json
    {
      "id": "volume",
      "component": "Slider",
      "value": {
        "@path": "/settings/volume"
      },
      "min": 0,
      "max": 100,
      "steps": 10
    }
    ```

=== "v0.9.1"

    **Properties:** `value`, `min`, `max`, `label`

    ```json
    {
      "id": "volume",
      "component": "Slider",
      "value": {
        "path": "/settings/volume"
      },
      "min": 0,
      "max": 100
    }
    ```

### DateTimeInput

Date and/or time picker.

=== "v1.0"

    **Properties:** `value`, `enableDate`, `enableTime`, `min`, `max`, `label`

    ```json
    {
      "id": "date-picker",
      "component": "DateTimeInput",
      "value": {
        "@path": "/booking/date"
      },
      "enableDate": true,
      "enableTime": false
    }
    ```

=== "v0.9.1"

    **Properties:** `value`, `enableDate`, `enableTime`, `min`, `max`, `label`

    ```json
    {
      "id": "date-picker",
      "component": "DateTimeInput",
      "value": {
        "path": "/booking/date"
      },
      "enableDate": true,
      "enableTime": false
    }
    ```

### ChoicePicker

Select one or more options from a list.

=== "v1.0"

    **Properties:** `options` (array), `value` (string array), `variant`, `displayStyle`, `filterable`, `label`

    ```json
    {
      "id": "country-select",
      "component": "ChoicePicker",
      "options": [
        {
          "label": "USA",
          "value": "us"
        },
        {
          "label": "Canada",
          "value": "ca"
        }
      ],
      "value": {
        "@path": "/form/country"
      },
      "variant": "mutuallyExclusive"
    }
    ```

=== "v0.9.1"

    **Properties:** `options` (array), `value` (string array), `variant`, `displayStyle`, `filterable`, `label`

    ```json
    {
      "id": "country-select",
      "component": "ChoicePicker",
      "options": [
        {
          "label": "USA",
          "value": "us"
        },
        {
          "label": "Canada",
          "value": "ca"
        }
      ],
      "value": {
        "path": "/form/country"
      },
      "variant": "mutuallyExclusive"
    }
    ```

---

## Container Components

### Card

Container with elevation/border and padding.

**Properties:** `child` (component ID)

```json
{
  "id": "info-card",
  "component": "Card",
  "child": "card-content"
}
```

### Modal

Overlay dialog opened by a trigger component.

**Properties:** `trigger` (component ID), `content` (component ID)

```json
{
  "id": "confirmation-modal",
  "component": "Modal",
  "trigger": "open-modal-btn",
  "content": "modal-content"
}
```

### Tabs

Tabbed interface for organizing content into switchable panels.

**Properties:** `tabs` (array of `{ title, child }`)

```json
{
  "id": "settings-tabs",
  "component": "Tabs",
  "tabs": [
    {
      "title": "General",
      "child": "general-tab"
    },
    {
      "title": "Privacy",
      "child": "privacy-tab"
    }
  ]
}
```

---

## Common Properties

All components share:

- `id` (required): Unique identifier within the surface.
- `weight`: Flex-grow value when inside a Row or Column.
- `accessibility`: Attributes for assistive technologies such as screen readers. There is no `role` key.
    - v0.9.1 and later: `label` and `description`. Each takes a string or a dynamic value (a data binding or a function call).
    - v1.0 and later: adds `live` (`"off"`, `"polite"`, or `"assertive"`; default `"off"`) and `hidden` (a boolean or a dynamic value; default `false`). Any other key fails validation.

In these examples the label is static and the description comes from the data model. In v1.0, screen readers also announce text changes politely, and the text is hidden from assistive technologies while `/order/visible` is false:

=== "v1.0"

    ```json
    {
      "id": "order_status",
      "component": "Text",
      "text": {"@path": "/order/status"},
      "accessibility": {
        "label": "Order status",
        "description": {"@path": "/order/statusDetails"},
        "live": "polite",
        "hidden": {"@call": "not", "args": {"value": {"@path": "/order/visible"}}}
      }
    }
    ```

=== "v0.9.1"

    ```json
    {
      "id": "order_status",
      "component": "Text",
      "text": {"path": "/order/status"},
      "accessibility": {
        "label": "Order status",
        "description": {"path": "/order/statusDetails"}
      }
    }
    ```

## Version Differences Summary

The component names and most properties are the same in v1.0 and v0.9.1. The differences are:

| Aspect               | v1.0                                              | v0.9.1                                     |
| -------------------- | ------------------------------------------------- | ------------------------------------------ |
| Data binding         | `{ "@path": "/data" }`                            | `{ "path": "/data" }`                      |
| Function call        | `{ "@call": "fn", "args": { ... } }`              | `{ "call": "fn", "args": { ... } }`        |
| Text styling         | `variant`: `caption` or `body`; Markdown headings | `variant`: `h1` to `h5`, `caption`, `body` |
| TextField validation | `checks` with the `regex` function                | `validationRegexp` or `checks`             |
| TextField            | `value` required; adds `placeholder`              | `value` optional                           |
| Video                | adds `posterUrl`                                  | `url` only                                 |
| Slider               | adds `steps`                                      | `min`, `max`, `value`                      |
| Accessibility        | adds `live` and `hidden`                          | `label` and `description`                  |

See the [v1.0 evolution guide](../specification/v1.0-evolution-guide.md) for the full list of changes.

## Live Examples

To see all components in action:

```bash
cd samples/client/angular
yarn start gallery
```

> [!NOTE]
> **Package Manager Usage:** Running the built-in sample applications within the A2UI repository requires Yarn (`yarn start gallery`) as configured by Corepack workspaces. For your own regular usage and standalone projects outside this repository, use the package manager of your choice (e.g. npm, pnpm).

## Further Reading

> NOTE: Schema Files
>
> === "v1.0"
>
>     [:material-code-json: Basic Catalog Definition (JSON Schema)](../../../catalogs/basic/v1/catalog.json)
>
> === "v0.9.1"
>
>     [:material-code-json: Basic Catalog Definition (JSON Schema)](../../../specification/v0_9_1/catalogs/basic/catalog.json)

- **[Defining Your Own Catalog](../guides/defining-your-own-catalog.md)**: Build your own components
- **[Theming Guide](../guides/theming.md)**: Style components to match your brand
