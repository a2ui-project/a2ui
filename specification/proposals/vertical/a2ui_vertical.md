# A2UI Vertical technical specification

A2UI Vertical is a lightweight, constructor-based inference format designed specifically for standalone, non-nested generative user interfaces. It acts as a concise intermediate representation optimized for smaller on-device language models (such as Gemma 4 E2B) as well as frontier cloud models. A host-side compiler parses this syntax and compiles it into standard A2UI wire protocol payloads (`v0.9`, `v0.9.1`, or `v1.0`).

## Core design goals

The design of A2UI Vertical addresses four primary requirements:

1. **Elimination of container hierarchy and ceremony**: Many generative AI experiences (such as chat cards, widget recommendations, and dashboard tiles) require the model to emit a single component or a flat sequence of components. In existing DSLs like Express, models must plan variable assignments (`root = Column(...)`), declare surfaces (`surface("main")`), and wrap components in containers. Vertical eliminates all variable assignments and container nesting.
2. **On-device model reliability**: Small on-device models frequently omit mandatory variable names or attempt to wrap components in hallucinated layout containers. By modeling components as direct constructor calls (`ComponentName(key=val, ...)`), Vertical achieves 100% syntactical and algorithmic validity on small edge models.
3. **Catalog-driven schema coercion**: Smaller models commonly serialize numbers or booleans in quotes (e.g. `temperature="58"` or `inStock="true"`) or with percentage affixes (`"+10.9%"`). The Vertical compilation engine inspects the catalog JSON schema to automatically coerce quoted strings into expected numeric and boolean primitives, eliminating validation failures without polluting prompt instructions.
4. **Surface-per-component streaming**: Rather than waiting to collect multiple components into an artificial `Column` or `List` container, each constructor call maps directly to an independent surface (`main`, `main_1`, `main_2`, ...). Each component is streamed and rendered on its own surface incrementally as tokens arrive.

---

## Syntax and grammar

A2UI Vertical blocks are enclosed inside `<a2ui>` and `</a2ui>` sentinel tags (or optionally `<a2ui-vertical>` and `</a2ui-vertical>`):

```
<a2ui>
WeatherWidget(city="Seattle", temperature=58, condition="rainy", high=62, low=50)
</a2ui>
```

Multiple components can be emitted sequentially, separated by newlines:

```
<a2ui>
WeatherWidget(city="Seattle", temperature=58, condition="rainy")
StockTicker(symbol="GOOG", price=182.50, change="+1.2%")
</a2ui>
```

### Component constructors

Every statement in Vertical is a direct constructor call consisting of a PascalCase component identifier followed by a comma-separated argument list in parentheses:

```
ComponentName(arg1, param2=value2, param3: value3)
```

Statements do not use `let`, `var`, `const`, or assignment operators (`root = ...`). The component identifier directly corresponds to a component defined in the catalog.

### Argument passing (positional and keyword)

Arguments can be passed positionally or by name:

1. **Positional arguments**: Mapped to properties according to the catalog schema's `positionalIndex` annotations. For example, if `Text` declares property `text` with `positionalIndex: 0`, then `Text("Hello world")` compiles to `{"text": "Hello world"}`.
2. **Keyword arguments**: Passed explicitly as `key=value` or `key: value`. Keyword arguments can appear in any order and may follow positional arguments.
3. **Trailing commas**: Trailing commas before closing parentheses are permitted and safely ignored.
4. **Multi-line arguments**: Arguments may span multiple lines with arbitrary indentation.

### Core primitive types

Vertical supports standard JSON-compatible primitive types:

- **Strings**: Enclosed in double quotes (`"..."`) or single quotes (`'...'`). Common escape sequences (`\"`, `\'`, `\n`, `\t`, `\\`) are supported.
- **Numbers**: Written as integers (`42`), floating-point values (`3.14`), or signed values (`-10`, `+5`).
- **Booleans**: Written as `true` or `false` (case-insensitive).
- **Null**: Written as `null` or `None`.

### Catalog-driven schema coercion

When smaller models emit primitives wrapped in quotation marks, the compiler inspects the catalog property definition (including resolved `$ref` schemas like `DynamicNumber` or `anyOf` alternatives):

