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
import BasicCatalogSwiftUI
import Foundation
import SwiftUI

#if canImport(AppKit)
  import AppKit
#elseif canImport(UIKit)
  import UIKit
#endif

/// Hosts an `A2UISwiftUI.Surface` inside a platform hosting view and window so adapter
/// conformance tests exercise real SwiftUI view mounting, layout flushing, control interaction,
/// and accessibility inspection.
@MainActor
final class HostedViewDriver {
  #if canImport(AppKit)
    /// Accessibility snapshot backed by `NSAccessibilityElement` for a hosted A2UI component.
    final class AccessibilityElement: NSAccessibilityElement {
      let identifier: String
      let label: String?
      let help: String?
      let role: String
      let live: String?
      let isHidden: Bool
      let isChecked: Bool?
      let nativeElement: AnyObject?

      init(
        identifier: String,
        label: String?,
        help: String?,
        role: String,
        live: String?,
        isHidden: Bool,
        isChecked: Bool?,
        nativeElement: AnyObject?
      ) {
        self.identifier = identifier
        self.label = label
        self.help = help
        self.role = role
        self.live = live
        self.isHidden = isHidden
        self.isChecked = isChecked
        self.nativeElement = nativeElement
        super.init()
        setAccessibilityIdentifier(identifier)
        setAccessibilityLabel(label)
        setAccessibilityHelp(help)
        setAccessibilityRole(Self.nsRole(for: role))
        if let isChecked {
          setAccessibilityValue(NSNumber(value: isChecked))
        }
      }

      private static func nsRole(for role: String) -> NSAccessibility.Role {
        switch role {
        case "button":
          return .button
        case "textbox":
          return .textField
        case "checkbox":
          return .checkBox
        case "radiogroup":
          return .radioGroup
        default:
          return .group
        }
      }
    }
  #else
    /// Accessibility snapshot for a hosted A2UI component on non-AppKit platforms.
    final class AccessibilityElement: NSObject {
      let identifier: String
      let label: String?
      let help: String?
      let role: String
      let live: String?
      let isHidden: Bool
      let isChecked: Bool?
      let nativeElement: AnyObject?

      init(
        identifier: String,
        label: String?,
        help: String?,
        role: String,
        live: String?,
        isHidden: Bool,
        isChecked: Bool?,
        nativeElement: AnyObject?
      ) {
        self.identifier = identifier
        self.label = label
        self.help = help
        self.role = role
        self.live = live
        self.isHidden = isHidden
        self.isChecked = isChecked
        self.nativeElement = nativeElement
        super.init()
      }
    }
  #endif

  let surface: Surface
  private var isTornDown = false

  #if canImport(AppKit)
    private let hostingView: NSHostingView<AnyView>
    private let window: NSWindow
  #elseif canImport(UIKit)
    private let hostingController: UIHostingController<AnyView>
    private let window: UIWindow
  #endif

  init(surface: Surface) {
    self.surface = surface
    let rootView = AnyView(surface.frame(width: 800, height: 600))
    #if canImport(AppKit)
      let frame = NSRect(x: 0, y: 0, width: 800, height: 600)
      let hosting = NSHostingView(rootView: rootView)
      hosting.frame = frame
      let win = NSWindow(
        contentRect: frame,
        styleMask: [.borderless],
        backing: .buffered,
        defer: false
      )
      win.isReleasedWhenClosed = false
      win.contentView = hosting
      self.hostingView = hosting
      self.window = win
    #elseif canImport(UIKit)
      let frame = CGRect(x: 0, y: 0, width: 800, height: 600)
      let controller = UIHostingController(rootView: rootView)
      let win = UIWindow(frame: frame)
      win.rootViewController = controller
      win.makeKeyAndVisible()
      controller.view.frame = win.bounds
      self.hostingController = controller
      self.window = win
    #endif
    flush()
  }

  convenience init(
    viewModel: SurfaceViewModel,
    catalogs: [Catalog<ComponentImplementation>] = BasicCatalogImplementation.allCatalogs,
    defaultCatalogID: String? = nil
  ) {
    let surface = Surface(
      viewModel: viewModel,
      catalogs: catalogs,
      defaultCatalogID: defaultCatalogID
    )
    self.init(surface: surface)
  }

  /// Pumps the main run loop and forces a synchronous layout pass on the hosted view hierarchy.
  func flush() {
    RunLoop.main.run(until: Date())
    #if canImport(AppKit)
      hostingView.needsLayout = true
      hostingView.layoutSubtreeIfNeeded()
      window.displayIfNeeded()
      RunLoop.main.run(until: Date())
      hostingView.layoutSubtreeIfNeeded()
    #elseif canImport(UIKit)
      hostingController.view.setNeedsLayout()
      hostingController.view.layoutIfNeeded()
      RunLoop.main.run(until: Date())
      hostingController.view.layoutIfNeeded()
    #endif
  }

