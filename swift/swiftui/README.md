# A2UI SwiftUI framework adapter (`A2UISwiftUI`)

The `A2UISwiftUI` package provides the native SwiftUI rendering layer for A2UI, mapping
`SurfaceViewModel` trees into declarative Apple views on iOS and iPadOS 17+ and macOS 14+.

For the platform-agnostic rendering and layout specifications, see the
[framework adapter blueprint][adapter-bp] and the [basic catalog guide][catalog-guide].

[adapter-bp]: ../../blueprints/modules/a2ui_framework_adapter.blueprint.md
[catalog-guide]: ../../catalogs/basic/v0_9_1/basic_catalog_implementation_guide.md

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
      // Embed native A2UI Surface with registered SwiftUI catalogs
      Surface(
        viewModel: surfaceViewModel,
        catalogs: BasicCatalogImplementation.allCatalogs
      )
    }
  }
}
```

---

## 3. Creating custom SwiftUI components

To render custom component types in SwiftUI:

1. Construct a `ComponentImplementation` combining a `ComponentAPI` and view builder:

```swift
import A2UICore
import A2UISwiftUI
import SwiftUI

let customProfileImplementation = ComponentImplementation(api: UserCardAPI()) { node in
  VStack {
    Text(node.string(for: "name") ?? "Unknown")
      .font(.headline)
  }
}
```

2. Register the `ComponentImplementation` in a `Catalog<ComponentImplementation>` and pass it to `Surface(viewModel:catalogs:)`.

### Accessibility

`ComponentNodeView` applies each component's A2UI accessibility attributes (`@accessibility` in
v1.0, `accessibility` before v1.0) to the rendered view, so custom components get them without
extra work:

- `label`: `accessibilityLabel`
- `description`: `accessibilityHint`
- `hidden`: `accessibilityHidden` for the whole subtree
- `live` (`polite` / `assertive`) announces the explicit `label` followed by the visible text
  inside the component whenever either changes, for example when it is bound to the data model

Only values the agent sets are applied, so SwiftUI keeps inferring labels from visible text.

A live region reads the text that components inside it report. If your component renders text,
call `.a2uiAccessibleText(text)` with the text as it reads on screen (for example without Markdown
syntax), before any `.a2uiAccessibilityElement(for:children:)`, so an explicit label on a
`.combine` element replaces it. The basic catalog's `Text` does this. Outside a live region the
text is not built.

SwiftUI applies a label set on a stack to every element inside it. If your component's root is a
stack:

- with one focusable control (like a text field with a title and an error line), call
  `.a2uiAccessibilityControl(for: node, defaultLabel: title)` on the control, so the label and
  hint reach the element that VoiceOver focuses, and hide the visible title with
  `.accessibilityHidden(true)` so the field is not read twice;
- otherwise, call `.a2uiAccessibilityElement(for: node, children: .contain)` on the root (or
  `.combine` for read-only content), so the label describes the component as a whole. The basic
  catalog's `Row`, `Column`, `List` and `Card` do this.

The basic catalog's selectable controls expose their state to assistive technologies without
custom strings: `CheckBox` and `multipleSelection` `ChoicePicker` options are represented as a
standard `Toggle` (`accessibilityRepresentation`), so the platform announces their on/off state
in the user's language, while `mutuallyExclusive` options and the selected `Tabs` header carry
the selected trait. On iOS 17 and macOS 14 and later, the row of tab headers also carries the tab
bar trait.

Limitations: SwiftUI drops an accessibility hint on a group, so `description` has no effect on
layout containers or other `.contain` groups (for example `ChoicePicker`), tracked in
[#3147](https://github.com/a2ui-project/a2ui/issues/3147). Of the basic catalog components, only
`Text` reports its visible text to live regions so far. On iOS 17 and macOS 14, changing a bound
`hidden` value rebuilds the component's subtree, which resets its state.

---

## 4. Development and testing

To run SwiftUI adapter unit tests:

```bash
# Run SwiftUI test suites:
swift test --filter A2UISwiftUITests

# Format SwiftUI files:
swift-format format -i -r Package.swift swift/swiftui
```
