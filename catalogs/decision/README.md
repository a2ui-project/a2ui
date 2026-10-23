# Decision layout grammar and catalog patterns

This directory holds the data files behind the layout stage of the decision
inference format. The format uses a small decision model (a local
cross-encoder, a logprob endpoint, or a mock) to answer short questions about an
intent and a data payload. The answers select a layout archetype, decide which
blocks it shows, and bind payload pointers to the blocks' slots. The files here
describe the archetypes and how each catalog draws them.

Two kinds of file take part:

| File | Scope | Who authors it |
| :--- | :--- | :--- |
| `decision/v1/archetypes.json` | Catalog-agnostic. One copy for the whole protocol, validated by `archetype_definition.json`. | The A2UI team, with the decision format. |
| `<catalog>/patterns.json` | One per catalog, beside its `catalog.json`, validated by `decision/v1/pattern_definition.json`. The basic catalog's file is `catalogs/basic/v1/patterns.json`. | The catalog's maintainers. |

The grammar names abstract patterns (`page`, `banner`, `picture`, `headline`,
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
definition schema. Its `catalogIds` array lists every catalog id the file
applies to, so one file can serve two catalogs that share a component
vocabulary. The basic file lists both the v1.0 and the v0.9 basic catalog ids.

## `archetypes.json`

The grammar has five parts.

`thresholds` are the probabilities at which a family, an archetype, an expected
block, an optional block, or an instance answer counts as chosen. The section
also holds `reask_below` (answers under it may be asked again with more
context) and the action gate bounds `actionGateFloor` and `actionGateCap`.

`job` holds the three questions asked for every surface: the `family` choice
(browse, monitor, inspect, act, input, follow) and the `stakes` and `urgency`
scores.

`archetypes` are ordered lists of blocks for one family. A block entry carries a
mark: `name!` is required and is always present, `name?` is optional and needs
its gate to pass the `optional` threshold, and a bare `name` is expected and
needs the `expected` threshold. An archetype may add a `shape` pre-filter, an
`atLeast` count of blocks that must be present, and a `frame` hint for the page
pattern (`dialog`, `stickyActions`).

`blocks` describe each block once: the abstract `pattern` it draws, a `shape`
pre-filter, a boolean `gate` question, an optional per-pointer `salience` score,
`anatomy` questions (how the block is drawn), `instance` questions (asked per
element with the payload value filled into the question text), computed
`measures`, the `slots` the block binds, and a `fallback` chain of patterns to
try when the catalog lacks the first. A fallback entry is a pattern name, a
`pattern:knob` form such as `collection:cards`, or one of the terminals
`repeat-in-parent`, `first-item`, `prose`, and `facts`.

`rules` and `lint` are prose. The rules describe behavior the planner applies
(one primary action, the action gate, pointer-once-per-region, and so on). The
lint list states what a loader checks before accepting a grammar.

Question objects come in three kinds. A `choice` lists `options` (id to
description) or takes them from a slot with `optionsFrom`, and gets an implicit
"none" option unless `allowNone` is false. A `boolean` carries `yes` and `no`
criteria texts. A `score` lists ordered `levels`, and the answer is the expected
level index. `appliesWhen` asks the question only when a slot is bound or has a
given type; `derivedWhen` answers it from key hints without asking; `requires`
offers an option only when the named slots, knob options, `pattern:<name>.<variant>`
capabilities, or the `actions_allowed` flag are available.

Slots list the semantic types they accept in `from`, most preferred first, and
may add `prefer` key hints, `avoidKeys`, `sibling` keys to look for beside the
bound pointer, `repeat` with `max` and `orderBy` for lists, `mutable`, and nested
`fields` for repeated elements.

## `patterns.json`

Each pattern names its `slots`, its `knobs` (the anatomy answers it varies by,
with their allowed values), and either one `root` plus `components` list or a
list of `variants`, each with a `when` clause over the knobs and its own `root`
and `components`. A variant without `when` is the default. `fieldVariants` holds
id-less component templates picked per element by `$byInstance`.

Component templates are ordinary component objects for the catalog, plus
directives whose keys start with `$`:

| Directive | Value | Meaning |
| :--- | :--- | :--- |
| `$slot` | slot name | A data binding to the pointer bound to that slot. Relative inside `$repeat`. `$default` beside it supplies a literal when the slot is unbound. |
| `$text` | literal with `{slot}` placeholders | A formatted string. When a placeholder is bound the expander emits a `formatString` call; `{$index1}` is the 1-based element index. |
| `$default` | any JSON | The value used when the `$slot` or `$knobValue` beside it resolves to nothing. |
| `$if` | slot name | Emit the component only when the slot is bound. |
| `$ifKnob` | `{knob: [values]}` | Emit the component only when every named knob has one of the listed values. |
| `$ifSelf` | `{"true": ..., "false": ...}` | Pick a value by whether the element's author equals the `self` knob. |
| `$ifInstance` | `{answer: value}` | Emit the enclosing property only when the element's instance answers match. |
| `$byType` | slot name | The sibling key equal to the slot's semantic type names the child id to emit. |
| `$byInstance` | instance answer name | Pick a `fieldVariants` entry (or a sibling key) by the element's answer. |
| `$repeat` | repeated slot name | Turn `children` into a template child list bound to the slot's array; the sibling `component` names the template. |
| `$map` | knob or answer name | The sibling key equal to its value is the literal to emit. |
| `$event` | event name or slot | An action `{"event": {"name": ...}}`; `context` beside it is passed through. |
| `$blocks` | `true` | In the page pattern, where the block roots go, in archetype order. |
| `$knobValue` | `knob.property` | A value looked up in the plan, with `$default` when absent. |
| `$item` | `true` | Inside `$repeat`, the current element, bound as event context. |
| `$index1` | `true` | Inside `$repeat`, the 1-based index of the current element. |

Component ids in a pattern are local. The expander prefixes them with the block
id so a pattern can appear more than once on a surface. Headings use Markdown
(`##` for the page title, `###` for block headings) because the basic catalog's
`Text` has no heading variant.

## How an SDK uses these files

An installed package cannot read this repository, so each SDK vendors a copy of
the grammar, the two schemas, and the pattern files for the catalogs it bundles.
The Python SDK keeps them under
`python/a2ui_agent/src/a2ui/inference_formats/decision/assets/`, copies them
with `python/a2ui_agent/scripts/sync_decision_assets.py`, and has a test that
fails when a vendored copy differs from the file here. Other SDKs should do the
same: treat the files in `catalogs/` as the source of truth and the vendored
copies as build artifacts.

At load time an SDK validates `archetypes.json` against
`archetype_definition.json`, runs the lint checks listed in the grammar, and
validates each `patterns.json` against `pattern_definition.json`. A grammar or
pattern file that fails is rejected rather than used in part.

To add a pattern file for another catalog, create `patterns.json` beside that
catalog's `catalog.json`, set `catalogIds` to the catalog's id, implement the
patterns the catalog can draw with its own components, and leave out the rest.
Archetypes that need a missing pattern are not offered for that catalog.
