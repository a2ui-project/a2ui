---
feature_name: agent_functions
module_blueprints:
  - a2ui_core
  - a2ui_agent
dependencies: []
date_added: 2026-10-31
---

# **Agent Functions Feature Blueprint**

From v1.0 a renderer sends a function call it can't run locally to the agent with `callAgentFunction`, and the agent answers with `agentFunctionResponse` (see [renderer fallback routing](../modules/a2ui_core.blueprint.md#rpc-execution-lifecycle--safeguards) in the core module blueprint). This feature is the agent's side of that exchange:

- The agent declares the functions it hosts on its copy of a catalog, as a function definition plus a handler.
- The agent SDK answers `callAgentFunction` by running those handlers.
- One entry point, `RendererToAgentMessageProcessor`, takes every renderer-to-agent message, and passes the ones it doesn't answer itself to optional callbacks or back to the agent framework.

Calling renderer functions from the agent (`callRendererFunction`, and matching the renderer's `rendererFunctionResponse` to the call) is not part of this feature yet. It is a planned follow-up ([#3535](https://github.com/a2ui-project/a2ui/issues/3535)); see [Follow-up: calling renderer functions](#5-follow-up-calling-renderer-functions).

Code identifiers below are the generic names used across SDKs. Each SDK spells them in its own style.

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

- `action`, `error` and `rendererFunctionResponse` go to a callback the agent registers for that kind. Without one, the message is left for the agent framework, which passes it on to the model's turn.
- The entry point keeps no per-conversation state, so it fits stateless, multi-replica servers.

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

- **Callers.** An agent function built directly is always `rendererOnly`: the renderer is the caller, and the constructor takes no `allowedCallers`. The public constructor also takes none of the catalog document plumbing (such as Python's `is_definition` and `from_document`); `fromApi` copies those from the declaration.
- **From a declared entry.** A function the catalog document already declares can become an agent function without restating its definition: build the agent function from the declared entry (for example `AgentFunction.from_api(entry, handler)` in Python). It keeps the entry's name, schema and metadata, including `allowedCallers` when that is `rendererOnly` or `rendererOrAgent`, and replaces that entry. These declarations are an `A2uiCatalogError`:
  1. An `agentOnly` entry, because renderers refuse it and never route it.
  2. An entry with `requiresUserActivation: true` whose `allowedCallers` isn't `rendererOnly`, which the catalog definition schema forbids.

  An argument that isn't a function definition is a type error, where the language doesn't already rule it out.

- **Read-only handler.** `handler` can't be reassigned. `withHandler(handler)` returns a copy bound to a new handler: through `fromApi` when the function has a declaration, otherwise by direct construction, keeping `allowedCallers`, the schema and the description.
- **Handler parameters.** The handler takes the validated arguments, and may take the `AgentFunctionContext` as a second parameter. Languages that check arity at runtime check it at construction: the context is passed only when the second positional parameter has no default or is named `context` or `ctx`, or the handler takes variadic positional arguments, and a handler that can take neither `(args)` nor `(args, context)` is a type error. Statically typed languages keep the two-parameter signature, and a handler that doesn't need the context ignores it.
- **Context.** `AgentFunctionContext` is built with named fields only (keyword-only in Python, named parameters in Dart).
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
7. **Parameter names.** On a v1.0 catalog, the names of an agent function's parameters are checked as UAX #31 identifiers at construction and in `copyWith`, as when a catalog document is parsed, and a bad one is an `A2uiCatalogError`.
8. **Serialization.** `toJson` writes an agent function like any other declared function, without an implementation. Handlers are never serialized. A renderer that loads the document gets schema-only declarations, which it routes to the agent, so the agent's catalog document is also a valid strict renderer's declaration list.
9. Renderer code never sets agent functions, so renderer behavior is unchanged.

### **2. Agent SDK: answering `callAgentFunction`**

`RendererToAgentMessageProcessor` (see [§4](#4-agent-sdk-renderer-to-agent-message-processor)) is built from the agent's catalogs and indexes their agent functions by `(catalogId, name)`. Two catalogs with the same ID are an `A2uiCatalogError` when the processor is built. The index is an internal module of the agent SDK, not a public class. For a `callAgentFunction` message, given as a typed model or parsed JSON, the processor returns the one `agentFunctionResponse` to send.

**Error mapping**, checked in this order:

| Condition                                                                                         | Result                                                                  |
| :------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------- |
| No `functionCallId`, or an empty one                                                              | Raise `A2uiValidationError`; nothing to answer.                         |
| Message fails the schema but has a `functionCallId`                                               | `INVALID_FUNCTION_CALL`                                                 |
| Empty `surfaceId`                                                                                 | `INVALID_FUNCTION_CALL`                                                 |
| Empty function name (`@call`)                                                                     | `INVALID_FUNCTION_CALL`                                                 |
| No `catalogId`, and exactly one catalog has an agent function of that name                        | Run that function.                                                      |
| No `catalogId`, and no catalog has an agent function of that name                                 | `UNKNOWN_FUNCTION`                                                      |
| No `catalogId`, and several catalogs have an agent function of that name                          | `INVALID_FUNCTION_CALL` (ambiguous)                                     |
| `catalogId` is not one of the agent's catalogs, or the catalog has no agent function of that name | `UNKNOWN_FUNCTION`. This includes a function declared for the renderer. |
| The function's `allowedCallers` is `agentOnly`                                                    | `INVALID_FUNCTION_CALL`                                                 |
| Arguments fail the function's schema                                                              | `INVALID_FUNCTION_CALL`, with the validation message.                   |
| The handler raises the SDK's RPC error type with a code                                           | That code and message, such as a domain code like `PROVIDER_NOT_FOUND`. |
| The handler raises anything else, including the language's own timeout error                      | `EXECUTION_ERROR` with the error message. The stack trace is logged.    |
| The handler exceeds the processor's agent function timeout                                        | `EXECUTION_ERROR` saying that the function timed out.                   |
| The handler returns                                                                               | `value`, which may be `null`.                                           |

Renderers set `catalogId` on every routed call, so the missing-`catalogId` rules only matter for other senders. Every SDK applies them the same way.

**Arguments.** Validate with the core `PayloadValidator.validateFunction` under strict validation, against the catalog the call resolved to, and pass the coerced result to the handler, never the raw arguments. Defaults in the schema are applied before the handler runs.

**Handler context.** The handler receives an `AgentFunctionContext` with the resolved `catalogId`, the call's `surfaceId` and its `functionCallId`.

**Concurrency, timeouts and cancellation.**

1. Each call is handled independently. The processor keeps no per-call state once it has answered, so one processor can serve many conversations, or one can be built cheaply per request from the active catalogs.
2. A handler must not block the thread that runs the other conversations. Asynchronous handlers run on the caller's event loop or executor. Synchronous handlers run on a worker, as the language allows.
3. There is no concurrency limit, task tracking or `dispose`: the server that hosts the agent already bounds concurrent requests and cancels the work of a request whose client went away.
4. The agent function timeout is an optional processor setting, not a property of each function. It must be a finite positive number (not a boolean, in languages that would accept one), and it has no default, because the renderer already times out its call (30 seconds by default). When it expires, the handler is cancelled and the call gets `EXECUTION_ERROR`, so the agent stops working on an answer nobody is waiting for. Only the processor's own deadline produces the timeout message: a timeout error the handler raises itself is a handler error like any other.
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

class RendererToAgentMessageProcessor {
  constructor(options: {
    catalogs: Iterable<CatalogApi>;
    agentFunctionTimeoutSeconds?: number | null;
    /** Each callback may return `false` to decline the message. */
    onAction?: (message: ActionMessage) => boolean | void | Promise<boolean | void>;
    onError?: (message: ErrorMessage) => boolean | void | Promise<boolean | void>;
    onRendererFunctionResponse?: (
      message: RendererFunctionResponseMessage,
    ) => boolean | void | Promise<boolean | void>;
  });
  processMessage(message: RendererToAgentMessage | Record<string, unknown>): Promise<ProcessResult>;
}
```

There is no batch method: callers run `processMessage` for each message, which leaves them in charge of concurrency and of handling each message's errors.

**Input.** A message is one of the v1.0 renderer-to-agent message models, or a parsed JSON object. A parsed object must have `version` exactly `"1.0"`, as `renderer_to_agent.json` requires, for every kind; a missing or other version (such as `"v1.0"`) raises `A2uiValidationError`. Any other model type is rejected the same way. The agent SDK's RPC facade re-exports the v1.0 renderer-to-agent message classes and `AgentFunctionResponseMessage`.

1. **`callAgentFunction`** is always handled, and `replies` holds exactly one `agentFunctionResponse`, as [§2](#2-agent-sdk-answering-callagentfunction) describes.
2. **`action`, `error` and `rendererFunctionResponse`.** With the matching callback set, the processor validates the message against its v1.0 schema model (a malformed one raises `A2uiValidationError`), awaits the callback with the model, and returns `handled` with no replies. A callback that returns `false` declines the message: the result is not `handled`, with no replies, so the message goes on to the agent's turn. Returning nothing or `true` means handled. An exception from the callback propagates. Without the callback, it returns not `handled`, with no replies, and doesn't validate the message, so an agent framework can pass it on to the model's turn.
3. **Anything else**, such as an unknown message key, more than one message key, or a value that isn't an object, raises `A2uiValidationError`.

### **5. Follow-up: calling renderer functions**

The agent calling renderer functions (`callRendererFunction`, [#3535](https://github.com/a2ui-project/a2ui/issues/3535)) is left to a follow-up. Its open design questions are how a pending call survives a stateless, multi-replica server, where the `rendererFunctionResponse` arrives in a later request, and how responses to calls that a model emitted through an inference format, which no pending table knows, reach the model. The follow-up plugs into the processor's `onRendererFunctionResponse` callback, which declines (returns `false`) responses to calls it didn't make, so this feature's API doesn't change for it. Until then, a `rendererFunctionResponse` without a callback is unhandled and goes to the model's turn.

### **6. Serialization**

An `agentFunctionResponse` must carry `value` even when it is `null`. Serialize RPC messages by omitting fields that were never set, not by omitting `null` fields (for example `exclude_unset`, not `exclude_none`, with Pydantic). Dropping `null` produces a response with neither `value` nor `error`, which fails the schema.

---

## **Links**

- [`a2ui_protocol.md` (v1.0)](../../specification/v1_0/docs/a2ui_protocol.md): `callAgentFunction` ("Function Location Resolution & Fallback Routing"), `agentFunctionResponse`, `callRendererFunction` and `rendererFunctionResponse`.
- [`a2ui_core.blueprint.md`](../modules/a2ui_core.blueprint.md): `FunctionApi`, `Catalog`, `ValidationConfig`, and the RPC layer, including renderer fallback routing.
- [`a2ui_agent.blueprint.md`](../modules/a2ui_agent.blueprint.md): catalog transformers, validation, and `A2uiRequestProcessor`.
- [#3536](https://github.com/a2ui-project/a2ui/issues/3536): agent functions declared by the agent and routed by the renderer.
- [#3535](https://github.com/a2ui-project/a2ui/issues/3535): the agent calling renderer functions (follow-up).
- [#3415](https://github.com/a2ui-project/a2ui/issues/3415): renderer fallback routing.

---

## **Test Cases & Conformance**

- `conformance/agent/agent_functions.yaml`:
  - `declare_agent_functions`: agent functions are listed with the catalog's functions; the name collisions (the same name twice, a name the catalog declares, `from_api` with an entry the catalog doesn't declare), `from_api` with an `agentOnly` entry or with `requiresUserActivation` on a `rendererOrAgent` entry, and a parameter name that isn't a UAX #31 identifier on a v1.0 catalog are catalog errors.
  - `handle_agent_function`: every row of the error mapping table, including an empty function name, defaults and the handler context, driven through `RendererToAgentMessageProcessor.processMessage`, which must report `handled` with exactly one reply.
  - `process_renderer_message`: each of `action`, `error` and `rendererFunctionResponse` with and without its callback (the callback receives the validated message), a callback that declines, a malformed `action` with its callback set, an unknown message key, a raw message without `version` or with `version: "v1.0"` (validation errors), two catalogs with the same ID (a catalog error), and `callAgentFunction` with an empty `functionCallId` (a validation error) or an empty `surfaceId` (an `INVALID_FUNCTION_CALL` reply).
  - `validate_payload`: validating model output that calls a declared or an undeclared function.
- `conformance/core/message_processor_v1_0.yaml`, case `test_v10_strict_function_call_to_schema_only_function_of_surface_catalog`: under strict validation, a function the surface catalog declares schema-only passes.
- `conformance/core/agent_function_routing.yaml`: the renderer side of routing, which this feature relies on.

Every agent conformance runner that implements this feature runs every case, with no skips. An SDK without an agent function implementation lists `agent_functions.yaml` as a known gap in its agent conformance runner, naming this blueprint.

---

## **Implementation Steps**

1. **Core.** Add the agent function entry (read-only handler, `withHandler`) and its context type, `agentFunctions` (through `copyWith` only) and `rendererFunctions` on `Catalog`, consistency through `derive` and pruning, the name-collision, undeclared-entry, different-declaration, `agentOnly`, user-activation, parameter-name and pre-1.0 errors, serialization without handlers, and the root facade exports. Run the `declare_agent_functions` cases of `agent_functions.yaml`.
2. **Agent SDK.** Add `RendererToAgentMessageProcessor` and `ProcessResult` (with the version rule, declining callbacks and the duplicate catalog ID error), with the agent function index as an internal module and no agent framework dependency. Run the rest of `agent_functions.yaml`, and add an end-to-end test where the agent validates model output that calls an agent function and a core `MessageProcessor` without the declaration accepts it under default validation, rejects it under strict validation, and accepts and routes it with a schema-only declaration.
3. **Framework integrations.** Wire the processor into each agent framework the SDK supports:
   1. Read renderer-to-agent messages out of the transport's A2UI parts, and wrap replies as A2UI parts.
   2. When a request holds only `callAgentFunction` messages, build a processor from the active catalogs, answer them through it, and return the replies without running a model turn. Any other content, including `action`, `error` and `rendererFunctionResponse`, goes to the agent as before.
   3. Keep `callAgentFunction` and `agentFunctionResponse` out of the contents sent to the model, while keeping them in the session history.
4. Add `agent_functions` to `implemented_features` in the codebase blueprints of the core and the agent SDK, pinned to the latest commit of this blueprint.
