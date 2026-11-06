---
feature_name: agent_functions
module_blueprints:
  - a2ui_core
  - a2ui_agent
dependencies: []
date_added: 2026-10-31
---

# **Agent Functions Feature Blueprint**

From v1.0 the agent and the renderer can call each other's functions. A renderer sends a function call it can't run locally to the agent with `callAgentFunction`, and the agent answers with `agentFunctionResponse` (see [renderer fallback routing](../modules/a2ui_core.blueprint.md#rpc-execution-lifecycle--safeguards) in the core module blueprint). In the other direction, the agent sends `callRendererFunction` and the renderer answers with `rendererFunctionResponse`. This feature is the agent's side of both:

1. The agent declares the functions it hosts on its copy of a catalog, as a function definition plus a handler.
2. The agent SDK answers `callAgentFunction` by running those handlers.
3. One entry point, `RendererToAgentMessageProcessor`, takes every renderer-to-agent message, and passes the ones it doesn't answer itself to optional callbacks or back to the agent framework.
4. `RendererFunctionCalls` sends the agent's `callRendererFunction` messages and settles each call from the renderer's response, through the processor's `rendererFunctionResponse` callback.

Code identifiers below use the generic names shared across SDKs. Each SDK spells them in its own naming convention and uses its idiomatic duration or timeout representation.

---

## **Requirements**

### **1. Declaration**

- An agent declares an agent function on its copy of a catalog. Validation, prompt generation and the inference format compilers then treat it like any other function of the catalog, with no changes of their own.
- The model writes a call to an agent function exactly as it writes a call to a renderer function. Nothing in the prompt or the catalog document marks a function as running on the agent: where a call runs is the renderer's decision, made when it finds no local implementation. Usage notes, such as "the value is empty until the agent answers", belong in the function's `description` or the catalog's `instructions`.
- The renderer does not need the declaration. With default validation it accepts the call and routes it. A renderer that validates strictly declares the function schema-only (see [§3 of the details](#3-validation-on-both-sides)).

### **2. Answering calls**

- The agent answers every `callAgentFunction` that has a non-empty `functionCallId` with exactly one `agentFunctionResponse` that copies it. A call without one can't be answered, and is a validation error.
- Errors use the codes in the protocol: `UNKNOWN_FUNCTION`, `INVALID_FUNCTION_CALL` and `EXECUTION_ERROR`, or a code the handler chooses.
- The handler receives arguments validated against the function's schema, with the schema's defaults applied.

### **3. The other renderer messages**

- `action`, `error` and `rendererFunctionResponse` go to a callback the agent registers for that kind. Without one, or when the callback declines, the message is left for the agent framework, which passes it on to the model's turn.
- The entry point keeps no per-conversation state, so it fits stateless, multi-replica servers.

### **4. Calling renderer functions**

- The agent builds a `callRendererFunction` message and gets a pending result for it without blocking. The renderer's `rendererFunctionResponse` settles the result, and a timeout, an error response or disposal fails it.
- Responses come from the network, so a late, duplicate, unknown or malformed response never raises. A response that answers none of the agent's pending calls, such as one to a call the model wrote itself, goes on to the model's turn.
- Given the agent's catalogs, the agent refuses to call a function the renderer can't run or the agent may not call, before anything is sent.
- The pending calls live in memory, so this part needs the response to reach the process that made the call (see [§5](#5-agent-sdk-calling-renderer-functions)).

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
  /** A copy bound to another handler, with the same declaration, `allowedCallers`, schema and description. */
  withHandler(handler: AgentFunctionHandler): AgentFunction;
}
```

- **Callers.** An agent function built directly is always `rendererOnly`: the renderer is the caller, and the constructor takes no `allowedCallers`. The public constructor also takes none of the internal catalog document bookkeeping; `fromApi` copies that metadata from the declaration.
- **From a declared entry.** A function the catalog document already declares can become an agent function without restating its definition: build the agent function from the declared entry (`AgentFunction.fromApi(entry, handler)`). It keeps the entry's name, schema and metadata, including `allowedCallers` when that is `rendererOnly` or `rendererOrAgent`, and replaces that entry. These declarations are an `A2uiCatalogError`:
  1. An `agentOnly` entry, because renderers refuse it and never route it.
  2. An entry with `requiresUserActivation: true` whose `allowedCallers` isn't `rendererOnly`, which the catalog definition schema forbids.

  An argument that isn't a function definition is a type error, where the language doesn't already rule it out.

- **Read-only handler.** `handler` can't be reassigned. `withHandler(handler)` returns a copy bound to a new handler: through `fromApi` when the function has a declaration, otherwise by direct construction, keeping `allowedCallers`, the schema and the description.
- **Handler parameters.** The handler takes the validated arguments, and may take the `AgentFunctionContext` as a second parameter. Languages that check arity at runtime check it at construction: the context is passed only when the second positional parameter has no default or is named `context` or `ctx`, or the handler takes variadic positional arguments, and a handler that can take neither `(args)` nor `(args, context)` is a type error. Statically typed languages keep the two-parameter signature, and a handler that doesn't need the context ignores it.
- **Context.** `AgentFunctionContext` is built with named fields rather than positional arguments.
- **Exports.** `AgentFunction`, `AgentFunctionContext` and `AgentFunctionHandler` are exported from the core package's root facade.

**`Catalog.agentFunctions`.** Agent functions are added to a catalog through `copyWith(agentFunctions: [...])`. A catalog built in code may also list them in `functions`; the constructor has no separate agent functions parameter.

1. Each agent function is also in `functions`, so every consumer that reads `functions` (validation, `toJson`, prompt generators, compilers) handles it unchanged. `agentFunctions` maps names to the agent function entries.
2. **`rendererFunctions`.** A read-only map, by name, of the catalog's functions that aren't agent functions, typed with the catalog's function type. Changing what it returns never changes the catalog.
3. The two stay consistent through every way of deriving a catalog: `copyWith`, `derive` and the function pruning transformer. Pruning a function also drops its agent entry. Deriving `agentFunctions` and `rendererFunctions` from `functions` (whether the entry carries a handler) rather than storing more maps gives this for free.
4. `copyWith(agentFunctions: ...)` replaces the agent functions. When `functions` is omitted, an existing agent function that was built from a declared entry goes back to that entry, and one built directly is dropped. When `functions` is given, its entries are kept as they are, agent functions included.
5. **Name collisions**, each an `A2uiCatalogError` with its own message:
   1. The same name twice in `agentFunctions`.
   2. An agent function whose name is already a function the catalog declares, unless it was built from that very entry. Otherwise a renderer that implements the other function would run it and never route the call.
   3. An agent function built from an entry that the catalog doesn't declare. This stops a declaration from another catalog from slipping in, for example through `copyWith(agentFunctions: [])` on one catalog and then on another.
   4. An agent function built from a declaration of that name that isn't the catalog's own entry object, for example one from a reloaded or copied catalog. The message says it was built with `fromApi` from a different declaration than the one in this catalog, and to build it from this catalog's entry.
6. **Protocol version.** A catalog before v1.0 that has agent functions is an `A2uiCatalogError`: renderers only route calls from v1.0.
7. **Parameter names.** When an agent function is added to a v1.0 or later catalog, at construction or through `copyWith`, the names of its parameters are checked as UAX #31 identifiers that don't start with `@`, as when a catalog document is parsed. The check covers every parameter the argument schema declares, including those in union, intersection, refined and shorthand schemas, and a bad name is an `A2uiCatalogError`.
8. **Serialization.** `toJson` writes an agent function like any other declared function, without an implementation. Handlers are never serialized. A renderer that loads the document gets schema-only declarations, which it routes to the agent, so the agent's catalog document is also a valid strict renderer's declaration list.
9. **Local `$defs`.** A `#/$defs/X` reference in an agent function's argument schema resolves against the catalog's root `$defs` merged with the function's own `$defs` (those of its argument schema, and of the whole definition when the schema is one). Since `toJson` hoists them into the catalog document, a local name that the catalog's `$defs`, or another agent function's local `$defs`, defines differently (compared as JSON values) is an `A2uiCatalogError` naming the function and the definition. An identical definition is accepted.
10. Renderer code never sets agent functions, so renderer behavior is unchanged.

### **2. Agent SDK: answering `callAgentFunction`**

`RendererToAgentMessageProcessor` (see [§4](#4-agent-sdk-renderer-to-agent-message-processor)) is built from the agent's catalogs and indexes their agent functions by `(catalogId, name)`. Two catalogs with the same ID are an `A2uiCatalogError` when the processor is built. The index is an internal module of the agent SDK, not a public class. For a `callAgentFunction` message, given as a typed model or parsed JSON, the processor returns the one `agentFunctionResponse` to send.

**Error mapping**, checked in this order:

| Condition                                                                                         | Result                                                                  |
| :------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------- |
| A parsed message whose `version` isn't exactly `"1.0"`                                            | Raise `A2uiValidationError`, before the message kind is read.           |
| No `functionCallId`, or an empty one                                                              | Raise `A2uiValidationError`; nothing to answer.                         |
| Message fails the schema but has a `functionCallId`                                               | `INVALID_FUNCTION_CALL`, such as a call without `callFunction`.         |
| Empty `surfaceId`                                                                                 | `INVALID_FUNCTION_CALL`                                                 |
| Empty function name (`@call`)                                                                     | `INVALID_FUNCTION_CALL`                                                 |
| No `catalogId`, and exactly one catalog has an agent function of that name                        | Run that function.                                                      |
| No `catalogId`, and no catalog has an agent function of that name                                 | `UNKNOWN_FUNCTION`                                                      |
| No `catalogId`, and several catalogs have an agent function of that name                          | `INVALID_FUNCTION_CALL` (ambiguous)                                     |
| `catalogId` is not one of the agent's catalogs, or the catalog has no agent function of that name | `UNKNOWN_FUNCTION`. This includes a function declared for the renderer. |
| The function's `allowedCallers` is `agentOnly`                                                    | `INVALID_FUNCTION_CALL`                                                 |
| Arguments fail the function's schema                                                              | `INVALID_FUNCTION_CALL`, with the validation message.                   |
| The handler raises the SDK's RPC error type with a code                                           | That code and message, such as a domain code like `PROVIDER_NOT_FOUND`. |
| The handler raises anything else, including a validation or timeout error                         | `EXECUTION_ERROR` with the error message. The stack trace is logged.    |
| The handler exceeds the processor's agent function timeout                                        | `EXECUTION_ERROR` saying that the function timed out.                   |
| The handler returns                                                                               | `value`, which may be `null`.                                           |

The version check is the processor's first check for every kind of message (see [§4](#4-agent-sdk-renderer-to-agent-message-processor)), so a `callAgentFunction` with a missing or other version raises even when it has a `functionCallId`. Once the version is right and the `functionCallId` can be read, every other problem with the message, such as a missing `callFunction`, an unknown field or an empty `surfaceId`, becomes an `INVALID_FUNCTION_CALL` reply.

A validation error that the handler raises is a handler error like any other: only the processor's own argument check produces `INVALID_FUNCTION_CALL`.

Renderers set `catalogId` on every routed call, so the missing-`catalogId` rules only matter for other senders. Every SDK applies them the same way.

**Arguments.** Validate with the core `PayloadValidator.validateFunction` under strict validation, against the catalog the call resolved to, and pass the coerced result to the handler, never the raw arguments. The arguments are resolved JSON, not expressions, so a nested key that starts with `@` is ordinary data; only top-level argument names must be UAX #31 identifiers. Validation runs on the arguments as sent, with the full JSON Schema (`patternProperties`, nested closed objects and the rest), and the schema's defaults are applied after it, before the handler runs, so a default never satisfies `required` or trips a constraint.

**Handler context.** The handler receives an `AgentFunctionContext` with the resolved `catalogId`, the call's `surfaceId` and its `functionCallId`.

**Concurrency, timeouts and cancellation.**

1. Each call is handled independently. The processor keeps no per-call state once it has answered, so one processor can serve many conversations, or one can be built cheaply per request from the active catalogs.
2. A handler must not block the thread that runs the other conversations. Asynchronous handlers run on the caller's event loop or executor. Synchronous handlers run on a worker, as the language allows.
3. There is no concurrency limit, task tracking or `dispose`: the server that hosts the agent already bounds concurrent requests and cancels the work of a request whose client went away.
4. The agent function timeout is an optional processor setting, not a property of each function, expressed in each SDK's native duration or numeric unit. It must be a finite positive duration (a non-positive, non-finite, or boolean value raises the language's argument error), and it has no default, because the renderer already times out its call (30 seconds by default). When it expires, the handler is cancelled and the call gets `EXECUTION_ERROR`, so the agent stops working on an answer nobody is waiting for. Only the processor's own deadline produces the timeout message: a timeout error the handler raises itself is a handler error like any other.
5. Cancelling the processing of a call (the language's own cancellation) cancels its handler and sends nothing. It is never turned into `EXECUTION_ERROR`.

### **3. Validation on both sides**

The agent and the renderer share a catalog ID but not the same function list: the agent's copy also has the agent functions. A payload that calls an agent function has to pass validation on both sides.

- **Agent.** Model output is validated against the agent's catalogs, which include the agent functions. A declared agent function passes, and an undeclared name is still rejected, so the agent stays strict. The agent's model of the renderer's state validates against the same catalogs.
- **Renderer, default validation.** Every renderer core accepts a function that its catalog doesn't declare when the app passes no strict configuration, and routes the call.
- **Renderer, strict validation.** With `allowUnknownElements: false`, the renderer rejects the payload as an unrecognized function. It has two options, both described in the protocol and in the core module blueprint's `ValidationConfig` section: allow unknown elements, which keeps the other checks, or declare the agent functions it expects as schema-only entries, which keeps every check, including argument validation, and still routes the calls. A strict renderer can take those declarations from the agent's serialized catalog.

### **4. Agent SDK: renderer-to-agent message processor**

`RendererToAgentMessageProcessor` is the agent-side counterpart of the core `MessageProcessor`: one entry point for the four renderer-to-agent messages of v1.0.

```typescript
interface ProcessResult {
  /** Whether the processor handled the message. An unhandled message is for the agent's turn. */
  readonly handled: boolean;
  /** The agent-to-renderer messages to send back. */
  readonly replies: AgentToRendererMessage[];
}

/** Returning `false`, directly or asynchronously, declines the message. */
type RendererMessageCallback<T> = (message: T) => boolean | void | Promise<boolean | void>;

class RendererToAgentMessageProcessor {
  constructor(options: {
    catalogs: Iterable<CatalogApi>;
    /** Optional, in the SDK's duration or timeout unit (see §2). */
    agentFunctionTimeout?: number;
    onAction?: RendererMessageCallback<ActionMessage>;
    onError?: RendererMessageCallback<ErrorMessage>;
    onRendererFunctionResponse?: RendererMessageCallback<RendererFunctionResponseMessage>;
  });
  processMessage(message: RendererToAgentMessage | Record<string, unknown>): Promise<ProcessResult>;
}
```

Each SDK types the callbacks in its idiomatic sync-or-async callable form; returning `false` declines the message, while returning nothing (or `true`) marks it handled.

There is no batch method: callers run `processMessage` for each message, which leaves them in charge of concurrency and of handling each message's errors.

**Input.** A message is one of the v1.0 renderer-to-agent message models, or a parsed JSON object. A parsed object must have `version` exactly `"1.0"`, as `renderer_to_agent.json` requires, for every kind; a missing or other version (such as `"v1.0"`) raises `A2uiValidationError`. Any other model type is rejected the same way. The agent SDK's RPC facade also re-exports the v1.0 renderer-to-agent message models, `CallRendererFunctionMessage`, and `AgentFunctionResponseMessage`.

1. **`callAgentFunction`** is always handled, and `replies` holds exactly one `agentFunctionResponse`, as [§2](#2-agent-sdk-answering-callagentfunction) describes.
2. **`action`, `error` and `rendererFunctionResponse`.** With the matching callback set, the processor validates the message against its v1.0 schema model (a malformed one raises `A2uiValidationError`), awaits the callback with the model, and returns `handled` with no replies. A callback that returns `false` declines the message: the result is not `handled`, with no replies, so the message goes on to the agent's turn. Returning nothing or `true` means handled. An exception from the callback propagates. Without the callback, it returns not `handled`, with no replies, and doesn't validate the message, so an agent framework can pass it on to the model's turn.
3. **Anything else**, such as an unknown message key, more than one message key, or a value that isn't an object, raises `A2uiValidationError`.

### **5. Agent SDK: calling renderer functions**

`RendererFunctionCalls` holds the agent's pending `callRendererFunction` calls for one conversation.

```typescript
class RendererFunctionCalls {
  constructor(options?: {
    /** 30 seconds unless set; null waits without a limit. */
    defaultTimeout?: number | null;
    maxPending?: number | null;
    catalogs?: Iterable<CatalogApi>;
  });
  readonly disposed: boolean;
  readonly pendingCount: number;
  isPending(functionCallId: string): boolean;
  /** Builds and registers the call; returns its message and pending result at once. */
  call(options: {
    catalogId: string;
    name: string;
    args?: Record<string, unknown>;
    surfaceId?: string;
    timeout?: number | null;
    functionCallId?: string;
  }): [CallRendererFunctionMessage, Promise<unknown>];
  /** Settles the call a response answers. True if it named a pending call. Never throws for network input. */
  resolve(message: RendererFunctionResponseMessage | Record<string, unknown>): boolean;
  /** Fails every pending call and refuses later ones. */
  dispose(reason?: string): void;
}
```

Timeouts use each SDK's native duration or numeric unit, and `call` returns the outbound `CallRendererFunctionMessage` paired with the SDK's pending async result handle.

**Making a call.** `call` never blocks: the caller sends the message, then awaits the result. It runs these checks in this order, and each failure is raised synchronously, before any message is built, any call is registered or any timer starts. Every failure after the first is an `A2uiRpcError` with the code shown.

0. A per-call timeout that isn't a finite positive duration (zero, negative, NaN, infinity, or a boolean) raises the language's argument error.
1. A disposed instance raises with code `DISPOSED`.
2. A given `functionCallId` that is an empty string raises with code `INVALID_FUNCTION_CALL`. An omitted one is generated; each SDK generates a unique string in its own format.
3. An ID that is already pending raises with code `DUPLICATE`.
4. With `maxPending` set, a call beyond that many pending calls raises with code `TOO_MANY_PENDING`, so a looping model can't build up calls without limit.
5. An empty function name raises with code `INVALID_FUNCTION_CALL` ("The call needs a function name.").
6. An empty `catalogId`, which `callRendererFunction` requires, raises with code `INVALID_FUNCTION_CALL`.
7. A function name that isn't a UAX #31 identifier, or starts with `@`, raises with code `INVALID_FUNCTION_CALL`.
8. When `args` is given, it must be a JSON object (a mapping with string keys) whose keys are all UAX #31 identifiers, and its values must be JSON values: null, booleans, strings, finite numbers, and arrays and objects (with string keys) of these, recursively. NaN and infinity aren't JSON values. A violation raises with code `INVALID_FUNCTION_CALL`, and the message names a bad key. Values aren't otherwise interpreted: a nested `@call` or `@path` object is just an object here, which the renderer validates. The arguments are never checked against the function's argument schema. A statically typed SDK whose signature already rejects a non-object `args` satisfies that check at the type level.
9. With `catalogs`, the target is checked against them (see Checking calls against the catalogs, below). Steps 5 to 8 always run before this one.

An empty `surfaceId` counts as no surface: the message leaves `surfaceId` out, and the renderer runs the function against an empty data model. Other language-level type errors (such as a non-string `surfaceId`) follow the language's usual behavior.

**Timeouts.** Each call waits 30 seconds by default, as the renderer side does. The default timeout follows the same rule as a per-call one (a finite positive value, checked when the instance is built), and a null default means calls never time out: "no limit" can only be set on the instance. A call can override the default with its own finite positive timeout; omitting it (or passing null) uses the default. A timeout fails the result with code `TIMEOUT` and removes the call. Settling a call cancels its timer.

**Settling calls with `resolve`.**

1. A well-formed response to a pending call settles it: a `value` resolves the result (with `null` allowed), and an `error` fails it with the renderer's code and message. `resolve` returns true.
2. A response to an unknown, late (timed out or cancelled) or duplicate call is ignored, and `resolve` returns false.
3. A malformed response (for example one with both `value` and `error`) is ignored, except that if it carries the `functionCallId` of a pending call, that call fails at once with code `UNKNOWN_ERROR` rather than waiting for its timeout, and `resolve` returns true. Otherwise it returns false.
4. `resolve` is the processor's `onRendererFunctionResponse` callback. Because it returns false for a response it doesn't own, the processor reports that response as not handled, and it reaches the model's turn. This matters because the inference formats also compile a function call the model writes on its own (such as `<a2ui>getLocation()</a2ui>`) into a `callRendererFunction` message that `RendererFunctionCalls` never saw.

`isPending(functionCallId)` checks whether a call is currently awaiting a response without settling it, and `pendingCount` reports how many calls are currently pending.

**Cancellation and disposal.** Cancelling a pending result through the SDK's cancellation handle forgets the call, and a later response to it is ignored. `dispose(reason)` fails every pending result with code `CANCELLED` carrying the reason, cancels their timers, and makes later `call`s raise with code `DISPOSED`.

**Checking calls against the catalogs.** With `catalogs`, such as the agent's active catalogs, `call` checks the target after the checks above that don't depend on it:

1. A `catalogId` that names none of the catalogs, or a name that isn't one of that catalog's renderer functions, raises with code `UNKNOWN_FUNCTION`. Agent functions don't count, however they were built: they run on the agent, so the renderer can't run them.
2. A function whose `allowedCallers` is `rendererOnly`, or that leaves `allowedCallers` out (which means `rendererOnly`), raises with code `INVALID_FUNCTION_CALL`: the agent may not call it.
3. A function with `requiresUserActivation: true` raises with code `INVALID_FUNCTION_CALL`, since a call from the agent has no user gesture. A valid v1.0 catalog document only allows that together with `rendererOnly`, but a catalog built in code isn't checked against the schema, so this is checked on its own.
4. Otherwise (`rendererOrAgent` or `agentOnly`, with no activation needed) the call goes ahead.

Two catalogs with the same ID are an `A2uiCatalogError` when the instance is built, as for the processor. Without `catalogs`, nothing is checked.

**Stateless servers.** The pending calls live in the memory of the process that made them. This suits a server that keeps a conversation on one process, such as one holding a streaming connection. On a stateless or multi-replica server, the `rendererFunctionResponse` can arrive in a later request on another replica, where no pending call matches it: `resolve` declines it, and it goes to the model. Such a server handles responses in its own `onRendererFunctionResponse` callback instead, for example by looking up state it saved by `functionCallId`.

**Framework integration.** An agent framework callback or middleware that intercepts incoming requests:

1. Processes every message that isn't a `callAgentFunction` first, with a processor whose `onRendererFunctionResponse` is the session's `resolve`. This settles every pending call the request answers, even in a request that then goes to the agent, such as one that also holds text or a response to a call the session didn't make. A malformed response that names a pending call fails it.
2. Answers the request without a model turn only when every part is an A2UI message and every message was handled; only then do its `callAgentFunction` messages run, through a processor built from the active catalogs (with no catalogs, the agent runs instead), and their replies become the agent's response. Otherwise it returns nothing, and the agent runs with the whole request.

When a request held only responses and produced an empty reply, the integration marks the transport task completed rather than leaving it open. Only `callAgentFunction` and `agentFunctionResponse` are stripped from the model prompt; `callRendererFunction` and unsettled `rendererFunctionResponse` messages remain visible to the model.

### **6. Serialization**

An `agentFunctionResponse` must carry `value` even when it is `null`. Serialize RPC messages by omitting fields that were never set, not by omitting `null` fields (omitting unset optional fields rather than stripping `null` values). Dropping `null` produces a response with neither `value` nor `error`, which fails the schema.

---

## **Links**

- [`a2ui_protocol.md` (v1.0)](../../specification/v1_0/docs/a2ui_protocol.md): `callAgentFunction` ("Function Location Resolution & Fallback Routing"), `agentFunctionResponse`, `callRendererFunction` and `rendererFunctionResponse`.
- [`a2ui_core.blueprint.md`](../modules/a2ui_core.blueprint.md): `FunctionApi`, `Catalog`, `ValidationConfig`, and the RPC layer, including renderer fallback routing.
- [`a2ui_agent.blueprint.md`](../modules/a2ui_agent.blueprint.md): catalog transformers, validation, and `A2uiRequestProcessor`.
- [#3536](https://github.com/a2ui-project/a2ui/issues/3536): agent functions declared by the agent and routed by the renderer.
- [#3535](https://github.com/a2ui-project/a2ui/issues/3535): the agent calling renderer functions.
- [#3415](https://github.com/a2ui-project/a2ui/issues/3415): renderer fallback routing.

---

## **Test Cases & Conformance**

- `conformance/agent/agent_functions.yaml` (64 cases):
  - `declare_agent_functions`: agent functions are listed with the catalog's functions; the name collisions (the same name twice, a name the catalog declares, `from_api` with an entry the catalog doesn't declare), `from_api` with an `agentOnly` entry or with `requiresUserActivation` on a `rendererOrAgent` entry, and a parameter name that isn't a UAX #31 identifier on a v1.0 catalog (including one reached through a deep `#/$defs/...` pointer, which is followed as a JSON Pointer) are catalog errors, as is an agent function whose local `$defs` defines a name differently from the catalog's `$defs` or another agent function's (an identical definition is accepted).
  - `handle_agent_function`: every row of the error mapping table, including an empty function name, a required argument left out even when it has a default (defaults are applied after validation), keys a closed schema's `patternProperties` match and keys they don't, a `returnType` field on the wire `callFunction` (which belongs only on catalog definitions in v1.0, so the call gets `INVALID_FUNCTION_CALL`), and a handler that raises a validation error (`raises` with `validation: true`), defaults, nested `@` keys in resolved arguments (ordinary data), and the handler context, driven through `RendererToAgentMessageProcessor.processMessage`, which must report `handled` with exactly one reply.
  - `process_renderer_message`: each of `action`, `error` and `rendererFunctionResponse` with and without its callback (the callback receives the validated message), a callback that declines, a malformed `action` with its callback set, an unknown message key, a raw message without `version` or with `version: "v1.0"` (validation errors), two catalogs with the same ID (a catalog error), and `callAgentFunction` with an empty `functionCallId` (a validation error) or an empty `surfaceId` (an `INVALID_FUNCTION_CALL` reply).
  - `validate_payload`: validating model output that calls a declared or an undeclared function.
- `conformance/agent/renderer_function_calls.yaml` (30 `call_renderer_function` cases): the message a call builds (with an empty `surfaceId` left out), the order and rules of the checks in `call` (an empty given `functionCallId`, an empty name, a name that isn't an identifier or starts with `@`, `args` that aren't an object or have a key that isn't an identifier, the name checked before the `catalogId` and the `args` before the catalogs), settling calls with values, `null` and error responses, ignoring unknown, duplicate and late responses, the 30-second default, per-instance and per-call timeouts, disposal, the limit on pending calls, and the catalog checks. The cases run on a fake clock that only an `advance_ms` step moves. Two forms are specific to this suite:
  - `args.catalogs` lists catalogs that the harness builds in code as v1.0 catalogs, not from a catalog document, so the schema's rules don't apply: `[{catalogId, functions: {<name>: {allowedCallers?, requiresUserActivation?}}}]`, where each function takes any object and returns `any`, and an entry that leaves `allowedCallers` out is `rendererOnly`.
  - A case may have a top-level `expect_error` (such as `{category: CatalogError}` for two catalogs with one ID) instead of `steps`, when building `RendererFunctionCalls` must fail.
  - A `call` step may set `functionCallId`, and its `args` may be any JSON value, so a case can pass a list.

  Non-finite numbers can't be written portably in YAML or JSON, so the JSON-value rule for `args` and the timeout argument errors are covered by each SDK's unit tests instead.

  A harness that hands responses over through the processor, with `resolve` as `onRendererFunctionResponse`, also checks that a response is handled exactly when its call is pending.

- `conformance/core/message_processor_v1_0.yaml`, case `test_v10_strict_function_call_to_schema_only_function_of_surface_catalog`: under strict validation, a function the surface catalog declares schema-only passes.
- `conformance/core/agent_function_routing.yaml`: the renderer side of routing, which this feature relies on.

Every agent conformance runner that implements this feature runs every case of both suites, with no skips. An SDK that does not implement this feature yet registers every case of `agent_functions.yaml` (and `renderer_function_calls.yaml`) as skipped in its agent conformance runner, giving that reason, as `conformance/README.md` describes.

---

## **Implementation Steps**

1. **Core.** Add the agent function entry (read-only handler, `withHandler`) and its context type, `agentFunctions` (through `copyWith` only) and `rendererFunctions` on `Catalog`, consistency through `derive` and pruning, the name-collision, undeclared-entry, different-declaration, `agentOnly`, user-activation, parameter-name and pre-1.0 errors, serialization without handlers, and the root facade exports. Run the `declare_agent_functions` cases of `agent_functions.yaml`.
2. **Agent SDK.** Add `RendererToAgentMessageProcessor` and `ProcessResult` (with the version rule, declining callbacks and the duplicate catalog ID error), with the agent function index as an internal module and no agent framework dependency. Run the rest of `agent_functions.yaml`, and add an end-to-end test where the agent validates model output that calls an agent function and a core `MessageProcessor` without the declaration accepts it under default validation, rejects it under strict validation, and accepts and routes it with a schema-only declaration.
3. **Framework integrations.** Wire the processor into each agent framework the SDK supports:
   1. Read renderer-to-agent messages out of the transport's A2UI parts, and wrap replies as A2UI parts.
   2. When a request holds only `callAgentFunction` messages, build a processor from the active catalogs, answer them through it, and return the replies without running a model turn. Any other content, including `action`, `error` and `rendererFunctionResponse`, goes to the agent as before.
   3. Keep `callAgentFunction` and `agentFunctionResponse` out of the contents sent to the model, while keeping them in the session history.
4. **Calling renderer functions.** Add `RendererFunctionCalls`, with the checks in `call` in the order of §5, `resolve` returning whether it owned the response, and the optional `catalogs` checks, and run `renderer_function_calls.yaml`. In each framework integration, settle the session's pending calls through `onRendererFunctionResponse`, answer a request without a model turn only when every message in it is handled, and end a task whose request held only responses as completed.
5. Add `agent_functions` to `implemented_features` in the codebase blueprints of the core and the agent SDK, pinned to the latest commit of this blueprint.
