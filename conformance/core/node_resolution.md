# Node resolution conformance

`node_resolution.yaml` checks the framework-independent node contract: tree
structure, scoped bindings, identity, notifications, actions, and destruction.
Dart and TypeScript run the same cases against their native node resolvers.

## Fixtures and operations

Each case names a YAML `fixture` under `test_data/node/`. A fixture contains a
`catalog` JSON path, initial `data`, and flat `components` with `id`, `component`,
and properties. Both paths are relative to `conformance/`, including catalog
paths such as `../specification/v0_9_1/catalogs/basic/catalog.json`.

Runners load that catalog, seed a surface model, and create its resolver. These
are model-level tests; wire-message validation stays in the message-processor
suite. The initial fixtures use the published basic catalog. Declared functions are
implemented as recorders returning null. These cases check invocation, not
function results or side effects; no URL is opened.

A case asserts the initial state, then applies these operations in order:

| `op`                | Inputs                      | Meaning                                                                                                         |
| ------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `set_data`          | `path`, `value`             | Write to the surface data model.                                                                                |
| `update_components` | `components`                | Add definitions or replace existing definitions' properties, in order. Existing component types stay unchanged. |
| `remove_component`  | `component_id`              | Remove a definition.                                                                                            |
| `write`             | `node`, `property`, `value` | Write through a writable binding.                                                                               |
| `invoke`            | `node`, `property`          | Invoke an action and await completion.                                                                          |
| `dispose`           |                             | Dispose the resolver.                                                                                           |

An operation finishes after its reactive work has settled. Subscription-time
callbacks are setup, not updates.

## Assertions

Node addresses describe positions: `root`, `root/child`, or
`root/children/0`. They are test selectors, not generated instance IDs or stable
data-item keys.

Every `expect` contains `nodes`, listing **all** mounted positions. Each node
assertion checks only the named fields: `component_id`, `type`, `state`,
`data_path`, and `props`. An empty object checks presence alone. Inside `props`,
only named properties are checked, but each property's value is compared in
full, using these representations:

- Binding: `{value: Ada, writable: true}`. Literal bindings have `writable: false`.
- Child reference: `{node: root/children/0}`.
- Action: `{action: true}`.
- Other values: ordinary JSON, including lists and nested objects.

The other expectations describe observable behavior:

| Field            | Assertion                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `emissions`      | Exact props-callback counts for nodes retained by reference across the operation. Required on every step; `{}` means all retained nodes stayed silent. |
| `same_nodes`     | Positions whose actual node objects are unchanged from before the step.                                                                                |
| `replaced_nodes` | Positions present before and after the step whose actual node objects differ.                                                                          |
| `destroyed`      | Exact destruction-callback counts, addressed by each instance's last observed position. Destroyed instances must be disposed.                          |
| `data`           | Data-model paths and their exact values.                                                                                                               |
| `events`         | Exact action events, retaining `name`, `source_component_id`, and `context`.                                                                           |
| `functions`      | Exact recorded function calls, retaining `name` and `args`.                                                                                            |

Absent `destroyed`, `events`, and `functions` mean none occurred. Counts reset
per step; notification delivery order is not asserted. The initial expectation
also checks that no actions or functions ran during resolution.

New and retired nodes are checked through structure, identity, and destruction,
not their props-callback counts. A disappearing item may publish its final
binding change before retirement, or be retired first. This suite does not
prescribe that scheduling. Observers remain attached across steps so repeated
destruction is still detected.

Runners also check that mounted positions have distinct node objects, sibling
instance IDs are distinct, and previously obtained binding values remain
unchanged snapshots. For retained nodes that emit, the last emitted props must
match the final complete props, not an intermediate update. No exact instance-ID
spelling, Dart class name, or JavaScript scheduling mechanism appears in cases.

## Adding coverage

Add a scenario to the YAML rather than duplicate its inputs and expectations in
each language. Reuse a fixture when its setup is the same. Keep expectations
focused on the behavior named by the scenario.

The root conformance schema validates cases and operations. Python validation
also checks referenced fixtures and catalog files. Native runners execute the
behavioral assertions in the ordinary Dart and web-core test commands.

The initial migration covers eight core scenarios. SDK-specific serialization,
wire integration, omitted-property behavior, and defensive lifecycle tests
remain native; this suite does not replace every node-resolver test.
