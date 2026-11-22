// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import A2UICore
import A2UISwiftUI
import BasicCatalog
import BasicCatalogSwiftUI
import OrderedJSON
import SwiftUI
import Testing

#if canImport(AppKit)
  import AppKit
#elseif canImport(UIKit)
  import UIKit
#endif

private final class StyleInvocationTracker: @unchecked Sendable {
  var cardStyleInvoked = false
  var cardColorSchemes: [ColorScheme] = []
  var buttonVariants: [A2UIButtonStyleConfiguration.Variant] = []
  var buttonColorSchemes: [ColorScheme] = []
  var textFieldConfigurations: [TextFieldSnapshot] = []
  var textFieldColorSchemes: [ColorScheme] = []
}

private struct TextFieldSnapshot: Equatable {
  let hasLabel: Bool
  let variant: A2UITextFieldStyleConfiguration.Variant
  let errorMessage: String?
  let hasError: Bool
  let isDisabled: Bool
  let nodeID: String
}

private struct ProbeCardStyle: A2UICardStyle {
  @Environment(\.colorScheme) private var colorScheme
  let tracker: StyleInvocationTracker

  func makeBody(configuration: Configuration) -> some View {
    let _ = {
      tracker.cardStyleInvoked = true
      tracker.cardColorSchemes.append(colorScheme)
    }()
    configuration.content
  }
}

private struct ProbeButtonStyle: A2UIButtonStyle {
  @Environment(\.colorScheme) private var colorScheme
  let tracker: StyleInvocationTracker

  func makeBody(configuration: Configuration) -> some View {
    let _ = {
      tracker.buttonVariants.append(configuration.variant)
      tracker.buttonColorSchemes.append(colorScheme)
    }()
    configuration.label
      .padding(4)
  }
}

private struct ProbeTextFieldStyle: A2UITextFieldStyle {
  @Environment(\.colorScheme) private var colorScheme
  let tracker: StyleInvocationTracker

  func makeBody(configuration: Configuration) -> some View {
    let _ = {
      tracker.textFieldConfigurations.append(
        TextFieldSnapshot(
          hasLabel: configuration.label != nil,
          variant: configuration.variant,
          errorMessage: configuration.errorMessage,
          hasError: configuration.hasError,
          isDisabled: configuration.isDisabled,
          nodeID: configuration.node.id
        )
      )
      tracker.textFieldColorSchemes.append(colorScheme)
    }()
    configuration.field
      .padding(2)
  }
}

@Suite(.serialized)
@MainActor
struct ComponentStyleTests {

