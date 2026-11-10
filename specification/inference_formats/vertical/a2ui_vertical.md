# A2UI Vertical technical specification

A2UI Vertical is a lightweight, constructor-based inference format designed specifically for standalone, non-nested generative user interfaces. It acts as a concise intermediate representation optimized for smaller on-device language models (such as Gemma 4 E2B) as well as frontier cloud models. A host-side compiler parses this syntax and compiles it into standard A2UI wire protocol payloads (v0.9, v0.9.1, or v1.0).

## Core design goals

The design of A2UI Vertical addresses four primary requirements:

1. **Elimination of container hierarchy and ceremony**: Many generative AI experiences (such as chat cards, widget recommendations, and dashboard tiles) require the model to emit a single component or a flat sequence of components. In hierarchical DSLs like Express, models must plan variable assignments (`root = Column(...)`), declare surfaces (`surface("main")`), and wrap components in containers. Vertical eliminates variable assignments and container nesting.
2. **On-device model reliability**: Small on-device models frequently omit mandatory variable names or attempt to wrap components in hallucinated layout containers. By modeling components as direct constructor calls (`ComponentName(key=val, ...)`), Vertical achieves high syntactical and semantic validity on small edge models.
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

### Component constructors & standalone calls

Every statement in Vertical is a direct constructor invocation (or, in A2UI v1.0 and later, a standalone renderer function invocation) consisting of a UAX #31 identifier followed by a comma-separated argument list in parentheses:

```
ComponentName(arg1, param2=value2, param3: value3)
```

Statements do not use `let`, `var`, `const`, or assignment operators (`root = ...`).

### Argument passing (positional and keyword)

Arguments can be passed positionally or by name:

1. **Positional arguments**: Mapped to properties according to the catalog schema's `positionalIndex` annotations (when present) and schema property definition order (omitting structural fields and layout-only `weight`). For example, if `Text` declares `text` first, `Text("Hello world")` compiles to `{"text": "Hello world"}`.
2. **Keyword arguments**: Passed explicitly as `key=value` or `key: value`. Keyword arguments can appear in any order and may follow positional arguments. Unknown properties, duplicate properties, and excess positional arguments fail validation.
3. **Trailing commas & multi-line calls**: Trailing commas before closing parentheses and arbitrary line breaks or `#` / `//` / `/* ... */` comments across arguments are supported.

### Core primitive & composite types

- **Strings**: Double quotes (`"..."`), single quotes (`'...'`), triple quotes (`"""..."""` or `'''...'''`), or raw strings (`r"..."`, `r"""..."""`). Standard escape sequences (`\"`, `\'`, `\n`, `\r`, `\t`, `\\`, `\uXXXX`) are supported in non-raw strings.
- **Numbers**: Finite integers (`42`), floating-point values (`3.14`), scientific notation (`1e-5`), or signed values (`-10`, `+5`).
- **Booleans & Null**: `true` / `false` and `null` / `None` (case-insensitive).
- **Lists & Maps**: `[item1, item2]` and `{key: value}` (plain `path` and `call` keys inside map literals remain literal user data in A2UI v1.0 and later).

### Catalog-driven schema coercion

When models emit primitives wrapped in quotation marks, the compiler inspects the catalog property definition (including resolved `$ref` schemas like `DynamicNumber` or `anyOf` alternatives):

- **Numeric coercion**: If the target property expects `number`, finite string representations like `"58.5"` or `"+10.9%"` are coerced to `58.5` or `10.9`. If the target property expects `integer`, integral string representations like `"58"` are coerced to `58` (non-integral strings like `"3.9"` are left uncoerced so schema validation rejects them cleanly).
- **Boolean coercion**: If the target property expects `boolean`, values like `"true"` or `"false"` are coerced to `true` or `false`.
- **Preservation of bindings**: Dynamic data bindings (`$/...`) and function calls are **never** coerced into primitives.

### Data binding paths (`@path` in v1.0 and later, `path` in v0.9 and v0.9.1)

Dynamic data bindings are represented by paths starting with `$`:

```
Text(text=$/user/profile/displayName)
```

- In **A2UI v1.0 and later**, this compiles to `{"@path": "/user/profile/displayName"}`.
- In **A2UI v0.9 and v0.9.1**, this compiles to `{"path": "/user/profile/displayName"}`.

Properties whose catalog schema does not allow dynamic bindings reject `$path` expressions during compilation.