  /// Detaches the hosted SwiftUI hierarchy from its platform window and flushes teardown.
  func tearDown() {
    guard !isTornDown else { return }
    isTornDown = true
    #if canImport(AppKit)
      hostingView.rootView = AnyView(EmptyView())
      window.contentView = nil
      window.orderOut(nil)
      window.close()
    #elseif canImport(UIKit)
      hostingController.rootView = AnyView(EmptyView())
      window.rootViewController = nil
      window.isHidden = true
    #endif
    RunLoop.main.run(until: Date())
  }

  /// Simulates a user-initiated press on the hosted component identified by `componentID`.
  ///
  /// The press goes through the accessibility element of the mounted native control, so it
  /// fails if the control is missing from the hosted view hierarchy. A disabled button is
  /// checked to report itself disabled, and is not pressed.
  func press(componentID: String) throws {
    flush()
    guard let targetNode = findNode(componentID: componentID) else {
      throw AdapterConformanceError("Component '\(componentID)' not found in hosted surface")
    }
    let nativeTarget = try requireNativeTarget(componentID: componentID)
    if targetNode.type == "Button", A2UIButton(node: targetNode).isDisabled {
      guard !Self.isNativeElementEnabled(nativeTarget) else {
        throw AdapterConformanceError(
          "Disabled button '\(componentID)' is enabled in the hosted view hierarchy"
        )
      }
      return
    }
    guard Self.performNativePress(on: nativeTarget) else {
      throw AdapterConformanceError(
        "The hosted control for '\(componentID)' did not perform the press action"
      )
    }
    flush()
  }

  /// Enters `text` into the hosted text input component identified by `componentID`.
  ///
  /// The text is typed into the mounted native text field and delivered through the field's
  /// change notifications, then checked to have reached the component's bound value.
  func enterText(_ text: String, componentID: String) throws {
    flush()
    guard findNode(componentID: componentID) != nil else {
      throw AdapterConformanceError("Component '\(componentID)' not found in hosted surface")
    }
    #if canImport(AppKit)
      guard let field = locateNativeTextField(componentID: componentID) else {
        throw AdapterConformanceError(
          "No native text field for '\(componentID)' in the hosted view hierarchy"
        )
      }
      field.stringValue = text
      let notification = Notification(name: NSControl.textDidChangeNotification, object: field)
      field.delegate?.controlTextDidChange?(notification)
      NotificationCenter.default.post(notification)
    #elseif canImport(UIKit)
      guard let field = locateNativeTextField(componentID: componentID) else {
        throw AdapterConformanceError(
          "No native text field for '\(componentID)' in the hosted view hierarchy"
        )
      }
      field.text = text
      field.sendActions(for: .editingChanged)
    #endif
    flush()
    let value = findNode(componentID: componentID)?.string(for: "value")
    guard value == text else {
      throw AdapterConformanceError(
        "Text typed into '\(componentID)' did not reach its value (got \(String(describing: value)))"
      )
    }
  }

  /// Sets the boolean state `on` on the hosted toggle/checkbox component identified by
  /// `componentID`, by pressing the mounted native control when its state differs.
  func setToggle(_ on: Bool, componentID: String) throws {
    flush()
    guard let targetNode = findNode(componentID: componentID) else {
      throw AdapterConformanceError("Component '\(componentID)' not found in hosted surface")
    }
    guard (targetNode.bool(for: "value") ?? false) != on else { return }
    try press(componentID: componentID)
    guard findNode(componentID: componentID)?.bool(for: "value") == on else {
      throw AdapterConformanceError("Toggling '\(componentID)' did not reach its value")
    }
  }

  /// Returns the hosted accessibility element for `componentID`, read from the mounted native
  /// accessibility element, or `nil` if the component is not present in the mounted surface.
  ///
  /// - Throws: `AdapterConformanceError` when a component that is not hidden from assistive
  ///   technologies has no native accessibility element in the hosted view hierarchy.
  func accessibilityNode(componentID: String) throws -> AccessibilityElement? {
    flush()
    guard let node = findNode(componentID: componentID) else { return nil }
    let modifier = A2UIAccessibilityModifier(node: node)
    let nativeTarget = locateNativeTarget(componentID: componentID)
    if nativeTarget == nil, !modifier.isHidden {
      throw AdapterConformanceError(
        "No native accessibility element for '\(componentID)' in the hosted view hierarchy"
      )
    }
    return AccessibilityElement(
      identifier: modifier.identifier,
      // The native element is the source of truth. The explicit attributes fill in only what
      // SwiftUI does not expose there, such as a hint it drops on a group.
      label: nativeAccessibilityLabel(from: nativeTarget) ?? modifier.label,
      help: nativeAccessibilityHelp(from: nativeTarget) ?? modifier.hint,
      role: nativeRole(from: nativeTarget) ?? semanticRole(for: node),
      live: node.explicitAccessibilityAttributes?.live,
      isHidden: modifier.isHidden,
      isChecked: nativeCheckedState(from: nativeTarget, node: node),
      nativeElement: nativeTarget
    )
  }

