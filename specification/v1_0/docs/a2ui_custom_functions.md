# Defining Custom Functions

A2UI functions are defined inside a Catalog. When defining your own catalog, you can include custom functions that are specific to your application or design system.

This guide demonstrates how to define a string `trim` function and a hardware query function (`getScreenResolution`) in your catalog.

## 1. Define the Catalog

Create a JSON Schema file (e.g., `my_catalog.json`) that defines your
function parameters.

Use the `functions` property to define a map of function schemas.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.com/schemas/custom_catalog.json",
  "title": "Custom Function Catalog",
  "description": "Extension catalog adding string trimming and screen resolution functions.",
  "functions": {
    "trim": {
      "type": "object",
      "description": "Removes whitespace (or other characters) from the beginning and end of a string.",
      "returnType": "string",
      "properties": {
        "call": {"const": "trim"},
        "args": {
          "type": "object",
          "properties": {
            "value": {
              "$ref": "common_types.json#/$defs/DynamicString",
              "description": "The string to trim."
            },
            "chars": {
              "$ref": "common_types.json#/$defs/DynamicString",
              "description": "Optional. A set of characters to remove. Defaults to whitespace."
            }
          },
          "required": ["value"],
          "unevaluatedProperties": false
        }
      },
      "required": ["call", "args"],
      "unevaluatedProperties": false
    },
    "getScreenResolution": {
      "type": "object",
      "description": "Queries hardware for screen resolution.",
      "returnType": "array",
      "properties": {
        "call": {"const": "getScreenResolution"},
        "args": {
          "type": "object",
          "properties": {
            "screenIndex": {
              "$ref": "common_types.json#/$defs/DynamicNumber",
              "description": "Optional. The index of the screen to query. Defaults to 0 (primary screen)."
            }
          },
          "unevaluatedProperties": false
        }
      },
      "required": ["call", "args"],
      "unevaluatedProperties": false
    }
  }
}
```

## 2. Make the functions available

The `FunctionCall` definition refers to a [catalog-agnostic reference](a2ui_protocol.md#the-basic-catalog).
In your catalog, you simply need to define the `anyFunction` reference:

```json
{
  "$defs": {
    "anyFunction": {
      "oneOf": [{"$ref": "#/functions/trim"}, {"$ref": "#/functions/getScreenResolution"}]
    }
  }
}
```

If you want to incorporate functions defined in the [`catalogs/basic/catalog.json`],
those can be added too:

```json
{
  "$defs": {
    "anyFunction": {
      "oneOf": [
        {"$ref": "#/functions/trim"},
        {"$ref": "#/functions/getScreenResolution"},
        {"$ref": "catalogs/basic/catalog.json#/$defs/anyFunction"}
      ]
    }
  }
}
```

## How Validation Works

When a `FunctionCall` is validated:

1. **Discriminator Lookup:** The validator looks at the `call` property of the
   object.
2. **Schema Matching:**
   - If `call` is "length", it matches `Functions` -> `length`
     and validates the named arguments in `args` against the length rules.
   - If `call` is "trim", it matches `CustomFunctions` -> `trim` and
     validates against your custom rules.
   - If `call` is "unknownFunc", validation FAILS immediately (strict mode).

This strict-by-default approach ensures typos are caught early, while the
modular structure makes it easy to add new capabilities with full type safety.