### Action triggers, events, and function calls

Interactive components express actions via `Event(...)`, function calls, or shorthand strings:

```
Select(
  label="Plan",
  event="change",
  options=["Starter", "Pro"],
  action=Event("selectPlan", tier="Pro", userMessage="Selected Pro plan")
)
```

- **Events**: `Event("name", key=val, userMessage=...)` compiles to `{"event": {"name": "name", "userMessage": ..., "context": {...}}}` (`userMessage` requires A2UI v1.0 or later; `context` is omitted when empty).
- **Function actions**: Passing a catalog function call such as `openUrl("https://example.com")` to an `Action` property compiles to `{"functionCall": {"@call": "openUrl", "args": {"url": "https://example.com"}}}` in A2UI v1.0 and later (using `"call"` in v0.9 and v0.9.1).
- **Validation checks**: Checkable standalone inputs accept `?required` or `?regex("^[0-9]+$", "Digits only")` rules, compiling to `CheckRule` entries under `checks`.
- **Standalone renderer function calls (v1.0 and later)**: Top-level calls to declared agent-callable catalog functions (e.g. `showToast("Saved!")`) compile to `callRendererFunction` messages in A2UI v1.0 and later.

### Multi-catalog resolution & extensions (v1.0 and later)

- **Multiple catalogs**: When multiple v1.0 catalogs are active, `createSurface` omits `catalogId` (creating a defaultless surface), and each compiled component and function call carries its owning `catalogId`. If multiple active catalogs define the same name, callers disambiguate with `catalogId="..."`.
- **Component extensions**: Passing `extensions={vendor_key: "val"}` on a component in A2UI v1.0 and later compiles to `"metadata": {"extensions": {"vendor_key": "val"}}` after validating UAX #31 extension keys.

### Non-normative permissive recovery

[`Vertical.g4`](Vertical.g4) defines the canonical Vertical grammar that prompt generators teach and decompilers emit. Host compilers MAY implement non-normative recovery heuristics for small edge-model outputs outside the canonical grammar, such as stripping outer Markdown code fences or inline backticks around `<a2ui>` blocks, stripping accidental variable assignment prefixes (`root = Text(...)`), closing unclosed parentheses or quotes before a subsequent line's constructor call, accepting `:key value` keyword forms or unquoted string tokens, and recovering single-component raw JSON or JSX tags (`<Text text="Hi" />`). Prompts and decompilers MUST NOT emit these non-normative forms, and catalog/schema validation rules still apply strictly after syntax recovery.

---

## Surface-per-component multi-component model

When a Vertical payload contains multiple constructor invocations, the compiler maps each component to its own independent Surface:

1. The first component is assigned to the primary surface (e.g. `main` or the configured surface ID) with `id="root"`.
2. Each subsequent component is assigned to the next unused incremented surface (`main_1`, `main_2`, ...) with `id="root"`. Across multiple `<a2ui>` blocks in a single response and across persistent multi-turn `RendererState` sessions, surface and `functionCallId` counters advance monotonically so existing surfaces are never collided with.
3. In **A2UI v1.0 and later**, each surface emits a single `createSurface` message with inline `components`. In **A2UI v0.9 and v0.9.1**, each surface emits `createSurface` followed by `updateComponents`.

---

## Streaming execution model

Vertical is designed for real-time streaming via `VerticalResponseStream` (`parser.open_stream()`):

1. Scans incoming token chunks, holding partial tag prefixes and multi-quote boundaries safely across chunk boundaries.
2. Isolates `<a2ui>` / `<a2ui-vertical>` blocks from conversational text (`TextPart`).
3. As soon as each constructor statement closes, compiles, validates against `RendererState`, and yields an `A2uiPart` for that component's surface.

---

## Wire message compilation mapping

### Single component example

**Input Vertical DSL**:

```
<a2ui>
WeatherWidget(city="Seattle", temperature=58, condition="rainy", high=62, low=50)
</a2ui>
```

**Compiled A2UI v1.0 Wire Payload**:

```json
[
  {
    "version": "1.0",
    "createSurface": {
      "surfaceId": "main",
      "catalogId": "https://example.com/catalogs/widgets/v1",
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

**Compiled A2UI v0.9.1 Wire Payload**:

```json
[
  {
    "version": "v0.9.1",
    "createSurface": {
      "surfaceId": "main",
      "catalogId": "https://example.com/catalogs/widgets/v1"
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