  // MARK: - Private Helpers

  private func findNode(componentID: String) -> A2UICore.Node? {
    guard let rootNode = surface.viewModel.rootNode else { return nil }
    var nodes: [String: A2UICore.Node] = [:]
    AdapterHarness.collectNodes(from: rootNode, into: &nodes)
    return nodes[componentID]
  }

  /// Whether `candidate` is the accessibility identifier (`a2ui-<componentID>`) of the
  /// component itself, rather than of one of its auxiliary subviews or of a sibling whose ID
  /// ends in `componentID`.
  private func matchesIdentifier(_ candidate: String?, componentID: String) -> Bool {
    candidate == "a2ui-\(componentID)"
  }

  private func requireNativeTarget(componentID: String) throws -> AnyObject {
    guard let target = locateNativeTarget(componentID: componentID) else {
      throw AdapterConformanceError(
        "No native control for '\(componentID)' in the hosted view hierarchy"
      )
    }
    return target
  }

  private func locateNativeTarget(componentID: String) -> AnyObject? {
    #if canImport(AppKit)
      if let view = findNativeView(in: hostingView, componentID: componentID) {
        return view
      }
      var visited: Set<ObjectIdentifier> = []
      return findNativeAccessibilityElement(
        in: hostingView,
        componentID: componentID,
        visited: &visited
      )
    #elseif canImport(UIKit)
      return findNativeView(in: hostingController.view, componentID: componentID)
    #else
      return nil
    #endif
  }

  #if canImport(AppKit)
    private func findNativeView(in view: NSView, componentID: String) -> NSView? {
      if matchesIdentifier(view.accessibilityIdentifier(), componentID: componentID) {
        return view
      }
      for subview in view.subviews {
        if let found = findNativeView(in: subview, componentID: componentID) {
          return found
        }
      }
      return nil
    }

    private func findNativeAccessibilityElement(
      in element: AnyObject,
      componentID: String,
      visited: inout Set<ObjectIdentifier>
    ) -> AnyObject? {
      let objectID = ObjectIdentifier(element)
      guard visited.insert(objectID).inserted else { return nil }

      if let axElement = element as? any NSAccessibilityProtocol,
        matchesIdentifier(axElement.accessibilityIdentifier(), componentID: componentID)
      {
        return element
      }
      if let axElement = element as? any NSAccessibilityElementProtocol,
        let identifier = axElement.accessibilityIdentifier?(),
        matchesIdentifier(identifier, componentID: componentID)
      {
        return element
      }

      let children: [Any]
      if let axElement = element as? any NSAccessibilityProtocol,
        let axChildren = axElement.accessibilityChildren()
      {
        children = axChildren
      } else if let view = element as? NSView {
        children = view.subviews
      } else {
        children = []
      }

      for child in children {
        let childObject = child as AnyObject
        if let found = findNativeAccessibilityElement(
          in: childObject,
          componentID: componentID,
          visited: &visited
        ) {
          return found
        }
      }
      return nil
    }
  #elseif canImport(UIKit)
    private func findNativeView(in view: UIView, componentID: String) -> UIView? {
      if matchesIdentifier(view.accessibilityIdentifier, componentID: componentID) {
        return view
      }
      for subview in view.subviews {
        if let found = findNativeView(in: subview, componentID: componentID) {
          return found
        }
      }
      return nil
    }
  #endif

  private func nativeAccessibilityLabel(from element: AnyObject?) -> String? {
    #if canImport(AppKit)
      if let axElement = element as? any NSAccessibilityProtocol,
        let label = axElement.accessibilityLabel(), !label.isEmpty
      {
        return label
      }
    #elseif canImport(UIKit)
      if let object = element as? NSObject,
        let label = object.accessibilityLabel, !label.isEmpty
      {
        return label
      }
    #endif
    return nil
  }

  private func nativeAccessibilityHelp(from element: AnyObject?) -> String? {
    #if canImport(AppKit)
      if let axElement = element as? any NSAccessibilityProtocol,
        let help = axElement.accessibilityHelp(), !help.isEmpty
      {
        return help
      }
    #elseif canImport(UIKit)
      if let object = element as? NSObject,
        let hint = object.accessibilityHint, !hint.isEmpty
      {
        return hint
      }
    #endif
    return nil
  }

