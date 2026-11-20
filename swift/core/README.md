# A2UI Swift Core (`A2UISwiftCore`)

The `A2UISwiftCore` package provides the framework-agnostic runtime state engine, message
processor, JSON pointer resolver, and catalog registries for native Swift platforms.

For the platform-agnostic protocol specifications and lifecycle rules, see
[specification/v0_9_1/docs/a2ui_protocol.md](../../specification/v0_9_1/docs/a2ui_protocol.md),
[specification/v1_0/docs/a2ui_protocol.md](../../specification/v1_0/docs/a2ui_protocol.md), and
[blueprints/modules/a2ui_core.blueprint.md](../../blueprints/modules/a2ui_core.blueprint.md).

---

## 1. Targets and responsibilities

The Core module defines three SPM targets in root [Package.swift](../../Package.swift):

- **`A2UIJSON`** (`Sources/A2UIJSON/`):
  Pure JSON Schema 2020-12 data structures, schema builders, and remote `$ref` resolution storage
  supporting the A2UI v0.9.1 and v1.0 protocol schemas (`common_types.json`,
  `catalog_definition.json`).
- **`A2UICore`** (`Sources/A2UICore/`):
  Stateful processing engine. Parses agent-to-renderer messages, manages `SurfaceGroupModel`,
  resolves relative/absolute JSON pointers with auto-vivification in `DataModel`,
  evaluates bidirectional RPC calls via `RPCHandler`, and manages action dispatching.
- **`BasicCatalog`** (`Sources/BasicCatalog/`):
  Defines the schema APIs and standard function implementations (such as `formatString` and
  `@index`) for the canonical A2UI Basic Catalog (`v0.9`, `v0.9.1`, and `1.0`).

---

## 2. Usage example

```swift
import A2UICore
import BasicCatalog
import Combine

// 1. Initialize MessageProcessor with supported catalogs (on the main actor)
let processor = MessageProcessor(catalogs: BasicCatalog.allCatalogs)

// 2. Observe surfaces
let cancellable = processor.surfaceGroupModel.$surfacesMap.sink { surfaces in
  print("Active surfaces: \(surfaces.keys.sorted())")
}

// 3. Parse and process incoming JSON messages
let jsonMessage = """
{
  "version": "1.0",
  "createSurface": {
    "surfaceId": "main",
    "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
  }
}
"""

let message = try MessageParser().parse(jsonString: jsonMessage)
processor.process(message: message)
```

---

## 3. Registering custom components and functions

### Custom component API

Define a component schema conforming to `ComponentAPI`:

```swift
import A2UICore
import JSONSchema
import OrderedJSON

public struct UserCardAPI: ComponentAPI {
  public let name = "UserCard"
  public let schema: Schema

  public init() {
    self.schema = try! Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "component": { "const": "UserCard" },
            "name": { "type": "string" },
            "avatarUrl": { "type": "string" }
          },
          "required": ["component", "name"]
        }
        """
    )
  }
}
```

### Custom function implementation

Register logic functions conforming to `FunctionImplementation`:

```swift
public struct ToUpperFunction: FunctionImplementation {
  public let api = FunctionAPI(
    name: "toUpper",
    returnType: .string,
    schema: try! Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "value": { "type": "string" }
          },
          "required": ["value"]
        }
        """
    )
  )

  public func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    guard let str = arguments["value"]?.stringValue else { return .null }
    return .string(str.uppercased())
  }
}

let customCatalog = Catalog(
  id: "https://example.com/catalogs/custom.json",
  protocolVersion: .v10,
  components: [UserCardAPI()],
  functions: [ToUpperFunction()]
)
```

To keep part of an existing catalog under a new ID, derive a catalog from it. A name keeps the
source's entry of that name, and `.add` adds a new entry:

```swift
let chatCatalog = try BasicCatalog.makeCatalog(version: .v10).derive(
  id: "https://example.com/catalogs/chat.json",
  components: [
    "Text", "Image", "Row", "Column", "Button",
    .add(UserCardAPI().eraseToAnyComponentAPI()),
  ],
  functions: ["openUrl"]
)
```

### Agent-side functions

From v1.0, a function call that the renderer can't run locally goes to the agent: the fallback
routing of `callAgentFunction`. This covers a function that the call's catalog doesn't declare,
and one that it declares with `SchemaOnlyFunction`, which has no local implementation:

