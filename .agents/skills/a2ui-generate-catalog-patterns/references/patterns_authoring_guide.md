# Authoring Guide: `patterns.json`, `templates.json`, and `sample_payloads.json`

This guide defines the JSON schemas, expansion directives, and design recipes for the three files emitted into a catalog directory (`<target_dir>`) by the `a2ui-generate-catalog-patterns` skill.

---

## 1. Authoring `patterns.json` (Stage 2A Archetype Composition)

`patterns.json` maps the catalog-agnostic layout grammar (`archetypes.json`) onto a catalog's concrete container and leaf components. It is validated against `specification/v1_0/json/decision/pattern_definition.json` and loaded at runtime by `PatternLibrary.from_file(catalog_dir)`.

### 1.1 Top-Level File Structure

```json
{
  "$schema": "https://a2ui.org/specification/v1_0/decision/pattern_definition.json",
  "catalogIds": [
    "https://example.com/catalogs/my_catalog/v1/catalog.json"
  ],
  "version": "1",
  "patterns": {
    "page": {
      "slots": ["title", "subtitle", "mark", "blocks"],
      "knobs": {
        "dialog": ["yes", "no"],
        "stickyActions": ["yes", "no"]
      },
      "root": "page_col",
      "components": [
        {
          "id": "page_col",
          "component": "Column",
          "children": [
            "page_title",
            {"$if": "subtitle", "id": "page_subtitle"},
            {"$blocks": true}
          ]
        },
        {
          "id": "page_title",
          "component": "Text",
          "text": {"$slot": "title"}
        },
        {
          "id": "page_subtitle",
          "component": "Text",
          "text": {"$slot": "subtitle"}
        }
      ]
    }
  }
}
```

Each entry under `"patterns"` defines:
- `"slots"`: Array of slot names bound by `LayoutPlanner` for this pattern.
- `"knobs"` (optional): Map of anatomy question names to their allowed string values.
- `"fieldVariants"` (optional): Named component templates selected per element via `{"$byInstance": "<question>"}` (used in `form` and `groups`).
- Either a single variant (`"root"` + `"components"` directly on the pattern object) or `"variants"`: an ordered array of `{ "when": { "<knob>": ["<val>"] }, "root": "<id>", "components": [...] }` objects, ending with an unconditional fallback variant (no `"when"`).

### 1.2 Pattern Expansion Directives

`PatternExpander` evaluates the following directives inside `"components"` templates:

| Directive | Location | Behavior |
| :--- | :--- | :--- |
| `{"$slot": "<name>", "$default": <val>}` | Component property | Binds to the slot's JSON Pointer (`{"@path": "/..."}` on v1.0, `{"path": "/..."}` on v0.9) or literal value. If unbound, emits `"$default"` when present or omits the property. |
| `{"$text": "### {title}"}` | String/DynamicString property | Interpolates one or more `{slot}` placeholders. Emits a direct binding for a single `{slot}`, a `formatString` function call when mixing static text with pointers, or a literal string. |
| `{"$if": "<slot>", "id": "<comp_id>"}` | Container `children` list | Includes `<comp_id>` only when `<slot>` is bound. May be combined with `"$ifKnob"`. |
| `{"$ifKnob": {"<knob>": ["<val>"]}, "id": "<comp_id>"}` | Container `children` list | Includes `<comp_id>` only when `<knob>` matches one of the listed values. |
| `{"$ifSelf": {"true": "<id_a>", "false": "<id_b>"}}` | Container `children` list or property | Branches on whether the current `conversation` message author represents `"self"` (`you`, `me`, `user`, `self`). |
| `{"$ifInstance": {"<key>": "<val>"}, "value": <expr>}` | Component property | Evaluates and emits `"value"` only when the per-element instance answer or knob `<key>` equals `<val>`; omits the property otherwise. |
| `{"$byInstance": "<key>", "<opt1>": <v1>, "<opt2>": <v2>}` | Component property or `$repeat.component` | In a property, selects `<v1>` or `<v2>` based on instance answer `<key>`. In `$repeat.component`, selects the matching template from `"fieldVariants"`. |
| `{"$byType": "<slot>", "video_url": "<id1>", "audio_url": "<id2>"}` | Container `children` list | Selects the child component ID matching the semantic type of `<slot>`. |
| `{"$repeat": "<slot>", "component": "<comp_id>", "order": "primaryLast"}` | Container `children` property | Expands `<comp_id>` across a repeated slot. Emits a `TemplateChildList` (`{"path": ..., "componentId": ...}`) for array pointers with relative fields, or unrolls indexed component copies when items are unrolled. |
| `{"$map": "<key>", "<opt1>": <v1>, "$default": <v0>}` | Component property | Maps knob or instance answer `<key>` to a catalog-specific enum or literal value. |
| `{"$event": "<slot_or_name>", "context": {"$item": true}}` | Action property | Emits `{"event": {"name": "...", "context": ...}}` for button or interactive component actions. |
| `{"$blocks": true}` | `page` container `children` list | Splices the root component IDs of all expanded content blocks into the `page` container. |