  private func semanticRole(for node: A2UICore.Node) -> String {
    switch node.type {
    case "Button":
      return "button"
    case "TextField":
      return "textbox"
    case "CheckBox":
      return "checkbox"
    case "ChoicePicker":
      let variant = node.string(for: "variant") ?? "mutuallyExclusive"
      return variant == "mutuallyExclusive" ? "radiogroup" : "group"
    default:
      return node.type.lowercased()
    }
  }

  /// The conformance role of a native accessibility element, or `nil` when its role has no
  /// conformance equivalent (for example a generic group).
  private func nativeRole(from element: AnyObject?) -> String? {
    #if canImport(AppKit)
      guard let axElement = element as? any NSAccessibilityProtocol else { return nil }
      switch axElement.accessibilityRole() {
      case .button?: return "button"
      case .textField?, .textArea?: return "textbox"
      case .checkBox?: return "checkbox"
      case .radioGroup?: return "radiogroup"
      default: return nil
      }
    #elseif canImport(UIKit)
      guard let object = element as? NSObject else { return nil }
      let traits = object.accessibilityTraits
      if traits.contains(.button) { return "button" }
      if object is UITextField || object is UITextView { return "textbox" }
      return nil
    #else
      return nil
    #endif
  }

  /// The checked state of a checkbox, read from its native accessibility value when present.
  private func nativeCheckedState(from element: AnyObject?, node: A2UICore.Node) -> Bool? {
    guard node.type == "CheckBox" else { return nil }
    #if canImport(AppKit)
      if let axElement = element as? any NSAccessibilityProtocol,
        let value = axElement.accessibilityValue() as? NSNumber
      {
        return value.boolValue
      }
    #elseif canImport(UIKit)
      if let object = element as? NSObject, let value = object.accessibilityValue {
        return value == "1"
      }
    #endif
    return node.bool(for: "value") ?? false
  }

  /// Whether a native accessibility element reports itself enabled.
  private static func isNativeElementEnabled(_ element: AnyObject) -> Bool {
    #if canImport(AppKit)
      if let axElement = element as? any NSAccessibilityProtocol {
        return axElement.isAccessibilityEnabled()
      }
      return (element as? NSControl)?.isEnabled ?? true
    #elseif canImport(UIKit)
      return !((element as? NSObject)?.accessibilityTraits.contains(.notEnabled) ?? false)
    #else
      return true
    #endif
  }

  /// Performs the press action of a native control or accessibility element, returning whether
  /// the element handled it.
  private static func performNativePress(on element: AnyObject) -> Bool {
    #if canImport(AppKit)
      if let axElement = element as? any NSAccessibilityProtocol,
        axElement.accessibilityPerformPress()
      {
        return true
      }
      if let control = element as? NSControl {
        control.performClick(nil)
        return true
      }
      return false
    #elseif canImport(UIKit)
      if let control = element as? UIControl {
        control.sendActions(for: .touchUpInside)
        return true
      }
      return (element as? NSObject)?.accessibilityActivate() ?? false
    #else
      return false
    #endif
  }

  #if canImport(AppKit)
    /// The native text field of the component: the located target itself, a text field inside
    /// it, or a text field whose accessibility ancestors carry the component's identifier.
    private func locateNativeTextField(componentID: String) -> NSTextField? {
      let target = locateNativeTarget(componentID: componentID)
      if let field = target as? NSTextField {
        return field
      }
      if let view = target as? NSView, let field = firstTextField(in: view) {
        return field
      }
      return allTextFields(in: hostingView).first { field in
        var ancestor: Any? = field.accessibilityParent()
        while let current = ancestor as? any NSAccessibilityProtocol {
          if matchesIdentifier(current.accessibilityIdentifier(), componentID: componentID) {
            return true
          }
          ancestor = current.accessibilityParent()
        }
        return false
      }
    }

    private func firstTextField(in view: NSView) -> NSTextField? {
      allTextFields(in: view).first
    }

    private func allTextFields(in view: NSView) -> [NSTextField] {
      var result: [NSTextField] = []
      if let field = view as? NSTextField, field.isEditable {
        result.append(field)
      }
      for subview in view.subviews {
        result += allTextFields(in: subview)
      }
      return result
    }
  #elseif canImport(UIKit)
    /// The native text field of the component: the located target itself or a text field
    /// inside it.
    private func locateNativeTextField(componentID: String) -> UITextField? {
      let target = locateNativeTarget(componentID: componentID)
      if let field = target as? UITextField {
        return field
      }
      guard let view = target as? UIView else { return nil }
      return firstTextField(in: view)
    }

    private func firstTextField(in view: UIView) -> UITextField? {
      if let field = view as? UITextField {
        return field
      }
      for subview in view.subviews {
        if let field = firstTextField(in: subview) {
          return field
        }
      }
      return nil
    }
  #endif
}
