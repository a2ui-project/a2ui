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

  private struct ResolvedTabEntry {
    let index: Int
    let title: String
    let child: A2UICore.Node?
  }

  let surface: Surface
  private var isTornDown = false

  #if canImport(AppKit)
    private static let enhancedUserInterfaceKey = "accessibilityEnhancedUserInterface"
    private let hostingView: NSHostingView<AnyView>
    private let window: NSWindow
  #elseif canImport(UIKit)
    private let hostingController: UIHostingController<AnyView>
    private let window: UIWindow
    private var fallbackSelectedTabIndices: [String: Int] = [:]
    private var fallbackOpenModalIDs: Set<String> = []
  #else
    private var fallbackSelectedTabIndices: [String: Int] = [:]
    private var fallbackOpenModalIDs: Set<String> = []
  #endif

  init(surface: Surface) {
    self.surface = surface
    let rootView = AnyView(surface.frame(width: 800, height: 600))
    #if canImport(AppKit)
      let frame = NSRect(x: 0, y: 0, width: 800, height: 600)
      let hosting = NSHostingView(rootView: rootView)
      hosting.frame = frame
      let hostWindow = NSWindow(
        contentRect: frame,
        styleMask: [.borderless],
        backing: .buffered,
        defer: false
      )
      hostWindow.isReleasedWhenClosed = false
      hostWindow.contentView = hosting
      hostWindow.makeKeyAndOrderFront(nil)
      self.hostingView = hosting
      self.window = hostWindow
    #elseif canImport(UIKit)
      let frame = CGRect(x: 0, y: 0, width: 800, height: 600)
      let controller = UIHostingController(rootView: rootView)
      let hostWindow = UIWindow(frame: frame)
      hostWindow.rootViewController = controller
      hostWindow.makeKeyAndVisible()
      controller.view.frame = hostWindow.bounds
      self.hostingController = controller
      self.window = hostWindow
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
      if let sheetView = window.attachedSheet?.contentView {
        sheetView.needsLayout = true
        sheetView.layoutSubtreeIfNeeded()
        window.attachedSheet?.displayIfNeeded()
      }
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
      if let sheet = window.attachedSheet {
        window.endSheet(sheet)
      }
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
  /// On AppKit, activates the rendered SwiftUI control through its accessibility press action so
  /// hosted `A2UIButton` and `A2UIModal` triggers run their real view actions and sheet bindings;
  /// falls back to invoking the resolved node's action when the component has no pressable
  /// accessibility element.
  func press(componentID: String) throws {
    flush()
    guard let targetNode = findNode(componentID: componentID) else {
      throw AdapterHarness.ConformanceError(
        "Component '\(componentID)' not found in hosted surface"
      )
    }
    if targetNode.type == "CheckBox" {
      A2UICheckBox(node: targetNode).isOn.wrappedValue.toggle()
      flush()
      return
    }
    if targetNode.type == "Button" {
      guard !A2UIButton(node: targetNode).isDisabled else { return }
    } else {
      guard targetNode.isValid else { return }
    }

    #if canImport(AppKit)
      let pressTargetNode =
        targetNode.type == "Modal"
        ? (targetNode.child(for: "trigger") ?? targetNode)
        : targetNode
      let handledByHostedControl = withAccessibilityTree {
        guard let element = findPressableElement(for: pressTargetNode) else {
          return false
        }
        let handled = element.accessibilityPerformPress?() ?? false
        if handled {
          settleHostedHierarchy()
        }
        return handled
      }
      if !handledByHostedControl {
        targetNode.action(for: "action", userActivation: true)?()
        flush()
      }
    #else
      targetNode.action(for: "action", userActivation: true)?()
      if let rootNode = surface.viewModel.rootNode {
        fallbackOpenModalIDs.formUnion(
          AdapterHarness.modalIDsTriggered(by: componentID, in: rootNode)
        )
      }
      flush()
    #endif
  }

  /// Selects the tab at `index` on the hosted `Tabs` component identified by `componentID`.
  func selectTab(index: Int, componentID: String) throws {
    flush()
    guard let tabsNode = findNode(componentID: componentID), tabsNode.type == "Tabs" else {
      throw AdapterHarness.ConformanceError(
        "Tabs component '\(componentID)' not found in hosted surface"
      )
    }
    let tabEntries = resolvedTabs(for: tabsNode)
    guard index >= 0, index < tabEntries.count else {
      throw AdapterHarness.ConformanceError(
        "Tab index \(index) out of bounds for '\(componentID)'"
      )
    }
    #if canImport(AppKit)
      try withAccessibilityTree {
        let tabIdentifier = "a2ui-\(componentID)-tab-\(index)"
        let tabTitle = tabEntries[index].title
        let roots = activeHostedRoots()
        let tabButton =
          firstAccessibilityElement(in: roots) {
            Self.elementIdentifier($0) == tabIdentifier
              && Self.respondsToAccessibilityPress($0)
          }
          ?? firstAccessibilityElement(in: roots) {
            Self.element($0, hasText: tabTitle)
              && Self.respondsToAccessibilityPress($0)
          }
        guard let tabButton else {
          throw AdapterHarness.ConformanceError(
            "Hosted tab button \(index) ('\(tabTitle)') for '\(componentID)' not found"
          )
        }
        let handled = tabButton.accessibilityPerformPress?() ?? false
        guard handled else {
          throw AdapterHarness.ConformanceError(
            "Hosted tab button \(index) ('\(tabTitle)') for '\(componentID)' did not handle press"
          )
        }
        settleHostedHierarchy()
      }
    #else
      fallbackSelectedTabIndices[componentID] = index
      flush()
    #endif
  }

  /// Returns the selected tab index for the hosted `Tabs` component identified by `componentID`.
  func selectedTabIndex(for componentID: String) -> Int {
    guard let tabsNode = findNode(componentID: componentID), tabsNode.type == "Tabs" else {
      return 0
    }
    let tabEntries = resolvedTabs(for: tabsNode)
    guard !tabEntries.isEmpty else { return 0 }
    #if canImport(AppKit)
      return withAccessibilityTree {
        let roots = activeHostedRoots()
        for entry in tabEntries {
          if let childNode = entry.child, isSubtreeMounted(childNode, in: roots) {
            return entry.index
          }
        }
        for entry in tabEntries {
          let tabIdentifier = "a2ui-\(componentID)-tab-\(entry.index)"
          if let button = firstAccessibilityElement(
            in: roots,
            where: { Self.elementIdentifier($0) == tabIdentifier }
          ),
            Self.isElementSelected(button)
          {
            return entry.index
          }
        }
        return 0
      }
    #else
      return fallbackSelectedTabIndices[componentID] ?? 0
    #endif
  }

  /// Returns whether the `Modal` component identified by `componentID` is currently presented.
  func isModalOpen(_ componentID: String) -> Bool {
    guard let modalNode = findNode(componentID: componentID), modalNode.type == "Modal" else {
      return false
    }
    #if canImport(AppKit)
      guard let sheetView = window.attachedSheet?.contentView else {
        return false
      }
      guard let contentNode = modalNode.child(for: "content") else {
        return true
      }
      return withAccessibilityTree {
        isSubtreeMounted(contentNode, in: [sheetView])
      }
    #else
      return fallbackOpenModalIDs.contains(componentID)
    #endif
  }

  /// Enters `text` into the hosted text input component identified by `componentID`.
  ///
  /// The text is typed into the mounted native text field and delivered through the field's
  /// change notifications, then checked to have reached the component's bound value.
  func enterText(_ text: String, componentID: String) throws {
    flush()
    guard let targetNode = findNode(componentID: componentID) else {
      throw AdapterHarness.ConformanceError(
        "Component '\(componentID)' not found in hosted surface"
      )
    }
    #if canImport(AppKit)
      guard let field = locateNativeTextField(for: targetNode) else {
        throw AdapterHarness.ConformanceError(
          "No native text field for '\(componentID)' in the hosted view hierarchy"
        )
      }
      field.stringValue = text
      let notification = Notification(name: NSControl.textDidChangeNotification, object: field)
      field.delegate?.controlTextDidChange?(notification)
      NotificationCenter.default.post(notification)
    #elseif canImport(UIKit)
      guard let field = locateNativeTextField(for: targetNode) else {
        throw AdapterHarness.ConformanceError(
          "No native text field for '\(componentID)' in the hosted view hierarchy"
        )
      }
      field.text = text
      field.sendActions(for: .editingChanged)
    #endif
    flush()
    let value = findNode(componentID: componentID)?.string(for: "value")
    guard value == text else {
      let actualDescription = String(describing: value)
      throw AdapterHarness.ConformanceError(
        "Text typed into '\(componentID)' did not reach its value (got \(actualDescription))"
      )
    }
  }

  /// Sets the boolean state `on` on the hosted toggle/checkbox component identified by
  /// `componentID`, through the mounted node's binding.
  func setToggle(_ on: Bool, componentID: String) throws {
    flush()
    guard let targetNode = findNode(componentID: componentID) else {
      throw AdapterHarness.ConformanceError(
        "Component '\(componentID)' not found in hosted surface"
      )
    }
    let checkBox = A2UICheckBox(node: targetNode)
    if checkBox.isOn.wrappedValue != on {
      checkBox.isOn.wrappedValue = on
      flush()
    }
  }

  /// Selects `values` on the hosted `ChoicePicker` component identified by `componentID`.
  func selectChoices(_ values: [String], componentID: String) throws {
    flush()
    guard let targetNode = findNode(componentID: componentID) else {
      throw AdapterHarness.ConformanceError(
        "Component '\(componentID)' not found in hosted surface"
      )
    }
    let picker = A2UIChoicePicker(node: targetNode)
    for value in values {
      picker.selectionBinding(forOptionValue: value).wrappedValue = true
    }
    flush()
  }

  /// Sets the numeric `value` on the hosted `Slider` component identified by `componentID`.
  func setSliderValue(_ value: Double, componentID: String) throws {
    flush()
    guard let targetNode = findNode(componentID: componentID) else {
      throw AdapterHarness.ConformanceError(
        "Component '\(componentID)' not found in hosted surface"
      )
    }
    targetNode.binding(for: "value", default: 0.0).wrappedValue = value
    flush()
  }

  /// Sets the ISO date/time string `value` on the hosted `DateTimeInput` component identified by
  /// `componentID`.
  func setDateTime(_ value: String, componentID: String) throws {
    flush()
    guard let targetNode = findNode(componentID: componentID) else {
      throw AdapterHarness.ConformanceError(
        "Component '\(componentID)' not found in hosted surface"
      )
    }
    if let parsed = DateTimeInputValue(parsing: value) {
      let enableDate = targetNode.bool(for: "enableDate") ?? false
      let enableTime = targetNode.bool(for: "enableTime") ?? false
      let formatted = DateTimeInputValue.format(
        parsed.date,
        enableDate: enableDate,
        enableTime: enableTime,
        like: targetNode.string(for: "value")
      )
      (targetNode.dataBinding(for: "value") as DataBinding<String>?)?.set(formatted)
    } else {
      (targetNode.dataBinding(for: "value") as DataBinding<String>?)?.set(value)
    }
    flush()
  }

  /// Returns the accessibility element for `componentID` in the mounted surface, or `nil` if the
  /// component is not present.
  ///
  /// A native element with the component's `a2ui-<id>` identifier is used when the hierarchy has
  /// one; otherwise the values come from the mounted node and `A2UIAccessibilityModifier`.
  func accessibilityNode(componentID: String) -> AccessibilityElement? {
    flush()
    guard let node = findNode(componentID: componentID) else { return nil }
    let modifier = A2UIAccessibilityModifier(node: node)
    let nativeTarget =
      locateNativeTarget(componentID: node.id) ?? locateNativeTarget(componentID: componentID)
    return AccessibilityElement(
      identifier: modifier.identifier,
      label: nativeAccessibilityLabel(from: nativeTarget) ?? effectiveLabel(for: node, modifier),
      help: nativeAccessibilityHelp(from: nativeTarget) ?? modifier.hint,
      role: semanticRole(for: node),
      live: node.explicitAccessibilityAttributes?.live,
      isHidden: modifier.isHidden,
      isChecked: checkedState(for: node),
      nativeElement: nativeTarget
    )
  }

  // MARK: - Private Helpers

  private func findNode(componentID: String) -> A2UICore.Node? {
    guard let rootNode = surface.viewModel.rootNode else { return nil }
    var nodes: [String: A2UICore.Node] = [:]
    AdapterHarness.collectNodes(from: rootNode, in: surface, into: &nodes)
    return nodes[componentID]
  }

  private func resolvedTabs(for node: A2UICore.Node) -> [ResolvedTabEntry] {
    if let array = node.array(for: "tabs") {
      return array.enumerated().map { index, element in
        let dictionary = element as? ResolvedDictionary
        let title =
          (dictionary?["title"] as? String)
          ?? (dictionary?["title"] as? DataBinding<String>)?.value
          ?? "Tab \(index + 1)"
        let child =
          (dictionary?["child"] as? A2UICore.Node)
          ?? node.allChildNodes.first { $0.id == (dictionary?["child"] as? String ?? "") }
        return ResolvedTabEntry(index: index, title: title, child: child)
      }
    }
    if let json = node.jsonValue(for: "tabs"), let array = json.arrayValue {
      return array.enumerated().map { index, item in
        let title = item["title"]?.stringValue ?? "Tab \(index + 1)"
        let childID = item["child"]?.stringValue ?? ""
        let child = node.allChildNodes.first { $0.id == childID }
        return ResolvedTabEntry(index: index, title: title, child: child)
      }
    }
    return []
  }

  /// Whether `candidate` is the accessibility identifier (`a2ui-<componentID>`) of the
  /// component itself, rather than of one of its auxiliary subviews or of a sibling whose ID
  /// ends in `componentID`.
  private func matchesIdentifier(_ candidate: String?, componentID: String) -> Bool {
    candidate == "a2ui-\(componentID)"
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
    /// Whether the native accessibility tree has an element that shows `text` as its label or,
    /// as a static text does, as its value. Elements hidden from assistive technologies are not
    /// in the tree.
    func exposesAccessibilityElement(withText text: String) -> Bool {
      withAccessibilityTree {
        firstAccessibilityElement(in: activeHostedRoots()) { Self.element($0, hasText: text) }
          != nil
      }
    }

    /// Enables SwiftUI's accessibility hierarchy for the duration of `body`, restoring the prior
    /// process setting on exit so other tests in the runner observe no side effects.
    private func withAccessibilityTree<Result>(_ body: () throws -> Result) rethrows -> Result {
      let application = NSApplication.shared
      let wasEnhanced =
        (application.value(forKey: Self.enhancedUserInterfaceKey) as? Bool) ?? false
      application.setValue(true, forKey: Self.enhancedUserInterfaceKey)
      defer { application.setValue(wasEnhanced, forKey: Self.enhancedUserInterfaceKey) }
      settleHostedHierarchy()
      return try body()
    }

    private func settleHostedHierarchy() {
      for _ in 0..<5 {
        RunLoop.main.run(until: Date())
        hostingView.needsLayout = true
        hostingView.layoutSubtreeIfNeeded()
        window.displayIfNeeded()
        if let sheetView = window.attachedSheet?.contentView {
          sheetView.needsLayout = true
          sheetView.layoutSubtreeIfNeeded()
          window.attachedSheet?.displayIfNeeded()
        }
      }
    }

    private func activeHostedRoots() -> [NSView] {
      var roots: [NSView] = []
      if let sheetView = window.attachedSheet?.contentView {
        roots.append(sheetView)
      }
      roots.append(hostingView)
      return roots
    }

    private func findPressableElement(for node: A2UICore.Node) -> AnyObject? {
      let roots = activeHostedRoots()
      let expectedIdentifier = "a2ui-\(node.id)"
      if let byIdentifier = firstAccessibilityElement(
        in: roots,
        where: {
          Self.elementIdentifier($0) == expectedIdentifier
            && Self.respondsToAccessibilityPress($0)
        }
      ) {
        return byIdentifier
      }
      let modifier = A2UIAccessibilityModifier(node: node)
      if let label = effectiveLabel(for: node, modifier) ?? node.string(for: "text"),
        !label.isEmpty
      {
        return firstAccessibilityElement(
          in: roots,
          where: {
            Self.element($0, hasText: label) && Self.respondsToAccessibilityPress($0)
          }
        )
      }
      return nil
    }

    private func isSubtreeMounted(_ subtreeRoot: A2UICore.Node, in roots: [NSView]) -> Bool {
      var subtreeNodes: [String: A2UICore.Node] = [:]
      AdapterHarness.collectNodes(from: subtreeRoot, into: &subtreeNodes)
      let identifiers = Set(subtreeNodes.values.map { "a2ui-\($0.id)" })
      if firstAccessibilityElement(
        in: roots,
        where: { element in
          guard let identifier = Self.elementIdentifier(element) else { return false }
          return identifiers.contains(identifier)
        }
      ) != nil {
        return true
      }
      let texts = Set(
        subtreeNodes.values.compactMap { $0.string(for: "text") }.filter { !$0.isEmpty }
      )
      guard !texts.isEmpty else { return false }
      return firstAccessibilityElement(
        in: roots,
        where: { element in
          texts.contains { Self.element(element, hasText: $0) }
        }
      ) != nil
    }

    private func firstAccessibilityElement(
      in roots: [NSView],
      where matches: (AnyObject) -> Bool
    ) -> AnyObject? {
      var visited: Set<ObjectIdentifier> = []
      for root in roots {
        if let found = firstAccessibilityElement(
          in: root,
          visited: &visited,
          where: matches
        ) {
          return found
        }
      }
      return nil
    }

    private func firstAccessibilityElement(
      in root: AnyObject,
      visited: inout Set<ObjectIdentifier>,
      where matches: (AnyObject) -> Bool
    ) -> AnyObject? {
      let objectID = ObjectIdentifier(root)
      guard visited.count < 4000, visited.insert(objectID).inserted else { return nil }

      for child in root.accessibilityChildren?() ?? [] {
        let childObject = child as AnyObject
        if matches(childObject) {
          return childObject
        }
        if let found = firstAccessibilityElement(
          in: childObject,
          visited: &visited,
          where: matches
        ) {
          return found
        }
      }
      if let view = root as? NSView {
        for subview in view.subviews {
          if matches(subview) {
            return subview
          }
          if let found = firstAccessibilityElement(
            in: subview,
            visited: &visited,
            where: matches
          ) {
            return found
          }
        }
      }
      return nil
    }

    private static func elementIdentifier(_ element: AnyObject) -> String? {
      guard let object = element as? NSObject,
        object.responds(to: NSSelectorFromString("accessibilityIdentifier"))
      else { return nil }
      return object.value(forKey: "accessibilityIdentifier") as? String
    }

    private static func element(_ element: AnyObject, hasText text: String) -> Bool {
      if element.accessibilityLabel?() == text {
        return true
      }
      guard let object = element as? NSObject,
        object.responds(to: NSSelectorFromString("accessibilityValue"))
      else { return false }
      return object.value(forKey: "accessibilityValue") as? String == text
    }

    private static func respondsToAccessibilityPress(_ element: AnyObject) -> Bool {
      guard let object = element as? NSObject else { return false }
      return object.responds(to: NSSelectorFromString("accessibilityPerformPress"))
    }

    private static func isElementSelected(_ element: AnyObject) -> Bool {
      guard let object = element as? NSObject,
        object.responds(to: NSSelectorFromString("accessibilityValue"))
      else { return false }
      return (object.value(forKey: "accessibilityValue") as? NSNumber)?.boolValue == true
    }

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
      guard visited.count < 2000, visited.insert(objectID).inserted else { return nil }

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
      var children: [Any] =
        (element as? any NSAccessibilityProtocol)?.accessibilityChildren() ?? []
      if let view = element as? NSView {
        children += view.subviews
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

  private func effectiveLabel(
    for node: A2UICore.Node,
    _ modifier: A2UIAccessibilityModifier
  ) -> String? {
    if let explicit = modifier.label {
      return explicit
    }
    if let inferred = node.accessibilityAttributes?.label, !inferred.isEmpty {
      return inferred
    }
    if let child = node.child(for: "child") {
      return child.accessibilityAttributes?.label ?? child.string(for: "text")
    }
    return nil
  }

  private func checkedState(for node: A2UICore.Node) -> Bool? {
    guard node.type == "CheckBox" else { return nil }
    return node.bool(for: "value") ?? false
  }

  /// The texts a text field component shows as its label or placeholder, which SwiftUI passes on
  /// to the backing native field.
  private func fieldTexts(for node: A2UICore.Node) -> Set<String> {
    let texts = [
      node.string(for: "label"),
      node.string(for: "placeholder"),
      A2UIAccessibilityModifier(node: node).label,
    ]
    return Set(texts.compactMap { $0 }.filter { !$0.isEmpty })
  }

  #if canImport(AppKit)
    /// The editable native text field backing a text field component: the one whose
    /// placeholder or accessibility label is the component's label or placeholder, or the only
    /// editable field in the hosted view.
    private func locateNativeTextField(for node: A2UICore.Node) -> NSTextField? {
      let fields = allTextFields(in: hostingView)
      let texts = fieldTexts(for: node)
      if let match = fields.first(where: { field in
        [field.placeholderString, field.accessibilityLabel()].contains { text in
          text.map(texts.contains) ?? false
        }
      }) {
        return match
      }
      return fields.count == 1 ? fields.first : nil
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
    /// The native text field backing a text field component: the one whose placeholder or
    /// accessibility label is the component's label or placeholder, or the only text field in
    /// the hosted view.
    private func locateNativeTextField(for node: A2UICore.Node) -> UITextField? {
      let fields = allTextFields(in: hostingController.view)
      let texts = fieldTexts(for: node)
      if let match = fields.first(where: { field in
        [field.placeholder, field.accessibilityLabel].contains { text in
          text.map(texts.contains) ?? false
        }
      }) {
        return match
      }
      return fields.count == 1 ? fields.first : nil
    }

    private func allTextFields(in view: UIView) -> [UITextField] {
      var result: [UITextField] = []
      if let field = view as? UITextField {
        result.append(field)
      }
      for subview in view.subviews {
        result += allTextFields(in: subview)
      }
      return result
    }
  #endif
}