### 1.3 The 19 Grammar Block Contracts

| Block ID | Primary Pattern | Fallback Chain | Slots (`*` = required, `[]` = repeat) | Anatomy Knobs | Instance Questions |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `banner` | `banner` | `banner -> prose` | `title*`, `text` | - | `tone` |
| `picture` | `picture` | `picture` | `picture*`, `caption`, `width`, `height`, `aspectRatio`, `orientation` | `framing`, `prominence` | - |
| `filters` | `filters` | `filters` | `query`, `categories` | - | - |
| `headline` | `headline` | `headline -> facts` | `items*[]` (`label*`, `value*`, `delta`, `min`, `max`) | `deltas`, `gauge` | `state_tone` |
| `media` | `media` | `media -> facts` | `source*`, `poster`, `title`, `duration` | - | - |
| `chart` | `chart` | `chart -> headline -> collection` | `series*`, `title` | `form` | - |
| `facts` | `facts` | `facts -> prose` | `rows*[]` (`label*`, `value*`) | `density` | - |
| `prose` | `prose` | `prose` | `heading`, `body*` | - | - |
| `collection` | `collection` | `collection` | `items*[]` (`headline*`, `supporting`, `picture`, `meta`, `badge`, `rating`) | `layout`, `leading`, `trailing` | - |
| `comparison` | `comparison` | `comparison -> collection:cards -> collection:rows` | `options*[]` (`headline*`, `picture`, `attributes*`, `highlight`) | - | - |
| `steps` | `steps` | `steps -> collection:rows` | `items*[]` (`title*`, `detail`, `done`) | - | - |
| `form` | `form` | `form -> facts` | `fields*[]` (`label*`, `value*`, `options`, `min`, `max`) | - | `control`, `input_format`, `required` |
| `groups` | `groups` | `groups -> form` | `groups*[]` (`heading*`, `rows*`) | - | `control` |
| `actions` | `actions` | `actions` | `buttons*[]` (`label*`) | - | `primary`, `destructive` |
| `timeline` | `timeline` | `timeline -> steps -> collection:rows` | `events*[]` (`time*`, `title*`, `detail`, `state`) | `state` | - |
| `map` | `map` | `map -> facts` | `location*`, `label`, `pins[]` | - | - |
| `conversation` | `conversation` | `conversation -> collection:rows` | `messages*[]` (`author*`, `text*`, `time`, `avatar`, `attachment`) | - | - |
| `compose` | `compose` | `compose` | `draft*`, `sendLabel` | - | - |
| `outcome` | `outcome` | `outcome -> banner -> prose` | `headline*`, `detail` | - | `tone` |

### 1.4 Pattern Design Recipes

1. **Single-Component Molecule**: When the custom catalog has a dedicated molecule component (for example, `Stat(label, value)` for each item in `headline`), bind the slots directly on that component inside a `$repeat` container rather than decomposing into multiple `Text` primitives.
2. **Multi-Component Composed Molecule**: When the catalog only provides atomic primitives (`Stack`, `Box`, `Label`, `Button`), compose a container tree whose root is a `Stack` or `Box` and whose children reference sibling template IDs in the same `"components"` array.
3. **Capability Substitution vs. Fallback**: If the catalog lacks a chart, map, or timeline widget, you can omit `chart`, `map`, and `timeline` from `patterns.json` so `resolve_fallback_pattern` automatically degrades them to `headline`, `facts`, and `steps` (or `collection:rows`). Note that `ArchetypeCoverage.degraded_required` flags archetypes whose required block (`timeline!`, `map!`) resolved via fallback rather than a direct pattern.

