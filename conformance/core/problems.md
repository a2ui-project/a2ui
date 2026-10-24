# Problem reporting conformance

`problems.yaml` checks when error and warning reports reach listeners, and what a surface group's queue keeps across deletion, detach, re-add and standalone surfaces. Each case uses `action: report_problems` and runs its steps in order against one `MessageProcessor` whose only catalog is `problem-delivery-test`.

## Catalog

The runner builds the `problem-delivery-test` catalog (protocol v0.9):

| Name        | Kind      | Definition                                                                                                                                                                                        |
| ----------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Text`      | component | Properties `text` and `value`, both dynamic strings.                                                                                                                                              |
| `Button`    | component | Property `action`.                                                                                                                                                                                |
| `Column`    | component | Property `children`, a child list.                                                                                                                                                                |
| `maybeFail` | function  | Argument `flag`, a dynamic boolean. Throws a plain error, not an expression error, when `flag` is `true`, and otherwise returns `"ready"`.                                                        |
| `reenter`   | function  | Argument `tick`, a dynamic number. Counts every call and returns `"ok"`. After a `construct_resolver` step with `reenterMessages`, its next call passes those messages to `processMessages` once. |

## Listeners and hooks

The case-level `listeners` names the listeners subscribed before the first step, in order. The default is `["processor"]`. `processor`, `first` and `second` subscribe to the processor group's `onError` and `onWarning`. `surface` subscribes to `onError` and `onWarning` of each surface when it is created or built standalone. An empty list subscribes nothing. Each listener records the report's kind (`error` or `warning`), `code`, `surfaceId` for an error and `path` for a warning.

Hooks act on the first report any listener receives. With the case-level `throwOnFirstReport`, listener `first` throws, and the case expects that exception to reach the platform's uncaught-error path exactly once. The case-level `disposeResolverOnFirstReport` names a surface whose resolver the listener disposes. A step's `onFirstReportMessages` makes the listener pass those messages to `processMessages`.

The runner fails the case if a listener is entered while another listener call is on the stack, or if the messages from `onFirstReportMessages` deliver a report before the listener returns.

## Steps

| `op`                 | Inputs                                                                                    | Meaning                                                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `process_messages`   | `messages`                                                                                | Call `processMessages`.                                                                                                                                                                                            |
| `construct_resolver` | `surfaceId`, optional `standalone`, `components`, `disposeImmediately`, `reenterMessages` | Build a `NodeResolver` on the surface. With `standalone`, first build a `SurfaceModel` outside the group with the test catalog and `components`. With `disposeImmediately`, dispose the resolver in the same step. |
| `dispose_resolver`   | `surfaceId`, optional `onDestroyedMessages`                                               | Dispose the surface's resolver. With `onDestroyedMessages`, the root node's `onDestroyed` handler passes those messages to `processMessages`.                                                                      |
| `set`                | `surfaceId`, `path`, `value`                                                              | Write to the surface's data model directly.                                                                                                                                                                        |
| `invoke_action`      | `surfaceId`, `node`, `property`                                                           | Call the node's action without awaiting it.                                                                                                                                                                        |
| `detach_surface`     | `surfaceId`                                                                               | Call `detachSurface` and hold the returned surface.                                                                                                                                                                |
| `add_surface`        | `surfaceId`                                                                               | Call `addSurface` with the held or standalone surface.                                                                                                                                                             |
| `delete_surface`     | `surfaceId`                                                                               | Call `deleteSurface`.                                                                                                                                                                                              |
| `await_delivery`     |                                                                                           | Wait for the channel's scheduled drain, as the suite header defines per SDK.                                                                                                                                       |

## Assertions

After its op, a step may check:

- `expect_reports`: the reports delivered since the previous `expect_reports`, in delivery order. Each entry gives `code`, and optionally `kind` (default `error`), `surfaceId`, `path` and `listener`.
- `expectLogged` and `expectNotLogged`: substrings that must or must not appear in what the platform log received during the case. The runner needs a way to read that log (Dart captures the zone's `print`).
- `expectFunctionCalls`: the number of `reenter` calls so far.
