# Decision layout grammar and catalog patterns

> [!NOTE]
> These files are experimental and non-normative. The Python agent SDK
> (`a2ui.inference_formats.decision`) is the reference implementation, and the
> schemas may change between grammar versions. Cross-language parity is not a
> goal yet.

This directory holds the data files behind the layout stage of the decision
inference format (specified in
[`docs/proposals/decision_inference_format.md`](../../docs/proposals/decision_inference_format.md)).
The format uses a small decision model to answer short questions about an
intent and a data payload. That model can be a hosted service, a local server,
or a logprob endpoint. The answers select a layout archetype, decide which
blocks it shows, and bind payload pointers to the blocks' slots.

The files here describe the archetypes and how each catalog draws them. Two
kinds of file take part:

| File                          | Scope                                                                                                                                                          | Who authors it                           |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------- |
| `decision/v1/archetypes.json` | Catalog-agnostic. One copy for the whole protocol, validated by `archetype_definition.json`.                                                                   | The A2UI team, with the decision format. |
| `<catalog>/patterns.json`     | One per catalog, beside its `catalog.json`, validated by `decision/v1/pattern_definition.json`. The basic catalog's file is `catalogs/basic/v1/patterns.json`. | The catalog's maintainers.               |

The grammar defines abstract patterns (`page`, `banner`, `picture`, `headline`,
`facts`, `prose`, `collection`, and so on). A pattern file says which real
components of one catalog draw each abstract pattern. A catalog without a
pattern file still works with the decision format. Before any question is
asked, the planner drops every archetype whose required blocks need a pattern
that catalog lacks.

## Layout

```
catalogs/
├── decision/
│   ├── README.md
│   └── v1/
│       ├── archetype_definition.json   # JSON Schema for archetypes.json
│       ├── archetypes.json             # the grammar
│       └── pattern_definition.json     # JSON Schema for any patterns.json
└── basic/
    └── v1/
        ├── catalog.json
        └── patterns.json               # how basic v1 draws the patterns
```

The pattern file is a sidecar: it does not change `catalog.json` or the catalog
definition schema. It is still part of the catalog, so the catalog's
maintainers keep it valid when components change. Its `catalogId` names the one
catalog it applies to, and its `grammarVersion` names the grammar version it
targets. The decision format supports protocol v1.0 only, so the basic file
targets the v1.0 basic catalog.

## `archetypes.json`

The grammar has five parts.

`grammarVersion` is the compatibility version. Any change to blocks, slots,
knobs, or pattern names bumps it, and an SDK rejects a pattern file that
targets another version.

`thresholds` are the probabilities at which a family, an archetype, an expected
block, an optional block, or an instance answer counts as chosen. The section
also holds the template thresholds (`template`, and `templateMutable` for
editable payloads) and the action gate bounds `actionGateFloor` and
`actionGateCap`.

`job` holds the three questions asked for every surface: the `family` choice
(browse, monitor, inspect, act, input, follow) and the `stakes` and `urgency`
scores.

`archetypes` are ordered lists of blocks for one family. A block entry carries a
mark: `name!` is required, `name?` is optional (gated by `optional`), and a
bare `name` is expected (gated by `expected`). An archetype may add a `shape`
pre-filter and an `atLeast` block count. It may also add a `frame` hint for the
page pattern (`dialog`, `stickyActions`).

`blocks` describe each block once. Each block defines the abstract `pattern` it
draws, a `shape` pre-filter, a boolean `gate` question, and an optional
per-pointer `salience` score. It also defines `anatomy` questions, per-element
`instance` questions, computed `measures`, the `slots` the block binds, and a
`fallback` chain of patterns.

A fallback entry is a pattern name or a `pattern:variant` form such as
`collection:cards`. The same `name:variant` syntax is used by `requires`
entries such as `pattern:collection:grid`. When a block resolves to a fallback
pattern (such as `chart` to `headline`), the planner adapts its slot bindings.
It maps them to the slots of the target pattern and pins the target knob when a
`:variant` suffix is present.

`rules` and `lint` are prose. The rules describe behavior the planner applies
(one primary action, the action gate, pointer-once-per-region, and so on). The
lint list states what a loader checks before accepting a grammar.

Question objects come in three kinds. A `choice` lists `options` or takes them
from a slot with `optionsFrom`, and adds an implicit "none" option unless
`allowNone` is false. A `boolean` carries `yes` and `no` criteria texts. A
`score` lists ordered `levels`, and the answer is the expected level index.

