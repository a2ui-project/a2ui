# A2UI SwiftUI framework adapter (`A2UISwiftUI`)

The `A2UISwiftUI` package provides the native SwiftUI rendering layer for A2UI, mapping
`SurfaceViewModel` trees into declarative Apple views across iOS, macOS, iPadOS, tvOS,
and visionOS.

For the platform-agnostic rendering and layout specifications, see the
[framework adapter blueprint][adapter-bp] and the [basic catalog guide][catalog-guide].

[adapter-bp]: ../../blueprints/modules/a2ui_framework_adapter.blueprint.md
[catalog-guide]: ../../specification/v0_9_1/docs/basic_catalog_implementation_guide.md

---

## 1. Targets and responsibilities

Defined in root [Package.swift](../../Package.swift):

- **`A2UISwiftUI`** (`Sources/A2UISwiftUI/`):
  Core rendering engine. Provides the root `Surface` view, recursive `ComponentNodeView`,
  reactive data-binding adapters, and SwiftUI environment keys (`a2uiCatalogs`, `a2uiTheme`).
- **`BasicCatalogSwiftUI`** (`Sources/BasicCatalog/`):
  Concrete native SwiftUI views for all Basic Catalog components (`A2UIText`, `A2UIButton`,
  `A2UIRow`, `A2UIColumn`, `A2UICard`, `A2UIList`, `A2UITabs`, `A2UIModal`, etc.) conforming to
  `ComponentImplementation`.

---

## 2. Usage example

```swift
import A2UICore
import A2UISwiftUI
import BasicCatalogSwiftUI
import SwiftUI

struct ChatView: View {
  @ObservedObject var surfaceViewModel: SurfaceViewModel

  var body: some View {
    VStack {
      // Embed native A2UI Surface
      Surface(viewModel: surfaceViewModel)
        .environment(\.a2uiCatalogs, [BasicCatalogSwiftUI.catalogImplementation])
    }
  }
}
```

---

## 3. Creating custom SwiftUI components

To render custom component types in SwiftUI:

1. Implement `ComponentImplementation` to supply a view builder:

```swift
import A2UICore
import A2UISwiftUI
import SwiftUI

public struct CustomProfileImplementation: ComponentImplementation {
  public let api: ComponentAPI = UserCardAPI()

  public init() {}

  @ViewBuilder
  public func buildView(
    node: Node,
    context: ComponentContext
  ) -> AnyView {
    AnyView(
      VStack {
        Text(node.properties["name"]?.stringValue ?? "Unknown")
          .font(.headline)
      }
    )
  }
}
```

2. Register the implementation in your catalog array passed to the `.a2uiCatalogs` environment.

---

## 4. Development and testing

To run SwiftUI adapter unit tests:

```bash
# Run SwiftUI test suites:
swift test --filter A2UISwiftUITests

# Format SwiftUI files:
swift-format format -i -r Package.swift swift/swiftui
```
