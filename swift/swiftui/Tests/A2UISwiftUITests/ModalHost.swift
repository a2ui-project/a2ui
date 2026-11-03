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

#if canImport(AppKit)
  import A2UICore
  import A2UISwiftUI
  import AppKit
  import BasicCatalogSwiftUI
  import SwiftUI
  import Testing

  /// Hosts a basic catalog `Modal` in a window so tests can activate its trigger the way a
  /// pointer, the keyboard, or an assistive technology does, and see whether the sheet opens.
  @MainActor
  struct ModalHost {
    let window: NSWindow
    let hostingView: NSView

    init(trigger: Node) throws {
      let catalog = BasicCatalogImplementation.makeCatalog(version: .v091)
      let content = Node(id: "modal_body", type: "Text", properties: ["text": "Details"])
      let modal = Node(
        id: "modal",
        type: "Modal",
        catalogID: catalog.id,
        properties: ["trigger": trigger, "content": content]
      )
      let rendered = try #require(Surface.render(node: modal, using: [catalog.id: catalog]))
      let rootView =
        rendered
        .frame(width: 320, height: 240)
        .environment(\.a2uiCatalogs, [catalog.id: catalog])
        .environment(\.a2uiDefaultCatalogID, catalog.id)

      // SwiftUI builds its accessibility tree only once an assistive client asks for it.
      NSApplication.shared.accessibilitySetValue(
        true,
        forAttribute: NSAccessibility.Attribute(rawValue: "AXEnhancedUserInterface")
      )
      hostingView = NSHostingView(rootView: rootView)
      window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 320, height: 240),
        styleMask: [.titled],
        backing: .buffered,
        defer: false
      )
      window.isReleasedWhenClosed = false
      window.contentView = hostingView
      window.makeKeyAndOrderFront(nil)
      settle()
    }

    /// Whether the Modal's sheet is showing.
    var isSheetPresented: Bool {
      window.attachedSheet != nil
    }

    /// Runs the main run loop briefly so SwiftUI applies pending updates.
    func settle() {
      for _ in 0..<5 {
        RunLoop.main.run(until: Date().addingTimeInterval(0.05))
        hostingView.layoutSubtreeIfNeeded()
      }
    }

    /// Performs the accessibility press action, as VoiceOver does on a double tap, on the element
    /// with the given label. Returns whether the element handled it.
    @discardableResult
    func pressWithVoiceOver(label: String) throws -> Bool {
      let target = try #require(element(label: label))
      let handled = target.accessibilityPerformPress?() ?? false
      settle()
      return handled
    }

    /// Focuses the element with the given label and presses the space bar, as Full Keyboard
    /// Access does to activate a control.
    func pressSpace(label: String) throws {
      let target = try #require(element(label: label))
      target.setAccessibilityFocused?(true)
      settle()
      for type in [NSEvent.EventType.keyDown, .keyUp] {
        let event = try #require(
          NSEvent.keyEvent(
            with: type,
            location: .zero,
            modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: window.windowNumber,
            context: nil,
            characters: " ",
            charactersIgnoringModifiers: " ",
            isARepeat: false,
            keyCode: 49
          )
        )
        window.sendEvent(event)
      }
      settle()
    }

    /// Clicks the centre of the element with the given label.
    func click(label: String) throws {
      let target = try #require(element(label: label))
      let screenFrame = try #require(target.accessibilityFrame?())
      let windowPoint = window.convertPoint(
        fromScreen: NSPoint(x: screenFrame.midX, y: screenFrame.midY))
      try click(windowPoint)
    }

    private func click(_ windowPoint: NSPoint) throws {
      for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
        let event = try #require(
          NSEvent.mouseEvent(
            with: type,
            location: windowPoint,
            modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: window.windowNumber,
            context: nil,
            eventNumber: 0,
            clickCount: 1,
            pressure: type == .leftMouseDown ? 1 : 0
          )
        )
        window.sendEvent(event)
      }
      settle()
    }

    private func element(label: String) -> AnyObject? {
      firstElement(in: hostingView) { $0.accessibilityLabel?() == label }
    }

    private func firstElement(
      in root: AnyObject,
      where matches: (AnyObject) -> Bool
    ) -> AnyObject? {
      for child in root.accessibilityChildren?() ?? [] {
        let child = child as AnyObject
        if matches(child) {
          return child
        }
        if let found = firstElement(in: child, where: matches) {
          return found
        }
      }
      return nil
    }
  }
#endif