```swift
let lookupPrice = SchemaOnlyFunction(
  api: FunctionAPI(
    name: "lookupPrice",
    returnType: .number,
    schema: try! Schema(
      instance: """
        {
          "type": "object",
          "properties": { "sku": { "type": "string" } },
          "required": ["sku"]
        }
        """
    )
  )
)
```

`MessageProcessor` routes these calls while it has an `outboundListener`. It sends a
`callAgentFunction` message naming the catalog the call resolved to, and the bound value is `null`
until the agent answers. A declared function's arguments are validated before the call is sent,
and an agent error or timeout (`agentFunctionTimeoutSeconds`) is reported as an
`EXPRESSION_ERROR`. The surface keeps each answer for bindings and checks, so bindings that make
the same call (same catalog, function and arguments) send it once and all read the answer, while
actions always send a fresh call. A function call that takes an agent result as an argument runs
once that result arrives, including in an action. Payload validation with `ValidationConfig.strict`
rejects undeclared functions, so declare the agent-side functions you expect, or allow unknown
elements.

A few details of this routing ([#3741](https://github.com/a2ui-project/a2ui/pull/3741)):

1. An event action resolves its `context` entries one at a time, then its `userMessage`, and waits
   for each entry's agent calls before it resolves the next one. The entries follow the order of
   the decoded `context` object, which Foundation's `JSONDecoder` may not keep from the payload.
   The first call that fails stops the action: no later call is sent, the event isn't dispatched,
   and the error is reported once. A `userMessage` that resolves to null is left out. One that
   resolves to any other non-string, at once or after an agent call, stops the action with an
   `INVALID_ACTION` error.
2. The arguments of one function call resolve together, so their agent calls are sent at the same
   time. The call runs once all of them are answered.
3. A function call that a local function resolves while it runs, such as a `formatString`
   `${...}` part, can't wait for the agent. A part that calls an agent function fails with an
   `EXPRESSION_ERROR` naming the function, nothing is sent, and the part is empty.
4. Evaluations that can't wait never send a call: a one-shot read through a `DataContext` built
   on the surface reads only an answer the surface already keeps, and otherwise fails with an
   `EXPRESSION_ERROR`. The arguments of an agent-initiated `callRendererFunction` fail as they
   did before routing, with an `EXECUTION_ERROR` response that carries the local error message.
5. A check rule whose condition waits on the agent is pending (`ResolvedCheck.isPending`,
   `Node.isValidationPending`): it neither passes nor fails. If the call fails, the check fails.
6. A failed call isn't sent again when unrelated data changes. A remounted node, or a change to
   the call's arguments, sends it again. A cancelled call isn't remembered as failed, so the next
   evaluation sends it again.
7. The surface keeps the answers of calls that resolved nodes make, even past its limit of 256
   kept answers, so those nodes never send them again.
8. Replacing or clearing `SurfaceViewModel.agentFunctionCaller` drops the answers the surface
   keeps, and answers to calls made through the previous caller are ignored.
9. `deleteSurface` cancels the surface's pending calls with the `CANCELLED` code
   (`FunctionError.surfaceCallsCancelled`), which reports nothing. A deleted surface sends nothing.
10. A call whose arguments hold a NaN or infinite number isn't sent, and fails with an
    `EXPRESSION_ERROR`, because those numbers have no JSON form.
11. The arguments sent for a schema-only function have the schema's defaults applied, including
    the defaults of nested object properties.
12. Breaking: a local function that throws while an action runs (its `functionCall`, or an
    event's `context` or `userMessage`) is reported as `EXECUTION_ERROR` instead of
    `EXPRESSION_ERROR`. Bindings and checks still report `EXPRESSION_ERROR`, as do agent errors,
    timeouts, refusals (`requiresUserActivation`, `agentOnly`), argument validation failures and
    unknown functions.
13. A malformed `context` entry or `userMessage` of an event action, such as a `@call` whose
    name isn't a string or an unknown `@` key like `{"@unknown": 1}`, stops the action with an
    `EXPRESSION_ERROR`: "Action event context entry '<key>' is invalid: <reason>" or "Action
    event userMessage is invalid: <reason>". A key that starts with `@@` is a literal `@` key.
14. From v1.0, a local function call whose arguments don't match the function's schema is
    refused with an `EXPRESSION_ERROR` and doesn't run, in bindings and actions alike. In an
    event action, the event isn't dispatched.

---

## 4. Development and testing

To build and test core targets from the monorepo root:

```bash
# Run core unit test suites:
swift test --filter A2UICoreTests --filter A2UIJSONTests --filter BasicCatalogTests

# Format core files:
swift-format format -i -r Package.swift swift/core
```