  #if canImport(AppKit)
    private func host(_ view: some View) -> NSWindow {
      let hostingView = NSHostingView(rootView: view)
      hostingView.frame = NSRect(x: 0, y: 0, width: 320, height: 240)
      let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 320, height: 240),
        styleMask: [.borderless],
        backing: .buffered,
        defer: false
      )
      window.isReleasedWhenClosed = false
      window.contentView = hostingView
      window.makeKeyAndOrderFront(nil)
      RunLoop.main.run(until: Date())
      hostingView.needsLayout = true
      hostingView.layoutSubtreeIfNeeded()
      window.displayIfNeeded()
      RunLoop.main.run(until: Date())
      hostingView.layoutSubtreeIfNeeded()
      return window
    }
  #elseif canImport(UIKit)
    private func host(_ view: some View) -> UIWindow {
      let controller = UIHostingController(rootView: view)
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 240))
      window.rootViewController = controller
      window.makeKeyAndVisible()
      RunLoop.main.run(until: Date())
      controller.view.setNeedsLayout()
      controller.view.layoutIfNeeded()
      return window
    }
  #endif

  @Test func customCardAndButtonStylesReceiveConfiguration() {
    let tracker = StyleInvocationTracker()
    let coreCatalog = BasicCatalog.makeCatalog(version: .v091)
    let viewModel = SurfaceViewModel(surfaceID: "styles", catalog: coreCatalog)
    viewModel.componentsModel.applyBatch(adding: [
      ComponentModel(
        id: "root",
        type: "Card",
        properties: ["child": .string("btn")]
      ),
      ComponentModel(
        id: "btn",
        type: "Button",
        properties: [
          "child": .string("lbl"),
          "variant": .string("primary"),
          "action": .object(["name": .string("confirm")]),
        ]
      ),
      ComponentModel(
        id: "lbl",
        type: "Text",
        properties: ["text": .string("Confirm")]
      ),
    ])

    let rootView = Surface.makeWithBasicCatalogs(viewModel: viewModel)
      .a2uiCardStyle(ProbeCardStyle(tracker: tracker))
      .a2uiButtonStyle(ProbeButtonStyle(tracker: tracker))

    let window = host(rootView)
    defer { window.close() }
    withExtendedLifetime(window) {
      #expect(tracker.cardStyleInvoked)
      #expect(Set(tracker.buttonVariants) == [.primary])
    }
  }

  @Test func customStylesResolveEnvironmentInDarkMode() {
    let tracker = StyleInvocationTracker()
    let coreCatalog = BasicCatalog.makeCatalog(version: .v091)
    let viewModel = SurfaceViewModel(surfaceID: "dark-mode", catalog: coreCatalog)
    viewModel.componentsModel.applyBatch(adding: [
      ComponentModel(
        id: "root",
        type: "Card",
        properties: ["child": .string("btn")]
      ),
      ComponentModel(
        id: "btn",
        type: "Button",
        properties: [
          "child": .string("lbl"),
          "variant": .string("borderless"),
          "action": .object(["name": .string("dismiss")]),
        ]
      ),
      ComponentModel(
        id: "lbl",
        type: "Text",
        properties: ["text": .string("Dismiss")]
      ),
    ])

    let rootView = Surface.makeWithBasicCatalogs(viewModel: viewModel)
      .a2uiCardStyle(ProbeCardStyle(tracker: tracker))
      .a2uiButtonStyle(ProbeButtonStyle(tracker: tracker))
      .environment(\.colorScheme, .dark)

    let window = host(rootView)
    defer { window.close() }
    withExtendedLifetime(window) {
      #expect(tracker.cardColorSchemes.contains(.dark))
      #expect(tracker.buttonColorSchemes.contains(.dark))
      #expect(Set(tracker.buttonVariants) == [.borderless])
    }
  }

  @Test func builtInCardAndButtonStylesConstructAndRender() {
    let cardNode = Node(
      id: "card",
      type: "Card",
      properties: ["child": Node(id: "txt", type: "Text", properties: ["text": "Body"])]
    )
    let buttonNode = Node(
      id: "btn",
      type: "Button",
      properties: ["child": Node(id: "lbl", type: "Text", properties: ["text": "Action"])]
    )

    let automaticCard = A2UICard(node: cardNode).a2uiCardStyle(.automatic)
    let elevatedCard = A2UICard(node: cardNode).a2uiCardStyle(.elevated)
    let outlinedCard = A2UICard(node: cardNode).a2uiCardStyle(.outlined)
    let automaticButton = A2UIButton(node: buttonNode).a2uiButtonStyle(.automatic)

    let w1 = host(automaticCard)
    let w2 = host(elevatedCard)
    let w3 = host(outlinedCard)
    let w4 = host(automaticButton)
    defer {
      w1.close()
      w2.close()
      w3.close()
      w4.close()
    }
    withExtendedLifetime((w1, w2, w3, w4)) {}
  }

  private func failingCheck(_ message: String) -> ResolvedCheck {
    ResolvedCheck(
      condition: DataBinding<Bool>(identity: .literal(.boolean(false)), value: false),
      message: message,
      validationResult: ValidationResult(valid: false, message: message, severity: .error)
    )
  }

  @Test func customTextFieldStyleReceivesConfiguration() {
    let tracker = StyleInvocationTracker()
    let node = Node(
      id: "pin",
      type: "TextField",
      properties: [
        "label": "PIN",
        "variant": "obscured",
        "checks": [failingCheck("Required")],
      ]
    )

    let window = host(
      A2UITextField(node: node).a2uiTextFieldStyle(ProbeTextFieldStyle(tracker: tracker)))
    defer { window.close() }
    withExtendedLifetime(window) {
      let snapshot = TextFieldSnapshot(
        hasLabel: true,
        variant: .obscured,
        errorMessage: "Required",
        hasError: true,
        isDisabled: false,
        nodeID: "pin"
      )
      #expect(tracker.textFieldConfigurations.last == snapshot)
    }
  }

  @Test func customTextFieldStyleSeesDisabledStateAndUnknownVariant() {
    let tracker = StyleInvocationTracker()
    let node = Node(id: "note", type: "TextField", properties: ["variant": "unknown"])

    let rootView = A2UITextField(node: node)
      .a2uiTextFieldStyle(ProbeTextFieldStyle(tracker: tracker))
      .disabled(true)

    let window = host(rootView)
    defer { window.close() }
    withExtendedLifetime(window) {
      let snapshot = TextFieldSnapshot(
        hasLabel: false,
        variant: .shortText,
        errorMessage: nil,
        hasError: false,
        isDisabled: true,
        nodeID: "note"
      )
      #expect(tracker.textFieldConfigurations.last == snapshot)
    }
  }

  @Test func customTextFieldStyleResolvesEnvironmentInDarkMode() {
    let tracker = StyleInvocationTracker()
    let coreCatalog = BasicCatalog.makeCatalog(version: .v091)
    let viewModel = SurfaceViewModel(surfaceID: "text-field-dark", catalog: coreCatalog)
    viewModel.componentsModel.applyBatch(adding: [
      ComponentModel(
        id: "root",
        type: "TextField",
        properties: [
          "label": .string("Notes"),
          "variant": .string("longText"),
          "value": .string(""),
        ]
      )
    ])

    let rootView = Surface.makeWithBasicCatalogs(viewModel: viewModel)
      .a2uiTextFieldStyle(ProbeTextFieldStyle(tracker: tracker))
      .environment(\.colorScheme, .dark)

    let window = host(rootView)
    defer { window.close() }
    withExtendedLifetime(window) {
      #expect(tracker.textFieldColorSchemes.contains(.dark))
      #expect(tracker.textFieldConfigurations.map(\.variant).contains(.longText))
    }
  }

  @Test(arguments: ["shortText", "longText", "number", "obscured"])
  func builtInTextFieldStyleRendersEveryVariant(variant: String) {
    let node = Node(
      id: "tf_\(variant)",
      type: "TextField",
      properties: [
        "label": "Field",
        "variant": variant,
        "checks": [failingCheck("Required")],
      ]
    )

    let window = host(A2UITextField(node: node).a2uiTextFieldStyle(.automatic))
    defer { window.close() }
    withExtendedLifetime(window) {}
  }
}