Questions also support gating and derivation rules. `appliesWhen` asks the
question only when a slot is bound or has a given type, while `derivedWhen`
answers it from key hints without asking. `requires` offers an option only when
the named slots, knob options, `pattern:<name>:<variant>` capabilities, or the
`actions_allowed` flag are available.

Slots list the semantic types they accept in `from`, most preferred first. They
may also add `prefer` key hints, `avoidKeys`, and `sibling` keys beside the
bound pointer. List slots can declare `repeat` (with `max` and `orderBy`),
`mutable`, and nested `fields` for repeated elements.

## `patterns.json`

Each pattern names its `slots` and its `knobs` (the anatomy answers it varies
by, with their allowed values). It then provides either one `root` plus a
`components` list, or a list of `variants` with a `when` clause over the knobs.
A variant without `when` is the default.

`fieldVariants` holds id-less component templates picked per element by
`$byInstance`. A `fieldVariant` may be a single inline component template or
include inline id-less child objects inside `child` or `children`. The expander
recursively hoists inline children into the flat surface component list with
generated ids.

Component templates are ordinary component objects for the catalog, plus
directives whose keys start with `$`:

| Directive        | Value                              | Meaning                                                                                                                                                                |
| :--------------- | :--------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$slot`          | slot name                          | A data binding to the pointer bound to that slot. Relative inside `$repeat`. `$default` beside it supplies a literal when the slot is unbound.                         |
| `$text`          | literal with `{slot}` placeholders | A formatted string. When a placeholder is bound the expander emits a `formatString` call; `{$index1}` is the 1-based element index.                                    |
| `$default`       | any JSON                           | The value used when the `$slot`, `$knobValue`, or `$event` beside it resolves to nothing.                                                                              |
| `$if`            | slot name                          | Emit the component (or child reference identified by sibling `id`) only when the slot is bound.                                                                        |
| `$ifKnob`        | `{knob: [values]}`                 | Emit the component (or child reference identified by sibling `id`) only when every named knob has one of the listed values.                                            |
| `$ifSelf`        | `{"true": ..., "false": ...}`      | Pick a value (or child id) by whether the element's author equals the `self` knob.                                                                                     |
| `$ifInstance`    | `{answer: value}`                  | Emit the enclosing property (taking the value of the sibling `value` key when wrapped as `{"$ifInstance": {...}, "value": ...}`) only when instance answers match.     |
| `$byType`        | slot name                          | The sibling key equal to the slot's semantic type names the child id to emit.                                                                                          |
| `$byInstance`    | instance answer name               | Pick a `fieldVariants` entry (or a sibling key) by the element's answer.                                                                                               |
| `$repeat`        | repeated slot name                 | Turn `children` into a template child list bound to the slot's array; sibling `component` names the template and optional sibling `order` (`"primaryLast"`) orders it. |
| `$map`           | knob or answer name                | The sibling key equal to its value is the literal to emit.                                                                                                             |
| `$event`         | action slot                        | An action `{"event": {"name": ...}}` named by the agent's action id bound to the slot, else by `$default`. Labels never become event names.                            |
| `$blocks`        | `true`                             | In the page pattern, where the block roots go, in archetype order.                                                                                                     |
| `$knobValue`     | `knob.property`                    | A value looked up in the plan, with `$default` when absent.                                                                                                            |
| `$actionContext` | `true`                             | Inside `context`: the action's own context pointers, else the current item's key inside `$repeat`, else every editable pointer of a form.                              |

Component ids in a pattern are local. The expander prefixes them with the block
id so a pattern can appear more than once on a surface. Headings use Markdown
(`##` for the page title, `###` for block headings) because the basic catalog's
`Text` has no heading variant.

## How an SDK uses these files

An installed package cannot read this repository. Each SDK bundles a copy of
the grammar, the two schemas, and the pattern files for the catalogs it ships.
The Python SDK copies them into
`python/a2ui_agent/src/a2ui/inference_formats/decision/assets/` at build time
(the `force-include` tables in `python/a2ui_agent/pyproject.toml`). Treat the
files in `catalogs/` as the source of truth and the bundled copies as build
artifacts.

At load time an SDK validates `archetypes.json` against
`archetype_definition.json`, runs the lint checks listed in the grammar, and
validates each `patterns.json` against `pattern_definition.json`. A grammar or
pattern file that fails is rejected rather than used in part.

To add a pattern file for another catalog, create `patterns.json` beside that
catalog's `catalog.json`. Set `catalogId` to the catalog's id and
`grammarVersion` to the grammar's version. Implement the patterns the catalog
can draw with its own components, and leave out the rest. Archetypes that need
a missing pattern are not offered for that catalog.
