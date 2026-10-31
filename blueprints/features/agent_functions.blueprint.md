---
feature_name: agent_functions
module_blueprints:
  - a2ui_core
  - a2ui_agent
dependencies: []
date_added: 2026-10-31
---

# **Agent Functions Feature Blueprint**

From v1.0 a renderer sends a function call it can't run locally to the agent with `callAgentFunction`, and the agent answers with `agentFunctionResponse` (see [renderer fallback routing](../modules/a2ui_core.blueprint.md#rpc-execution-lifecycle--safeguards) in the core module blueprint). The agent can also call renderer functions with `callRendererFunction`. This feature is the agent's side of both directions:

- The agent declares the functions it hosts on its copy of a catalog, as a function definition plus a handler.
- The agent SDK answers `callAgentFunction` by running those handlers.
- The agent SDK sends `callRendererFunction` and matches the renderer's responses to the calls.
- One entry point takes every renderer-to-agent RPC message.

Code identifiers below are the generic names used across SDKs. Each SDK spells them in its own style.

---

## **Requirements**

### **1. Declaration**

- An agent declares an agent function on its copy of a catalog. Validation, prompt generation and the inference format compilers then treat it like any other function of the catalog, with no changes of their own.
- The model writes a call to an agent function exactly as it writes a call to a renderer function. Nothing in the prompt or the catalog document marks a function as running on the agent: where a call runs is the renderer's decision, made when it finds no local implementation. Usage notes, such as "the value is empty until the agent answers", belong in the function's `description` or the catalog's `instructions`.
- The renderer does not need the declaration. With default validation it accepts the call and routes it. A renderer that validates strictly declares the function schema-only (see [§3 of the details](#3-validation-on-both-sides)).

### **2. Answering calls**

- The agent answers every well-formed `callAgentFunction` with exactly one `agentFunctionResponse` that copies its `functionCallId`, unless the session is disposed while the call runs.
- Errors use the codes in the protocol: `UNKNOWN_FUNCTION`, `INVALID_FUNCTION_CALL` and `EXECUTION_ERROR`, or a code the handler chooses.
- The handler receives arguments validated against the function's schema, with the schema's defaults applied.

### **3. Calling renderer functions**

- The agent builds a `callRendererFunction` message and gets a pending result for it without blocking. The renderer's `rendererFunctionResponse` settles the result, and a timeout, an error response or disposal fails it.
- Responses come from the network, so a late, duplicate, unknown or malformed response is logged and ignored. It never raises.

---

## **Detailed Description of Changes**

### **1. Core: agent functions on the catalog**

**Agent function entry.** An `AgentFunction` is a `FunctionApi` (name, `returnType`, argument schema, `allowedCallers`, `requiresUserActivation`, `description`) plus a handler. It has no `execute`, so a renderer core that is handed a catalog containing one treats it as declared without an implementation and routes calls to it.

```typescript
interface AgentFunctionContext {
  /** The catalog the renderer resolved the call to. */
  readonly catalogId: string;
  /** The surface the call was made on. */
  readonly surfaceId: string;
  /** The ID the response must copy. */
  readonly functionCallId: string;
}

/** Receives validated arguments with defaults applied; returns the value, directly or asynchronously. */
type AgentFunctionHandler = (
  args: Record<string, unknown>,
  context: AgentFunctionContext,
) => unknown | Promise<unknown>;

interface AgentFunction extends FunctionApi {
  readonly handler: AgentFunctionHandler;
}
```

- `allowedCallers` defaults to `rendererOnly`, as for every function: the renderer is the caller. An `agentOnly` agent function is refused by renderers and is never routed, so declaring one is almost always a mistake.
- A function the catalog document already declares can become an agent function without restating its definition: build the agent function from the declared entry (for example `AgentFunction.from_api(entry, handler)` in Python). It keeps the entry's name, schema and metadata, and replaces that entry.

**`Catalog.agentFunctions`.** The catalog constructor and `copyWith` take a list of agent functions.

1. Each agent function is also in `functions`, so every consumer that reads `functions` (validation, `toJson`, prompt generators, compilers) handles it unchanged. `agentFunctions` maps names to the agent function entries.
2. The two stay consistent through every way of deriving a catalog: `copyWith`, `derive` and the function pruning transformer. Pruning a function also drops its agent entry. Deriving `agentFunctions` from `functions` (the entries that carry a handler) rather than storing a second map gives this for free.
3. `copyWith(agentFunctions: ...)` replaces the agent functions. An agent function that was built from a declared entry goes back to that entry.
4. **Name collision.** An agent function whose name is already a function of the catalog is an `A2uiCatalogError`, unless it was built from that very entry. Otherwise a renderer that implements the other function would run it and never route the call.
5. **Protocol version.** A catalog before v1.0 that has agent functions is an `A2uiCatalogError`: renderers only route calls from v1.0.
6. **Serialization.** `toJson` writes an agent function like any other declared function, without an implementation. Handlers are never serialized. A renderer that loads the document gets schema-only declarations, which it routes to the agent, so the agent's catalog document is also a valid strict renderer's declaration list.
7. Renderer code never sets agent functions, so renderer behavior is unchanged.

### **2. Agent SDK: answering `callAgentFunction`**

`AgentFunctionRegistry` is built from the agent's catalogs and indexes their agent functions by `(catalogId, name)`. `handle(message)` takes a `callAgentFunction` message, as a typed model or parsed JSON, and returns the `agentFunctionResponse` to send.

**Error mapping**, checked in this order:

| Condition                                                                                         | Result                                                                  |
| :------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------- |
| Message fails the schema and has no usable `functionCallId`                                       | Raise `A2uiValidationError`; nothing to answer.                         |
| Message fails the schema but has a `functionCallId`                                               | `INVALID_FUNCTION_CALL`                                                 |
| No `catalogId`, and exactly one catalog has an agent function of that name                        | Run that function.                                                      |
| No `catalogId`, and no catalog has an agent function of that name                                 | `UNKNOWN_FUNCTION`                                                      |
| No `catalogId`, and several catalogs have an agent function of that name                          | `INVALID_FUNCTION_CALL` (ambiguous)                                     |
| `catalogId` is not one of the agent's catalogs, or the catalog has no agent function of that name | `UNKNOWN_FUNCTION`. This includes a function declared for the renderer. |
| The function's `allowedCallers` is `agentOnly`                                                    | `INVALID_FUNCTION_CALL`                                                 |
| Arguments fail the function's schema                                                              | `INVALID_FUNCTION_CALL`, with the validation message.                   |
| The handler raises the SDK's RPC error type with a code                                           | That code and message, such as a domain code like `PROVIDER_NOT_FOUND`. |
| The handler raises anything else, or exceeds the registry timeout                                 | `EXECUTION_ERROR` with the error message. The stack trace is logged.    |
| The handler returns                                                                               | `value`, which may be `null`.                                           |

Renderers set `catalogId` on every routed call, so the missing-`catalogId` rules only matter for other senders. Every SDK applies them the same way.

**Arguments.** Validate with the core `PayloadValidator.validateFunction` under strict validation, against the catalog the call resolved to, and pass the coerced result to the handler, never the raw arguments. Defaults in the schema are applied before the handler runs.

**Handler context.** The handler receives an `AgentFunctionContext` with the resolved `catalogId`, the call's `surfaceId` and its `functionCallId`.

**Concurrency, timeouts and cancellation.**

1. Each call is handled independently. The registry keeps no per-call state once it has answered, so one registry can serve many conversations.
2. A handler must not block the thread that runs the other conversations. Asynchronous handlers run on the caller's event loop or executor. Synchronous handlers run on a worker, as the language allows.
3. An optional concurrency limit bounds how many handlers run at once. Calls beyond it wait.
4. The timeout is a registry setting, optionally overridden per `handle` call, not a property of each function. It has no default, because the renderer already times out its call (30 seconds by default). When it expires, the handler is cancelled and the call gets `EXECUTION_ERROR`, so the agent stops working on an answer nobody is waiting for.
5. `dispose()` cancels running handlers and refuses later calls. A call whose handler is cancelled this way, or that arrives after disposal, gets no response; `handle` raises the RPC error with code `DISPOSED`, because the session is gone. The language's own cancellation signal is never turned into `EXECUTION_ERROR`.

### **3. Validation on both sides**

The agent and the renderer share a catalog ID but not the same function list: the agent's copy also has the agent functions. A payload that calls an agent function has to pass validation on both sides.

- **Agent.** Model output is validated against the agent's catalogs, which include the agent functions. A declared agent function passes, and an undeclared name is still rejected, so the agent stays strict. The agent's model of the renderer's state validates against the same catalogs.
- **Renderer, default validation.** Every renderer core accepts a function that its catalog doesn't declare when the app passes no strict configuration, and routes the call.
- **Renderer, strict validation.** With `allowUnknownElements: false`, the renderer rejects the payload as an unrecognized function. It has two options, both described in the protocol and in the core module blueprint's `ValidationConfig` section: allow unknown elements, which keeps the other checks, or declare the agent functions it expects as schema-only entries, which keeps every check, including argument validation, and still routes the calls. A strict renderer can take those declarations from the agent's serialized catalog.

### **4. Agent SDK: calling renderer functions**

`RendererFunctionCalls` holds the agent's pending `callRendererFunction` calls for one conversation.

```typescript
class RendererFunctionCalls {
  constructor(options?: {defaultTimeoutSeconds?: number | null; maxPending?: number});
  /** Registers the call and returns its message and pending result at once. */
  call(options: {
    catalogId: string;
    name: string;
    args?: Record<string, unknown>;
    surfaceId?: string;
    timeoutSeconds?: number;
    functionCallId?: string;
  }): [CallRendererFunctionMessage, Promise<unknown>];
  /** Settles the call a rendererFunctionResponse answers. Never throws for network input. */
  resolve(message: RendererFunctionResponseMessage | Record<string, unknown>): void;
  /** Fails every pending call and refuses later ones. */
  dispose(reason?: string): void;
}
```

1. **Message.** `call` generates the `functionCallId` unless one is given, always sets `catalogId` (required on `callRendererFunction`), and builds the message through the protocol schema. A missing `catalogId` or a message that fails the schema raises `INVALID_FUNCTION_CALL` before anything is registered. `surfaceId` is optional; without it the renderer runs the function against an empty data model, and the field is left out of the message rather than sent as `null`.
2. **Never blocking.** `call` returns at once. The caller sends the message, then awaits the result. There is no synchronous call-and-wait.
3. **One event loop or executor.** An instance belongs to the loop it is first used on, and `call` and its pending table run there. `resolve` and `dispose` may be called from any thread and hand the work to that loop.
4. **Timeouts.** Each call waits 30 seconds by default, configurable per instance or per call, or without limit. A timeout fails the result with code `TIMEOUT` and removes the entry. Settling a call cancels its timer.
5. **Error responses.** A response with `error` fails the result with the renderer's code and message.
6. **Cancellation.** If the caller cancels the pending result, its entry and timer are removed, and a later response is ignored.
7. **Late, duplicate, unknown or malformed responses** are logged (malformed at warning level, the others at debug level) and ignored.
8. **Disposal.** `dispose(reason)` fails every pending result with code `CANCELLED` and the reason, cancels their timers, and makes later `call`s raise with code `DISPOSED`. Where the language has scoped resources, the instance disposes itself at the end of the scope.
9. **Bounded.** An optional `maxPending` makes `call` raise with code `TOO_MANY_PENDING` instead of letting a looping model build up unbounded calls. Reusing a pending `functionCallId` raises with code `DUPLICATE`.

### **5. Agent SDK: renderer message router**

`RendererMessageRouter` is one entry point for renderer-to-agent RPC messages. It is built with an optional registry and an optional `RendererFunctionCalls`.

- `handles(message)` tells whether `dispatch` accepts the message: `callAgentFunction` when it has a registry, `rendererFunctionResponse` when it has a `RendererFunctionCalls`.
- `dispatch(message)` returns the agent-to-renderer messages to send back: the `agentFunctionResponse` for a `callAgentFunction`, and none after settling a `rendererFunctionResponse`.
- Any other message, such as `action` or `error`, belongs to the agent's turn. `dispatch` raises `A2uiValidationError` for it, so callers check `handles` first.

### **6. Serialization**

An `agentFunctionResponse` must carry `value` even when it is `null`. Serialize RPC messages by omitting fields that were never set, not by omitting `null` fields (for example `exclude_unset`, not `exclude_none`, with Pydantic). Dropping `null` produces a response with neither `value` nor `error`, which fails the schema.

---

## **Links**

- [`a2ui_protocol.md` (v1.0)](../../specification/v1_0/docs/a2ui_protocol.md): `callAgentFunction` ("Function Location Resolution & Fallback Routing"), `agentFunctionResponse`, `callRendererFunction` and `rendererFunctionResponse`.
- [`a2ui_core.blueprint.md`](../modules/a2ui_core.blueprint.md): `FunctionApi`, `Catalog`, `ValidationConfig`, and the RPC layer, including renderer fallback routing.
- [`a2ui_agent.blueprint.md`](../modules/a2ui_agent.blueprint.md): catalog transformers, validation, and `A2uiRequestProcessor`.
- [#3536](https://github.com/a2ui-project/a2ui/issues/3536): agent functions declared by the agent and routed by the renderer.
- [#3535](https://github.com/a2ui-project/a2ui/issues/3535): RPC helpers for both directions on the agent.
- [#3415](https://github.com/a2ui-project/a2ui/issues/3415): renderer fallback routing.

---

## **Test Cases & Conformance**

- `conformance/agent/agent_functions.yaml`: declaring agent functions (listed with the catalog's functions; a taken name is a catalog error), every row of the error mapping table, defaults and the handler context, validating model output that calls a declared or an undeclared function, and `RendererFunctionCalls` (message shape, settling, error responses, unknown, late and duplicate responses, default and per-call timeouts, and disposal) on a fake clock.
- `conformance/core/message_processor_v1_0.yaml`, case `test_v10_strict_function_call_to_schema_only_function_of_surface_catalog`: under strict validation, a function the surface catalog declares schema-only passes.
- `conformance/core/agent_function_routing.yaml`: the renderer side of routing, which this feature relies on.

An SDK without an agent function implementation lists `agent_functions.yaml` as a known gap in its agent conformance runner, naming this blueprint.

---

## **Implementation Steps**

1. **Core.** Add the agent function entry and its context type, `agentFunctions` on `Catalog` and `copyWith`, consistency through `derive` and pruning, the name-collision and pre-1.0 errors, and serialization without handlers. Run the declaration cases of `agent_functions.yaml`.
2. **Agent SDK.** Add `AgentFunctionRegistry`, `RendererFunctionCalls` and `RendererMessageRouter`, with no agent framework dependency. Run the rest of `agent_functions.yaml`, and add an end-to-end test where the agent validates model output that calls an agent function and a core `MessageProcessor` without the declaration accepts it under default validation, rejects it under strict validation, and accepts and routes it with a schema-only declaration.
3. **Framework integrations.** Wire the router into each agent framework the SDK supports:
   1. Read renderer-to-agent RPC messages out of the transport's A2UI parts, and wrap replies as A2UI parts.
   2. When a request holds only RPC messages (`callAgentFunction` and `rendererFunctionResponse`), dispatch them through the router and return the replies without running a model turn. Any other content goes to the agent as before.
   3. End a task that held only RPC messages as completed, even when the framework would leave it in progress because no model turn produced output.
   4. Keep RPC messages (`callAgentFunction`, `agentFunctionResponse`, `callRendererFunction` and `rendererFunctionResponse`) out of the contents sent to the model, while keeping them in the session history.
   5. Keep one `RendererFunctionCalls` per session, and dispose it when the session ends.
4. Add `agent_functions` to `implemented_features` in the codebase blueprints of the core and the agent SDK, pinned to the latest commit of this blueprint.
