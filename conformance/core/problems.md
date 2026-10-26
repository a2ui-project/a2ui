# Problem reporting conformance

`problems.yaml` checks when error and warning reports reach listeners, and that a deleted surface delivers none. Each case uses `action: report_problems` and runs its steps in order against one `MessageProcessor` whose only catalog is `problem-delivery-test`.

## Catalog

The runner builds the `problem-delivery-test` catalog (protocol v0.9):

| Name        | Kind      | Definition                                                                                                                                 |
| ----------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `Text`      | component | Properties `text` and `value`, both dynamic strings.                                                                                       |
| `Button`    | component | Property `action`.                                                                                                                         |
| `Column`    | component | Property `children`, a child list.                                                                                                         |
| `maybeFail` | function  | Argument `flag`, a dynamic boolean. Throws a plain error, not an expression error, when `flag` is `true`, and otherwise returns `"ready"`. |
| `reenter`   | function  | Argument `tick`, a dynamic number. Counts every call and returns `"ok"`.                                                                   |

## Listeners and hooks

The case-level `listeners` names the listeners subscribed to each surface's `onError` and `onWarning` when the surface is created, in order. The default is `["surface"]`. Each listener (`surface`, `first`, `second`) records the report's kind (`error` or `warning`), `code`, `surfaceId` for an error and `path` for a warning.

Hooks act on the first report any listener receives. With the case-level `throwOnFirstReport`, listener `first` throws. The case-level `disposeResolverOnFirstReport` names a surface whose resolver the listener disposes.

The runner fails the case if a listener is entered while another listener call is on the stack.

## Steps

| `op`                 | Inputs                                     | Meaning                                                                                                  |
| -------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `process_messages`   | `messages`                                 | Call `processMessages`.                                                                                  |
| `construct_resolver` | `surfaceId`, optional `disposeImmediately` | Build a `NodeResolver` on the surface. With `disposeImmediately`, dispose the resolver in the same step. |
| `dispose_resolver`   | `surfaceId`                                | Dispose the surface's resolver.                                                                          |
| `set`                | `surfaceId`, `path`, `value`               | Write to the surface's data model directly.                                                              |
| `invoke_action`      | `surfaceId`, `node`, `property`            | Call the node's action without awaiting it.                                                              |
| `delete_surface`     | `surfaceId`                                | Call `deleteSurface`.                                                                                    |
| `await_delivery`     |                                            | Wait one microtask, as the suite header defines per SDK.                                                 |

## Assertions

After its op, a step may check:

- `expect_reports`: the reports delivered since the previous `expect_reports`, in delivery order. Each entry gives `code`, and optionally `kind` (default `error`), `surfaceId`, `path` and `listener`.
- `expectFunctionCalls`: the number of `reenter` calls so far.
