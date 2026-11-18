# Authoring Guide: `patterns.json`, `templates.json`, and `sample_payloads.json`

This guide defines the JSON schemas, expansion directives, and design rules for the three sidecar files emitted into a catalog directory (`<target_dir>`) by the `a2ui-generate-catalog-patterns` skill.

Catalog authors own `patterns.json`. A catalog's `patterns.json` is part of that catalog and must validate whenever `catalog.json` or `patterns.json` changes. The decision format supports A2UI protocol v1.0 only; keep one `patterns.json` file per catalog and protocol version.

---

## Authoring `patterns.json`

`patterns.json` maps the catalog-agnostic layout grammar (`catalogs/decision/v1/archetypes.json`) onto a catalog's concrete container and leaf components. It is validated against `catalogs/decision/v1/pattern_definition.json` and loaded at runtime by `PatternLibrary.from_file(catalog_dir)`.

### Top-Level File Structure

Every `patterns.json` file declares a single `"catalogId"` matching its `catalog.json` and a `"grammarVersion"` matching `archetypes.json`:

```json
{
  "$schema": "https://a2ui.org/specification/v1_0/decision/pattern_definition.json",
  "catalogId": "https://example.com/catalogs/my_catalog/v1/catalog.json",
  "grammarVersion": "1",
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
          "children": ["page_title", {"$if": "subtitle", "id": "page_subtitle"}, {"$blocks": true}]
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
- Either a single variant (`"root"` plus `"components"` directly on the pattern object) or `"variants"`: an ordered array of `{"when": {"<knob>": ["<val>"]}, "root": "<id>", "components": [...]}` objects, ending with an unconditional default variant (no `"when"`).

### Component Schema and Required Properties

Every expanded component template in `"components"` or `"fieldVariants"` must validate directly against the catalog's JSON Schema:

- `"component"` must name a component defined in `catalog.json`.
- Every property listed in the component's `"required"` array in `catalog.json` (for example, `value` and `label` on Basic v1 `TextField`, `text` on `Text`, or `url` on `Image`) must be present after directive expansion.
- When a required component property binds to an optional grammar slot, either guard the component in its parent container's `children` list with `{"$if": "<slot>", "id": "<comp_id>"}` or provide a `"$default"` fallback on `{"$slot": "<slot>", "$default": ...}` so the property is never omitted.

### No Post-Expansion Coercion

`PatternExpander` does not coerce component names, property names, enum values, or icon names after expansion. Format code holds no catalog-specific rules or coercers:

- Enum properties (such as `variant`, `fit`, `align`, `justify`, or `Icon.name`) must emit values that exist directly in the catalog's schema.
- Use `{"$map": "<knob_or_slot>", "<option>": "<catalog_enum_value>"}` to translate grammar knob or tone values into the catalog's own enum values.

### Pattern Expansion Directives

`PatternExpander` evaluates the following directives inside `"components"` and `"fieldVariants"` templates:

| Directive                                                                         | Location                                  | Behavior                                                                                                                                                                                                            |
| :-------------------------------------------------------------------------------- | :---------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `{"$slot": "<name>", "$default": <val>}`                                          | Component property                        | Binds to the slot's JSON Pointer (`{"@path": "/..."}`) or literal value. If unbound, emits `"$default"` when present or omits the property.                                                                         |
| `{"$text": "### {title}"}`                                                        | String/DynamicString property             | Interpolates one or more `{slot}` placeholders (or `{$index1}` for the 1-based item index). Emits a `formatString` function call when any bound placeholder is a pointer, or a literal string otherwise.            |
| `{"$if": "<slot>", "id": "<comp_id>"}`                                            | Container `children` list                 | Includes `<comp_id>` only when `<slot>` is bound. May be combined with `"$ifKnob"`.                                                                                                                                 |
| `{"$ifKnob": {"<knob>": ["<val>"]}, "id": "<comp_id>"}`                           | Container `children` list                 | Includes `<comp_id>` only when `<knob>` matches one of the listed values.                                                                                                                                           |
| `{"$ifSelf": {"true": "<id_a>", "false": "<id_b>"}}`                              | Container `children` list or property     | Branches on whether the current `conversation` message author matches the block's `self` anatomy knob.                                                                                                              |
| `{"$ifInstance": {"<key>": "<val>"}, "value": <expr>}`                            | Component property                        | Evaluates and emits `"value"` only when the per-element instance answer or knob `<key>` equals `<val>`; omits the property otherwise.                                                                               |
| `{"$byInstance": "<key>", "<opt1>": <v1>, "<opt2>": <v2>}`                        | Component property or `$repeat.component` | In a property, selects `<v1>` or `<v2>` based on instance answer `<key>`. In `$repeat.component`, selects the matching template from `"fieldVariants"`.                                                             |
| `{"$byType": "<slot>", "video_url": "<id1>", "audio_url": "<id2>"}`               | Container `children` list                 | Selects the child component ID matching the semantic type of `<slot>`.                                                                                                                                              |
| `{"$repeat": "<slot>", "component": "<comp_id>", "order": "primaryLast"}`         | Container `children` property             | Expands `<comp_id>` across a repeated slot. Emits a `TemplateChildList` (`{"path": ..., "componentId": ...}`) for array pointers with relative fields, or unrolls indexed component copies when items are unrolled. |
| `{"$map": "<key>", "<opt1>": <v1>, "$default": <v0>}`                             | Component property                        | Maps knob or instance answer `<key>` to a catalog-specific enum or literal value.                                                                                                                                   |
| `{"$knobValue": "<knob.prop>", "$default": <v0>}`                                 | Component property                        | Looks up `<knob.prop>` in the plan's knobs or instance answers, falling back to `"$default"`.                                                                                                                       |
| `{"$event": "action", "$default": "<name>", "context": {"$actionContext": true}}` | Action property                           | Emits `{"event": {"name": "<action_id>", "context": ...}}` from the bound `ActionSpec`.                                                                                                                             |
| `{"$actionContext": true}`                                                        | Inside `$event.context`                   | Resolves action context bindings from explicit `ActionSpec.context`, item key inside `$repeat`, or mutable form pointers.                                                                                           |
| `{"$blocks": true}`                                                               | `page` container `children` list          | Splices the root component IDs of all expanded content blocks into the `page` container.                                                                                                                            |

### Action Events and Action Context

Interactive components bind actions through `"$event"` and `"$actionContext"`:

1. **Action ID vs. Display Label**:
   - `"$event"` names the action slot (`"action"` or `{"$action": "action"}`), which resolves to the agent's `ActionSpec.id` as the wire event name (`{"event": {"name": "<action_id>"}}`).
   - When the action slot is unbound, `"$default"` beside `"$event"` supplies the fallback event name (or the slot name itself if `"$default"` is omitted).
   - Never pass a display label slot (`"label"`, `"sendLabel"`, `"title"`, `"headline"`) to `"$event"`. Display labels are presentational (`"text": {"$slot": "label"}`); action IDs are the event contract.
2. **Action Context (`"$actionContext": true`)**:
   - Inside an `"$event"` directive's `"context"` object, `{"$actionContext": true}` resolves context bindings in priority order:
     1. **Explicit action context**: If the bound `ActionSpec` carries `context` pointers (`{"transferId": "/transfer/id"}`), binds each key to its JSON Pointer (`{"transferId": {"@path": "/transfer/id"}}`).
     2. **Repeated item action**: Inside a `$repeat` item template (such as `collection` or `groups`), binds the item's key field (`ActionSpec.key`, defaulting to `"id"` when present on the item) as a relative path (`{"id": {"@path": "id"}}`).
     3. **Surface form submit**: Outside `$repeat`, binds every editable pointer of the block (`$mutable` or `form.fields`).
     4. **`sendDataModel` fallback**: When a surface has mutable state and a non-item action resolves to an empty context, `PatternExpander` sets `Expansion.send_data_model = True` so `createSurface` enables `sendDataModel`.
   - `"context"` may also map explicit keys to `{"$slot": "<slot>"}` directives (for example, `"context": {"draft": {"$slot": "draft"}}` in `compose`).

```json
{
  "id": "action_button",
  "component": "Button",
  "child": "action_label",
  "action": {
    "$event": "action",
    "$default": "submit",
    "context": {
      "$actionContext": true
    }
  }
}
```

### Container Topology and Lint Rules

Every expanded pattern surface must satisfy `lint_components`:

- Every pattern variant's `"root"` ID must exist in that variant's `"components"` array.
- Every container component must resolve at least one child component in its child slot (`child`, `children`, or catalog-defined child slot). Empty non-root containers are pruned during expansion; an empty root container fails lint with `empty_container`.
- Every child component ID referenced by a container must exist in the expanded component list (`missing_component`).
- At most one button on a surface may carry `"variant": "primary"` (`multiple_primary_buttons`).

### Layout Grammar Block Contracts

| Block ID       | Primary Pattern | Fallback Chain                                      | Slots (`*` = required, `[]` = repeat)                                                | Anatomy Knobs                   | Instance Questions       |
| :------------- | :-------------- | :-------------------------------------------------- | :----------------------------------------------------------------------------------- | :------------------------------ | :----------------------- |
| `banner`       | `banner`        | `banner -> prose`                                   | `title*`, `text`                                                                     | -                               | `tone`                   |
| `picture`      | `picture`       | `picture`                                           | `picture*`, `caption`, `width`, `height`, `aspectRatio`, `orientation`               | `framing`, `prominence`         | -                        |
| `filters`      | `filters`       | `filters`                                           | `query`, `categories`                                                                | -                               | -                        |
| `headline`     | `headline`      | `headline -> facts`                                 | `items[]` (`label`, `value*`, `delta`, `min`, `max`)                                 | `deltas`, `gauge`               | `news`, `state_tone`     |
| `media`        | `media`         | `media -> facts`                                    | `source*`, `poster`, `title`, `duration`                                             | -                               | -                        |
| `chart`        | `chart`         | `chart -> headline -> collection`                   | `series*`, `title`                                                                   | -                               | -                        |
| `facts`        | `facts`         | `facts -> prose`                                    | `rows[]` (`label*`, `value*`)                                                        | -                               | -                        |
| `prose`        | `prose`         | `prose`                                             | `heading`, `body*`, `length` (measure)                                               | -                               | -                        |
| `collection`   | `collection`    | `collection`                                        | `items*[]` (`headline*`, `supporting`, `picture`, `icon`, `meta`, `badge`, `rating`) | `layout`, `leading`, `trailing` | `badge_tone`             |
| `comparison`   | `comparison`    | `comparison -> collection:cards -> collection:rows` | `options*[]` (`headline*`, `picture`, `attributes`, `highlight`)                     | -                               | `headline_attribute`     |
| `steps`        | `steps`         | `steps -> collection:rows`                          | `items*[]` (`title*`, `detail`, `done`)                                              | -                               | -                        |
| `form`         | `form`          | `form -> facts`                                     | `fields*[]` (`label*`, `value*`, `options`, `min`, `max`)                            | -                               | `control`, `required`    |
| `groups`       | `groups`        | `groups -> form`                                    | `groups*[]` (`heading*`, `rows` (`label*`, `value*`))                                | -                               | `row_kind`               |
| `actions`      | `actions`       | `actions`                                           | `buttons[]` (`label*`, `action*`)                                                    | -                               | `primary`, `destructive` |
| `timeline`     | `timeline`      | `timeline -> steps -> collection:rows`              | `events*[]` (`time*`, `title*`, `detail`, `state`)                                   | `order`                         | `state_tone`             |
| `map`          | `map`           | `map -> facts`                                      | `location*`, `label`, `pins`                                                         | -                               | -                        |
| `conversation` | `conversation`  | `conversation -> collection:rows`                   | `messages*[]` (`author*`, `text*`, `time`, `avatar`, `attachment`)                   | `self`                          | -                        |
| `compose`      | `compose`       | `compose`                                           | `draft`, `sendLabel`                                                                 | -                               | -                        |
| `outcome`      | `outcome`       | `outcome -> banner -> prose`                        | `headline*`, `detail`                                                                | -                               | `tone`                   |

### Pattern Design Recipes

1. **Single-Component Molecule**: When the catalog has a dedicated molecule component (for example, `Stat(label, value)` for each item in `headline`), bind the slots directly on that component inside a `$repeat` container rather than decomposing into multiple `Text` primitives.
2. **Multi-Component Composed Molecule**: When the catalog only provides atomic primitives (`Stack`, `Panel`, `Label`, `Trigger`), compose a container tree whose root is a `Stack` or `Panel` and whose children reference sibling template IDs in the same `"components"` array.
3. **Capability Substitution vs. Fallback**: If the catalog lacks a chart, map, or timeline widget, omit `chart`, `map`, and `timeline` from `patterns.json` so `resolve_fallback_pattern` degrades them to `headline`, `facts`, and `steps` (or `collection:rows`). `ArchetypeCoverage.degraded_required` flags archetypes whose required block (`timeline!`, `map!`) resolved via fallback rather than a direct pattern.

---

## Surface Templates

When a catalog is `fixed_surface` (no multi-child container component) or `hybrid` (composable primitives plus monolithic domain forms or cards), `TemplateRegistry.from_file(catalog_dir)` loads `<target_dir>/templates.json` and offers matching `SurfaceTemplate` entries as a choice question in the planner batch:

```json
{
  "version": "1.0",
  "catalogId": "https://example.com/catalogs/fixed_forms/v1/catalog.json",
  "protocolVersion": "1.0",
  "templates": {
    "order_entry_ticket": {
      "description": "Order entry ticket for equity and ETF trades.",
      "surfaceId": "order_entry_ticket_surface",
      "requiredPointers": ["/symbol", "/quantity", "/limitPrice"],
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
              "name": "submit_order",
              "context": {
                "symbol": {"@path": "/symbol"},
                "quantity": {"@path": "/quantity"},
                "limitPrice": {"@path": "/limitPrice"}
              }
            }
          }
        }
      ]
    }
  }
}
```

### `SurfaceTemplate` Rules

- `"requiredPointers"`: Non-empty list of RFC 6901 JSON Pointers (`"/..."`) that must exist in the payload for `template.matches_payload(pointers)` to offer this template.
- `"isMutable"`: Set to `true` when the surface accepts user input or dispatches an action that mutates state (mutable templates require the higher `thresholds.templateMutable` threshold unless editable pointers are present).
- `"components"`: Must contain a component with `"id": "root"`, using v1.0 `{"@path": "/pointer"}` data bindings and satisfying every required property on the catalog component schema.

---

## Sample Payloads

`catalog_patterns_tool.py validate` requires `--payload <sample_payloads.json>`. The file may be either a single JSON payload object or a `"samples"` map of named payloads:

```json
{
  "samples": {
    "browse_catalog": {
      "title": "Featured Products",
      "items": [
        {"id": "p1", "headline": "Trail Runner", "supporting": "Lightweight shoe", "meta": "$120"},
        {"id": "p2", "headline": "Summit Pack", "supporting": "35L daypack", "meta": "$165"},
        {"id": "p3", "headline": "Thermal Flask", "supporting": "Insulated bottle", "meta": "$38"}
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

- **For `patterns.json`**: Include an array of at least 3 homogeneous objects with string fields (`headline`/`title`, `supporting`/`detail`, `meta`/`price`) to exercise `feed`, `compare`, and `guide`, plus 3 or more scalar numeric or status fields to exercise `dashboard` and `detail`.
- **For `templates.json`**: Include at least one named sample for every template in `templates.json` containing all of that template's `requiredPointers` with values matching the component's property types. Any template that matches zero samples in `sample_payloads.json` fails validation with `stage="payload"`.
