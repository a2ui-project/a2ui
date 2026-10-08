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
  `@index`) for the canonical A2UI Basic Catalog (`v0.9`, `v0.9.1`, and `v1.0`).

---

## 2. Usage example

```swift
import A2UICore
import BasicCatalog

// 1. Initialize MessageProcessor with supported catalogs
let processor = MessageProcessor(catalogs: BasicCatalog.allCatalogs)

// 2. Observe surfaces
let cancellable = processor.surfaceGroupModel.onSurfaceCreated { surface in
  print("Surface created: \(surface.surfaceID)")
}

// 3. Ingest incoming JSON or message objects
let jsonMessage = """
{
  "version": "v1.0",
  "createSurface": {
    "surfaceId": "main",
    "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
  }
}
"""

let message = try MessageParser.parse(string: jsonMessage)
processor.process(message: message)
```

---

## 3. Registering custom components and functions

### Custom component API

Define a component schema conforming to `ComponentAPI`:

```swift
import A2UICore
import JSONSchema

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
  protocolVersion: "v1.0",
  components: [UserCardAPI().eraseToAnyComponentAPI()],
  functions: [ToUpperFunction()]
)
```

---

## 4. Development and testing

To build and test core targets from the monorepo root:

```bash
# Run core unit test suites:
swift test --filter A2UICoreTests --filter A2UIJSONTests --filter BasicCatalogTests

# Format core files:
swift-format format -i -r Package.swift swift/core
```