- **Numeric coercion**: If the target property expects a `number` or `integer`, values like `"58"` or `"+10.9%"` are safely coerced to integer `58` or float `10.9`.
- **Boolean coercion**: If the target property expects a `boolean`, values like `"true"` or `"false"` are coerced to native boolean `True` or `False`.
- **Preservation of bindings**: Strings matching dynamic data bindings (`$/...`) are **never** coerced and remain untouched.

### Data binding paths

Dynamic data bindings are represented by paths starting with `$`:

```
Text(text=$/user/profile/displayName)
```

The compiler transforms these into protocol data binding objects (e.g. `{"path": "/user/profile/displayName"}`).

### Action triggers and events

Interactive components express events using the `Event(...)` helper or shorthand action strings:

```
Button(label="View Details", onClick=Event("openDetails", item="123"))
```

Compiles to:
```json
{
  "onClick": {
    "event": {
      "name": "openDetails",
      "context": {
        "item": "123"
      }
    }
  }
}
```

---

## Surface-per-component multi-component model

When a Vertical payload contains multiple constructor invocations, the compiler maps each component to its own independent Surface:

1. The first component is assigned to the primary surface (e.g. `main` or the configured surface ID) with `id="root"`.
2. Each subsequent component $i$ is assigned to an incremented surface (`main_1`, `main_2`, ...) with `id="root"`.
3. For each surface, the compiler generates a `createSurface` message followed by an `updateComponents` message containing the component.

This architecture decouples component generation from layout containers, allowing independent rendering and streaming without requiring `Column` or `List` wrapper components.

---

## Streaming execution model

Vertical is designed for real-time streaming:

1. An incremental `VerticalStreamParser` scans incoming token chunks.
2. It detects `<a2ui>` and `</a2ui>` sentinels to isolate UI content from conversational dialogue.
3. As soon as a constructor call's closing parenthesis `)` is encountered, the component is immediately compiled into `createSurface` and `updateComponents` `ResponsePart` events.
4. The client renderer receives and mounts each surface progressively while the model continues generating the next component.

---

## Wire message compilation mapping

### Single component example

**Input Vertical DSL**:
```
<a2ui>
WeatherWidget(city="Seattle", temperature=58, condition="rainy", high=62, low=50)
</a2ui>
```

**Compiled A2UI Wire Payload (v0.9.1)**:
```json
[
  {
    "version": "v0.9.1",
    "createSurface": {
      "surfaceId": "main",
      "catalogId": "https://a2ui.org/catalogs/basic/v1"
    }
  },
  {
    "version": "v0.9.1",
    "updateComponents": {
      "surfaceId": "main",
      "components": [
        {
          "id": "root",
          "component": "WeatherWidget",
          "city": "Seattle",
          "temperature": 58,
          "condition": "rainy",
          "high": 62,
          "low": 50
        }
      ]
    }
  }
]
```

### Multi-component example

**Input Vertical DSL**:
```
<a2ui>
FlightStatusCard(airline="United", flightNumber="UA 421", status="On Time", gate="B12")
WeatherWidget(city="Denver", temperature=72, condition="sunny")
</a2ui>
```

**Compiled A2UI Wire Payload (v0.9.1)**:
```json
[
  {
    "version": "v0.9.1",
    "createSurface": {
      "surfaceId": "main",
      "catalogId": "https://a2ui.org/catalogs/basic/v1"
    }
  },
  {
    "version": "v0.9.1",
    "updateComponents": {
      "surfaceId": "main",
      "components": [
        {
          "id": "root",
          "component": "FlightStatusCard",
          "airline": "United",
          "flightNumber": "UA 421",
          "status": "On Time",
          "gate": "B12"
        }
      ]
    }
  },
  {
    "version": "v0.9.1",
    "createSurface": {
      "surfaceId": "main_1",
      "catalogId": "https://a2ui.org/catalogs/basic/v1"
    }
  },
  {
    "version": "v0.9.1",
    "updateComponents": {
      "surfaceId": "main_1",
      "components": [
        {
          "id": "root",
          "component": "WeatherWidget",
          "city": "Denver",
          "temperature": 72,
          "condition": "sunny"
        }
      ]
    }
  }
]
```
