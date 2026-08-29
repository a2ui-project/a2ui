# A2UI Swift Core (`A2UISwiftCore`)

The `A2UISwiftCore` package provides the framework-agnostic runtime state engine, message
processor, JSON pointer resolver, and catalog registries for native Swift platforms.

For the platform-agnostic protocol specification and lifecycle rules, see
[specification/v0_9_1/docs/a2ui_protocol.md](../../specification/v0_9_1/docs/a2ui_protocol.md) and
[blueprints/modules/a2ui_core.blueprint.md](../../blueprints/modules/a2ui_core.blueprint.md).

---

## 1. Targets and responsibilities

The Core module defines three SPM targets in root [Package.swift](../../Package.swift):

- **`A2UIJSON`** (`Sources/A2UIJSON/`):
  Pure JSON Schema 2020-12 data structures, schema builders, and remote `$ref` resolution storage
  supporting the A2UI v0.9.1 protocol schemas.
- **`A2UICore`** (`Sources/A2UICore/`):
  Stateful processing engine. Parses server messages, manages `SurfaceGroupModel`,
  resolves relative/absolute JSON pointers with auto-vivification in `DataModel`,
  and manages client action dispatching.
- **`BasicCatalog`** (`Sources/BasicCatalog/`):
  Defines the schema APIs and standard function handlers (such as `formatString`) for the
  canonical A2UI Basic Catalog.

---

## 2. Usage example

```swift
import A2UICore
import BasicCatalog

// 1. Initialize MessageProcessor with supported catalogs
let processor = MessageProcessor(catalogs: [BasicCatalog.catalog])

// 2. Observe surfaces
processor.surfaceGroup.onSurfaceCreated = { surface in
  print("Surface created: \(surface.id)")
}

// 3. Ingest incoming JSON or message objects
let jsonMessage = """
{
  "version": "v0.9",
  "createSurface": {
    "surfaceId": "main",
    "catalogId": "https://a2ui.org/specification/v0.9/catalogs/basic/catalog.json"
  }
}
"""

try processor.processMessages(jsonString: jsonMessage)
```

---

## 3. Registering custom components and functions

### Custom component API

Define a component schema conforming to `ComponentAPI`:

```swift
import A2UICore
import JSONSchema

public struct UserCardAPI: ComponentAPI {
  public let typeName = "UserCard"
  public let schema: Schema

  public init() {
    // Construct or load JSON schema
    self.schema = Schema.object(
      properties: [
        "name": .string,
        "avatarUrl": .string
      ],
      required: ["name"]
    )
  }
}
```

### Custom function handler

Register logic functions with `FunctionHandler`:

```swift
let customCatalog = Catalog(
  id: "https://example.com/catalogs/custom.json",
  components: [UserCardAPI()],
  functions: [
    "toUpper": { args, _ in
      guard let str = args.first?.stringValue else { return .null }
      return .string(str.uppercased())
    }
  ]
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