---

## 2. Authoring `templates.json` (Stage 1 Fixed-Surface Synthesis)

When a catalog is `fixed_surface` (no multi-child container component) or `hybrid` (composable primitives plus monolithic domain forms or cards), Stage 1 of `DecisionSynthesizer` matches and renders registered `SurfaceTemplate` entries before Stage 2A archetype planning runs.

### 2.1 Top-Level File Structure

`TemplateRegistry.from_file(catalog_dir)` loads `<target_dir>/templates.json`:

```json
{
  "version": "1.0",
  "catalogId": "https://example.com/catalogs/fixed_forms/v1/catalog.json",
  "protocolVersion": "1.0",
  "templates": {
    "order_entry_ticket": {
      "description": "Order entry ticket for equity and ETF trades.",
      "surfaceId": "order_entry_ticket_surface",
      "requiredPointers": [
        "/symbol",
        "/quantity",
        "/limitPrice"
      ],
      "isMutable": true,
      "components": [
        {
          "id": "root",
          "component": "OrderEntryTicket",
          "symbol": {"@path": "/symbol"},
          "quantity": {"@path": "/quantity"},
          "limitPrice": {"@path": "/limitPrice"},
          "submitOrder": {
            "event": {
              "name": "submit_order"
            }
          }
        }
      ]
    }
  }
}
```

### 2.2 `SurfaceTemplate` Rules

- `"requiredPointers"`: Non-empty list of RFC 6901 JSON Pointers (`"/..."`) that must exist in the payload for `template.matches_payload(pointers)` to select this template. Choose pointers that uniquely distinguish each fixed surface in the catalog.
- `"isMutable"`: Set to `true` when the surface accepts user input or dispatches an action that mutates state (`DecisionSynthesizer` suppresses mutable templates when the user's intent is read-only inspection).
- `"components"`: Must contain a component with `"id": "root"`.
  - For protocol version `"1.0"` (or `"v1.0"`), use `{"@path": "/pointer"}` for data bindings.
  - For protocol version `"0.9"` (or `"v0.9"`), use `{"path": "/pointer"}` for data bindings.
  - Every required property on the catalog component schema must be present on the component dict.

---

## 3. Authoring `sample_payloads.json` (Required Payload Verification)

`catalog_patterns_tool.py validate` requires `--payload <sample_payloads.json>`. The file may be either a single JSON payload object or a `"samples"` map of named payloads:

```json
{
  "samples": {
    "browse_catalog": {
      "title": "Featured Products",
      "items": [
        {"headline": "Trail Runner", "supporting": "Lightweight shoe", "meta": "$120"},
        {"headline": "Summit Pack", "supporting": "35L daypack", "meta": "$165"},
        {"headline": "Thermal Flask", "supporting": "Insulated bottle", "meta": "$38"}
      ]
    },
    "monitor_metrics": {
      "title": "Cluster Health",
      "uptime": "99.98%",
      "latencyMs": 42,
      "errorRate": 0.02,
      "activeNodes": 16
    },
    "order_ticket": {
      "symbol": "GOOG",
      "quantity": 25,
      "limitPrice": 182.5
    }
  }
}
```

### 3.1 Designing Effective Sample Payloads

- **For `patterns.json`**:
  - Include an array of at least 3 homogeneous objects with string fields (`headline`/`title`, `supporting`/`detail`, `meta`/`price`) to exercise `feed`, `compare`, and `guide`.
  - Include 3+ scalar numeric/status fields to exercise `dashboard` and `detail`.
  - Include mutable scalar fields if you want to verify `form` and `settings` eligibility.
- **For `templates.json`**:
  - Include at least one named sample for **every** template in `templates.json` containing all of that template's `requiredPointers` with values matching the component's property types (`string`, `number`, `boolean`, `array`). Any template that matches zero samples in `sample_payloads.json` fails validation with `stage="payload"`.
