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
import A2UIJSON
import A2UISwiftUI
import BasicCatalog
import BasicCatalogSwiftUI
import Combine
import JSONSchema
import OrderedJSON
import SwiftUI
import Testing

#if canImport(AppKit)
  import AppKit
#elseif canImport(UIKit)
  import UIKit
#endif

private final class RedrawCounter: Equatable, @unchecked Sendable {
  static func == (lhs: RedrawCounter, rhs: RedrawCounter) -> Bool {
    lhs === rhs
  }

  private(set) var counts: [String: Int] = [:]

  func record(_ id: String) {
    counts[id, default: 0] += 1
  }

  func count(for id: String) -> Int {
    counts[id, default: 0]
  }

  var totalComponentRedraws: Int {
    counts.reduce(0) { sum, pair in
      pair.key == "Surface" ? sum : sum + pair.value
    }
  }

  func reset() {
    counts.removeAll()
  }
}

@Suite(.serialized)
@MainActor
struct SurfaceRedrawTests {

  private func makeInstrumentedCatalog(
    counter: RedrawCounter
  ) -> Catalog<ComponentImplementation> {
    let baseCatalog = BasicCatalogImplementation.makeCatalog(version: .v091)
    let instrumentedComponents = baseCatalog.components.values.map { component in
      ComponentImplementation(api: component) { node in
        counter.record(node.id)
        return component.builder(node)
      }
    }
    return Catalog(
      id: baseCatalog.id,
      protocolVersion: .v091,
      components: instrumentedComponents,
      functions: Array(baseCatalog.functions.values),
      themeSchema: baseCatalog.themeSchema
    )
  }

  #if canImport(AppKit)
    private func flushLayout(in window: NSWindow, hostingView: NSView) {
      RunLoop.main.run(until: Date())
      hostingView.needsLayout = true
      hostingView.layoutSubtreeIfNeeded()
      window.displayIfNeeded()
      RunLoop.main.run(until: Date())
      hostingView.layoutSubtreeIfNeeded()
    }

  #elseif canImport(UIKit)
    private func flushLayout(in window: UIWindow, hostingView: UIView) {
      RunLoop.main.run(until: Date())
      hostingView.setNeedsLayout()
      hostingView.layoutIfNeeded()
      RunLoop.main.run(until: Date())
      hostingView.layoutIfNeeded()
    }
  #endif

  @Test func leafDataUpdateOnlyRedrawsTargetComponent() throws {
    let counter = RedrawCounter()
    let swiftUICatalog = makeInstrumentedCatalog(counter: counter)
    let coreCatalog = BasicCatalog.makeCatalog(version: .v091)

    let viewModel = SurfaceViewModel(
      surfaceID: "redraw-surface",
      catalog: coreCatalog
    )

    viewModel.dataModel.set("/target", value: .string("Initial Target"))
    viewModel.dataModel.set("/sibling1", value: .string("Initial Sibling 1"))
    viewModel.dataModel.set("/unused", value: .string("Initial Unused"))

    let initialComponents = [
      ComponentModel(
        id: "root",
        type: "Column",
        properties: [
          "children": .array([.string("card"), .string("sibling1"), .string("sibling2")])
        ]
      ),
      ComponentModel(
        id: "card",
        type: "Card",
        properties: [
          "child": .string("targetText")
        ]
      ),
      ComponentModel(
        id: "targetText",
        type: "Text",
        properties: [
          "text": .object(["path": .string("/target")])
        ]
      ),
      ComponentModel(
        id: "sibling1",
        type: "Text",
        properties: [
          "text": .object(["path": .string("/sibling1")])
        ]
      ),
      ComponentModel(
        id: "sibling2",
        type: "Text",
        properties: [
          "text": .string("Literal Sibling 2")
        ]
      ),
    ]
    for comp in initialComponents {
      viewModel.componentsModel.addComponent(comp)
    }

    let cancellable = viewModel.objectWillChange.sink { _ in
      counter.record("Surface")
    }
    defer { _ = cancellable }

    let rootView = Surface(viewModel: viewModel, catalog: swiftUICatalog)

    #if canImport(AppKit)
      let hostingView = NSHostingView(rootView: rootView)
      hostingView.frame = NSRect(x: 0, y: 0, width: 400, height: 400)
      let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 400, height: 400),
        styleMask: [.borderless],
        backing: .buffered,
        defer: false
      )
      window.contentView = hostingView
      flushLayout(in: window, hostingView: hostingView)
    #elseif canImport(UIKit)
      let hostingController = UIHostingController(rootView: rootView)
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 400))
      window.rootViewController = hostingController
      window.makeKeyAndVisible()
      flushLayout(in: window, hostingView: hostingController.view)
    #endif

    // 1. Initial mount: every component in the tree renders once.
    #expect(counter.count(for: "root") == 1)
    #expect(counter.count(for: "card") == 1)
    #expect(counter.count(for: "targetText") == 1)
    #expect(counter.count(for: "sibling1") == 1)
    #expect(counter.count(for: "sibling2") == 1)

    let initialRootNode = try #require(viewModel.rootNode)
    let initialCardNode = try #require(initialRootNode.children(for: "children").first)
    let initialTargetNode = try #require(initialCardNode.child(for: "child"))
    #expect(initialTargetNode.string(for: "text") == "Initial Target")

    // 2. Update "/target" in dataModel (only targetText reads "/target").
    counter.reset()
    viewModel.dataModel.set("/target", value: .string("Updated Target"))
    #if canImport(AppKit)
      flushLayout(in: window, hostingView: hostingView)
    #elseif canImport(UIKit)
      flushLayout(in: window, hostingView: hostingController.view)
    #endif

    #expect(counter.count(for: "Surface") == 0)
    #expect(counter.count(for: "root") == 0)
    #expect(counter.count(for: "card") == 0)
    #expect(counter.count(for: "targetText") == 1)
    #expect(counter.count(for: "sibling1") == 0)
    #expect(counter.count(for: "sibling2") == 0)
    #expect(viewModel.rootNode == initialRootNode)
    #expect(initialTargetNode.string(for: "text") == "Updated Target")

    // 3. Update "/unused" in dataModel (no component reads "/unused").
    counter.reset()
    viewModel.dataModel.set("/unused", value: .string("Updated Unused"))
    #if canImport(AppKit)
      flushLayout(in: window, hostingView: hostingView)
    #elseif canImport(UIKit)
      flushLayout(in: window, hostingView: hostingController.view)
    #endif

    #expect(counter.counts.isEmpty)
    #expect(counter.count(for: "Surface") == 0)
    #expect(counter.count(for: "root") == 0)
    #expect(counter.count(for: "card") == 0)
    #expect(counter.count(for: "targetText") == 0)
    #expect(counter.count(for: "sibling1") == 0)
    #expect(counter.count(for: "sibling2") == 0)

    // 4. Add a child to "root" Column.
    counter.reset()
    viewModel.componentsModel.addComponent(
      ComponentModel(
        id: "sibling3",
        type: "Text",
        properties: [
          "text": .string("New Sibling 3")
        ]
      )
    )
    viewModel.componentsModel.addComponent(
      ComponentModel(
        id: "root",
        type: "Column",
        properties: [
          "children": .array([
            .string("card"),
            .string("sibling1"),
            .string("sibling2"),
            .string("sibling3"),
          ])
        ]
      )
    )
    #if canImport(AppKit)
      flushLayout(in: window, hostingView: hostingView)
    #elseif canImport(UIKit)
      flushLayout(in: window, hostingView: hostingController.view)
    #endif

    #expect(counter.count(for: "Surface") == 0)
    #expect(counter.count(for: "root") == 1)
    #expect(counter.count(for: "sibling3") == 1)
    #expect(counter.count(for: "card") == 0)
    #expect(counter.count(for: "targetText") == 0)
    #expect(counter.count(for: "sibling1") == 0)
    #expect(counter.count(for: "sibling2") == 0)

    // 5. Remove "sibling3" from "root" Column.
    counter.reset()
    viewModel.componentsModel.addComponent(
      ComponentModel(
        id: "root",
        type: "Column",
        properties: [
          "children": .array([
            .string("card"),
            .string("sibling1"),
            .string("sibling2"),
          ])
        ]
      )
    )
    #if canImport(AppKit)
      flushLayout(in: window, hostingView: hostingView)
    #elseif canImport(UIKit)
      flushLayout(in: window, hostingView: hostingController.view)
    #endif

    #expect(counter.count(for: "Surface") == 0)
    #expect(counter.count(for: "root") == 1)
    #expect(counter.count(for: "card") == 0)
    #expect(counter.count(for: "targetText") == 0)
    #expect(counter.count(for: "sibling1") == 0)
    #expect(counter.count(for: "sibling2") == 0)
    #expect(counter.count(for: "sibling3") == 0)
  }

  @Test func large2000EntryListUpdateOnlyRedrawsTargetLeaf() throws {
    let itemCount = 2000
    let counter = RedrawCounter()
    let swiftUICatalog = makeInstrumentedCatalog(counter: counter)
    let coreCatalog = BasicCatalog.makeCatalog(version: .v091)
    let clock = ContinuousClock()

    let viewModel = SurfaceViewModel(
      surfaceID: "redraw-2000-surface",
      catalog: coreCatalog
    )

    let itemsArray: [JSONValue] = (0..<itemCount).map { i in
      .object(["name": .string("Item \(i)")])
    }
    viewModel.dataModel.set("/query", value: .string("initial query"))
    viewModel.dataModel.set("/unused", value: .string("initial unused"))
    viewModel.dataModel.set("/items", value: .array(itemsArray))

    let components = [
      ComponentModel(
        id: "root",
        type: "Column",
        properties: [
          "children": .array([.string("searchField"), .string("itemsContainer")])
        ]
      ),
      ComponentModel(
        id: "searchField",
        type: "TextField",
        properties: [
          "label": .string("Search"),
          "value": .object(["path": .string("/query")]),
        ]
      ),
      ComponentModel(
        id: "itemsContainer",
        type: "Column",
        properties: [
          "children": .object([
            "componentId": .string("itemCard"),
            "path": .string("/items"),
          ])
        ]
      ),
      ComponentModel(
        id: "itemCard",
        type: "Card",
        properties: [
          "child": .string("itemText")
        ]
      ),
      ComponentModel(
        id: "itemText",
        type: "Text",
        properties: [
          "text": .object(["path": .string("name")])
        ]
      ),
    ]
    for comp in components {
      viewModel.componentsModel.addComponent(comp)
    }

    let cancellable = viewModel.objectWillChange.sink { _ in
      counter.record("Surface")
    }
    defer { _ = cancellable }

    let rootView = Surface(viewModel: viewModel, catalog: swiftUICatalog)

    // 1. Initial mount of 2,000-entry surface (4,003 total component nodes).
    #if canImport(AppKit)
      let hostingView = NSHostingView(rootView: rootView)
      hostingView.frame = NSRect(x: 0, y: 0, width: 400, height: 800)
      let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 400, height: 800),
        styleMask: [.borderless],
        backing: .buffered,
        defer: false
      )
      let mountDuration = clock.measure {
        window.contentView = hostingView
        flushLayout(in: window, hostingView: hostingView)
      }
    #elseif canImport(UIKit)
      let hostingController = UIHostingController(rootView: rootView)
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
      let mountDuration = clock.measure {
        window.rootViewController = hostingController
        window.makeKeyAndVisible()
        flushLayout(in: window, hostingView: hostingController.view)
      }
    #endif

    print(
      "[2000-Entry] 1. Initial mount: duration=\(mountDuration), "
        + "Surface=\(counter.count(for: "Surface")), "
        + "totalComponentRedraws=\(counter.totalComponentRedraws)"
    )
    #expect(counter.count(for: "root") == 1)
    #expect(counter.count(for: "searchField") == 1)
    #expect(counter.count(for: "itemsContainer") == 1)
    #expect(counter.count(for: "itemCard_0") == 1)
    #expect(counter.count(for: "itemText_0") == 1)
    #expect(counter.count(for: "itemCard_1999") == 1)
    #expect(counter.count(for: "itemText_1999") == 1)
    #expect(counter.totalComponentRedraws == 3 + 2 * itemCount)

    // 2. Update "/query" (only searchField reads "/query"; 2,000 items are untouched).
    counter.reset()
    var querySetDuration: Duration = .zero
    let queryDuration = clock.measure {
      querySetDuration = clock.measure {
        viewModel.dataModel.set("/query", value: .string("updated search query"))
      }
      #if canImport(AppKit)
        flushLayout(in: window, hostingView: hostingView)
      #elseif canImport(UIKit)
        flushLayout(in: window, hostingView: hostingController.view)
      #endif
    }
    print(
      "[2000-Entry] 2. Update /query: setDuration=\(querySetDuration), totalDuration=\(queryDuration), "
        + "resolvedNodes=\(viewModel.nodeResolver.lastResolvedNodeCount), "
        + "Surface=\(counter.count(for: "Surface")), "
        + "root=\(counter.count(for: "root")), "
        + "searchField=\(counter.count(for: "searchField")), "
        + "itemsContainer=\(counter.count(for: "itemsContainer")), "
        + "totalComponentRedraws=\(counter.totalComponentRedraws)"
    )
    #expect(viewModel.nodeResolver.lastResolvedNodeCount == 1)
    #expect(counter.count(for: "Surface") == 0)
    #expect(counter.count(for: "root") == 0)
    #expect(counter.count(for: "searchField") == 1)
    #expect(counter.count(for: "itemsContainer") == 0)
    #expect(counter.totalComponentRedraws == 1)

    // 3. Update "/items/3/name" (only itemText_3 reads "/items/3/name").
    counter.reset()
    var itemSetDuration: Duration = .zero
    let itemUpdateDuration = clock.measure {
      itemSetDuration = clock.measure {
        viewModel.dataModel.set("/items/3/name", value: .string("Updated Item 3"))
      }
      #if canImport(AppKit)
        flushLayout(in: window, hostingView: hostingView)
      #elseif canImport(UIKit)
        flushLayout(in: window, hostingView: hostingController.view)
      #endif
    }
    print(
      "[2000-Entry] 3. Update /items/3/name: setDuration=\(itemSetDuration), totalDuration=\(itemUpdateDuration), "
        + "resolvedNodes=\(viewModel.nodeResolver.lastResolvedNodeCount), "
        + "Surface=\(counter.count(for: "Surface")), "
        + "root=\(counter.count(for: "root")), "
        + "itemsContainer=\(counter.count(for: "itemsContainer")), "
        + "itemCard_3=\(counter.count(for: "itemCard_3")), "
        + "itemText_3=\(counter.count(for: "itemText_3")), "
        + "totalComponentRedraws=\(counter.totalComponentRedraws)"
    )
    #expect(viewModel.nodeResolver.lastResolvedNodeCount == 1)
    #expect(counter.count(for: "Surface") == 0)
    #expect(counter.count(for: "root") == 0)
    #expect(counter.count(for: "itemsContainer") == 0)
    #expect(counter.count(for: "itemCard_3") == 0)
    #expect(counter.count(for: "itemText_3") == 1)
    #expect(counter.totalComponentRedraws == 1)

    // 4. Update "/unused" (no component reads "/unused").
    counter.reset()
    var unusedSetDuration: Duration = .zero
    let unusedDuration = clock.measure {
      unusedSetDuration = clock.measure {
        viewModel.dataModel.set("/unused", value: .string("updated unused"))
      }
      #if canImport(AppKit)
        flushLayout(in: window, hostingView: hostingView)
      #elseif canImport(UIKit)
        flushLayout(in: window, hostingView: hostingController.view)
      #endif
    }
    print(
      "[2000-Entry] 4. Update /unused: setDuration=\(unusedSetDuration), totalDuration=\(unusedDuration), "
        + "resolvedNodes=\(viewModel.nodeResolver.lastResolvedNodeCount), "
        + "Surface=\(counter.count(for: "Surface")), "
        + "totalComponentRedraws=\(counter.totalComponentRedraws)"
    )
    #expect(viewModel.nodeResolver.lastResolvedNodeCount == 0)
    #expect(counter.count(for: "Surface") == 0)
    #expect(counter.totalComponentRedraws == 0)

    // 5. Update only searchField's label in componentsModel (only searchField resolves & redraws).
    counter.reset()
    var compUpdateSetDuration: Duration = .zero
    let compUpdateDuration = clock.measure {
      compUpdateSetDuration = clock.measure {
        viewModel.componentsModel.addComponent(
          ComponentModel(
            id: "searchField",
            type: "TextField",
            properties: [
              "label": .string("Filter Items"),
              "value": .object(["path": .string("/query")]),
            ]
          )
        )
      }
      #if canImport(AppKit)
        flushLayout(in: window, hostingView: hostingView)
      #elseif canImport(UIKit)
        flushLayout(in: window, hostingView: hostingController.view)
      #endif
    }
    print(
      "[2000-Entry] 5. Update searchField component: setDuration=\(compUpdateSetDuration), totalDuration=\(compUpdateDuration), "
        + "resolvedNodes=\(viewModel.nodeResolver.lastResolvedNodeCount), "
        + "Surface=\(counter.count(for: "Surface")), "
        + "searchField=\(counter.count(for: "searchField")), "
        + "totalComponentRedraws=\(counter.totalComponentRedraws)"
    )
    #expect(viewModel.nodeResolver.lastResolvedNodeCount == 1)
    #expect(counter.count(for: "Surface") == 0)
    #expect(counter.count(for: "searchField") == 1)
    #expect(counter.totalComponentRedraws == 1)

    // 6. Append one item (/items/2000) -> only itemsContainer, itemCard_2000, itemText_2000 resolve & draw.
    counter.reset()
    var appendSetDuration: Duration = .zero
    let appendDuration = clock.measure {
      appendSetDuration = clock.measure {
        viewModel.dataModel.set(
          "/items/\(itemCount)", value: .object(["name": .string("Item 2000")]))
      }
      #if canImport(AppKit)
        flushLayout(in: window, hostingView: hostingView)
      #elseif canImport(UIKit)
        flushLayout(in: window, hostingView: hostingController.view)
      #endif
    }
    print(
      "[2000-Entry] 6. Append /items/2000: setDuration=\(appendSetDuration), totalDuration=\(appendDuration), "
        + "resolvedNodes=\(viewModel.nodeResolver.lastResolvedNodeCount), "
        + "Surface=\(counter.count(for: "Surface")), "
        + "itemsContainer=\(counter.count(for: "itemsContainer")), "
        + "itemCard_2000=\(counter.count(for: "itemCard_2000")), "
        + "itemText_2000=\(counter.count(for: "itemText_2000")), "
        + "totalComponentRedraws=\(counter.totalComponentRedraws)"
    )
    #expect(viewModel.nodeResolver.lastResolvedNodeCount == 3)
    #expect(counter.count(for: "Surface") == 0)
    #expect(counter.count(for: "itemsContainer") == 1)
    #expect(counter.count(for: "itemCard_2000") == 1)
    #expect(counter.count(for: "itemText_2000") == 1)
    #expect(counter.totalComponentRedraws == 3)

    // 7. Replace /items with a shorter array (2001 -> 1999) -> only itemsContainer resolves & redraws.
    counter.reset()
    let shorterItems: [JSONValue] = (0..<(itemCount - 1)).map { i in
      .object(["name": .string(i == 3 ? "Updated Item 3" : "Item \(i)")])
    }
    var shrinkSetDuration: Duration = .zero
    let shrinkDuration = clock.measure {
      shrinkSetDuration = clock.measure {
        viewModel.dataModel.set("/items", value: .array(shorterItems))
      }
      #if canImport(AppKit)
        flushLayout(in: window, hostingView: hostingView)
      #elseif canImport(UIKit)
        flushLayout(in: window, hostingView: hostingController.view)
      #endif
    }
    print(
      "[2000-Entry] 7. Shrink /items (2001 -> 1999): setDuration=\(shrinkSetDuration), totalDuration=\(shrinkDuration), "
        + "resolvedNodes=\(viewModel.nodeResolver.lastResolvedNodeCount), "
        + "Surface=\(counter.count(for: "Surface")), "
        + "itemsContainer=\(counter.count(for: "itemsContainer")), "
        + "totalComponentRedraws=\(counter.totalComponentRedraws)"
    )
    #expect(viewModel.nodeResolver.lastResolvedNodeCount == 1)
    #expect(counter.count(for: "Surface") == 0)
    #expect(counter.count(for: "itemsContainer") == 1)
    #expect(counter.totalComponentRedraws == 1)
  }

  @Test func inlineCustomContainerTracksChildNodePropertiesWithoutWorkarounds() throws {
    let counter = RedrawCounter()
    let recorder = RenderedOutputRecorder()
    let buttonGroupSchema = try makeChildListContainerSchema()

    let buttonGroupImpl = ComponentImplementation(
      name: "ButtonGroup",
      schema: buttonGroupSchema
    ) { node in
      counter.record("buttonGroupBuilder")
      return InlineButtonGroupView(node: node, counter: counter)
    }

    let baseCoreCatalog = BasicCatalog.makeCatalog(version: .v091)
    let coreCatalog = Catalog(
      id: "custom-inline",
      protocolVersion: .v091,
      components: Array(baseCoreCatalog.components.values) + [
        AnyComponentAPI(name: "ButtonGroup", schema: buttonGroupSchema)
      ]
    )
    let baseSwiftUICatalog = BasicCatalogImplementation.makeCatalog(version: .v091)
    let swiftUICatalog = Catalog(
      id: "custom-inline",
      protocolVersion: .v091,
      components: Array(baseSwiftUICatalog.components.values) + [buttonGroupImpl]
    )

    let viewModel = SurfaceViewModel(surfaceID: "inline-container", catalog: coreCatalog)
    viewModel.dataModel.set("/first", value: .string("First Initial"))
    viewModel.dataModel.set("/second", value: .string("Second Initial"))
    viewModel.dataModel.set("/unused", value: .string("Unused Initial"))

    viewModel.componentsModel.applyBatch(adding: [
      ComponentModel(
        id: "root",
        type: "ButtonGroup",
        properties: ["children": .array([.string("first"), .string("second")])]
      ),
      ComponentModel(
        id: "first",
        type: "Text",
        properties: ["text": .object(["path": .string("/first")])]
      ),
      ComponentModel(
        id: "second",
        type: "Text",
        properties: ["text": .object(["path": .string("/second")])]
      ),
    ])

    let cancellable = viewModel.objectWillChange.sink { _ in
      counter.record("Surface")
    }
    defer { _ = cancellable }

    let rootView = Surface(viewModel: viewModel, catalog: swiftUICatalog)
      .onPreferenceChange(RenderedTextsPreferenceKey.self) { texts in
        MainActor.assumeIsolated {
          recorder.replaceAll(texts)
        }
      }

    #if canImport(AppKit)
      let hostingView = NSHostingView(rootView: rootView)
      hostingView.frame = NSRect(x: 0, y: 0, width: 400, height: 200)
      let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 400, height: 200),
        styleMask: [.borderless],
        backing: .buffered,
        defer: false
      )
      window.contentView = hostingView
      flushLayout(in: window, hostingView: hostingView)
    #elseif canImport(UIKit)
      let hostingController = UIHostingController(rootView: rootView)
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 200))
      window.rootViewController = hostingController
      window.makeKeyAndVisible()
      flushLayout(in: window, hostingView: hostingController.view)
    #endif

    // 1. Initial render mounts both child labels inline without ComponentNodeView.
    #expect(counter.count(for: "buttonGroupBuilder") == 1)
    #expect(counter.count(for: "buttonGroupBody") == 1)
    #expect(recorder.value(for: "first") == "First Initial")
    #expect(recorder.value(for: "second") == "Second Initial")

    // 2. Mutating /first re-evaluates InlineButtonGroupView.body directly via Observation
    //    and updates the hosted SwiftUI view tree output.
    counter.reset()
    viewModel.dataModel.set("/first", value: .string("First Updated"))
    #if canImport(AppKit)
      flushLayout(in: window, hostingView: hostingView)
    #elseif canImport(UIKit)
      flushLayout(in: window, hostingView: hostingController.view)
    #endif

    #expect(counter.count(for: "Surface") == 0)
    #expect(counter.count(for: "buttonGroupBuilder") == 0)
    #expect(counter.count(for: "buttonGroupBody") == 1)
    #expect(recorder.value(for: "first") == "First Updated")
    #expect(recorder.value(for: "second") == "Second Initial")

    // 3. Mutating an unrelated /unused path or writing the same value causes 0 redraws.
    counter.reset()
    viewModel.dataModel.set("/unused", value: .string("Unused Updated"))
    viewModel.dataModel.set("/first", value: .string("First Updated"))
    #if canImport(AppKit)
      flushLayout(in: window, hostingView: hostingView)
    #elseif canImport(UIKit)
      flushLayout(in: window, hostingView: hostingController.view)
    #endif

    #expect(counter.counts.isEmpty)
  }

  @Test func subviewCustomContainerIsolatesRedrawsToMutatedChildSubview() throws {
    let counter = RedrawCounter()
    let recorder = RenderedOutputRecorder()
    let segmentedSchema = try makeChildListContainerSchema()

    let segmentedImpl = ComponentImplementation(
      name: "SegmentedGroup",
      schema: segmentedSchema
    ) { node in
      counter.record("segmentedBuilder")
      return SegmentedGroupView(node: node, counter: counter)
    }

    let baseCoreCatalog = BasicCatalog.makeCatalog(version: .v091)
    let coreCatalog = Catalog(
      id: "custom-subview",
      protocolVersion: .v091,
      components: Array(baseCoreCatalog.components.values) + [
        AnyComponentAPI(name: "SegmentedGroup", schema: segmentedSchema)
      ]
    )
    let baseSwiftUICatalog = BasicCatalogImplementation.makeCatalog(version: .v091)
    let swiftUICatalog = Catalog(
      id: "custom-subview",
      protocolVersion: .v091,
      components: Array(baseSwiftUICatalog.components.values) + [segmentedImpl]
    )

    let viewModel = SurfaceViewModel(surfaceID: "subview-container", catalog: coreCatalog)
    viewModel.dataModel.set("/first", value: .string("Tab One"))
    viewModel.dataModel.set("/second", value: .string("Tab Two"))
    viewModel.dataModel.set("/unused", value: .string("Unused"))

    viewModel.componentsModel.applyBatch(adding: [
      ComponentModel(
        id: "root",
        type: "SegmentedGroup",
        properties: ["children": .array([.string("first"), .string("second")])]
      ),
      ComponentModel(
        id: "first",
        type: "Text",
        properties: ["text": .object(["path": .string("/first")])]
      ),
      ComponentModel(
        id: "second",
        type: "Text",
        properties: ["text": .object(["path": .string("/second")])]
      ),
    ])

    let cancellable = viewModel.objectWillChange.sink { _ in
      counter.record("Surface")
    }
    defer { _ = cancellable }

    let rootView = Surface(viewModel: viewModel, catalog: swiftUICatalog)
      .onPreferenceChange(RenderedTextsPreferenceKey.self) { texts in
        MainActor.assumeIsolated {
          recorder.replaceAll(texts)
        }
      }

    #if canImport(AppKit)
      let hostingView = NSHostingView(rootView: rootView)
      hostingView.frame = NSRect(x: 0, y: 0, width: 400, height: 200)
      let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 400, height: 200),
        styleMask: [.borderless],
        backing: .buffered,
        defer: false
      )
      window.contentView = hostingView
      flushLayout(in: window, hostingView: hostingView)
    #elseif canImport(UIKit)
      let hostingController = UIHostingController(rootView: rootView)
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 200))
      window.rootViewController = hostingController
      window.makeKeyAndVisible()
      flushLayout(in: window, hostingView: hostingController.view)
    #endif

    // 1. Initial mount renders the container once and each SegmentItemView once.
    #expect(counter.count(for: "segmentedBuilder") == 1)
    #expect(counter.count(for: "segmentedBody") == 1)
    #expect(counter.count(for: "segment_first") == 1)
    #expect(counter.count(for: "segment_second") == 1)
    #expect(recorder.value(for: "first") == "Tab One")
    #expect(recorder.value(for: "second") == "Tab Two")

    // 2. Mutating /first re-renders ONLY SegmentItemView("first") — 0 parent & 0 sibling redraws.
    counter.reset()
    viewModel.dataModel.set("/first", value: .string("Tab One Updated"))
    #if canImport(AppKit)
      flushLayout(in: window, hostingView: hostingView)
    #elseif canImport(UIKit)
      flushLayout(in: window, hostingView: hostingController.view)
    #endif

    #expect(counter.count(for: "Surface") == 0)
    #expect(counter.count(for: "segmentedBuilder") == 0)
    #expect(counter.count(for: "segmentedBody") == 0)
    #expect(counter.count(for: "segment_first") == 1)
    #expect(counter.count(for: "segment_second") == 0)
    #expect(recorder.value(for: "first") == "Tab One Updated")
    #expect(recorder.value(for: "second") == "Tab Two")

    // 3. Appending a third child re-renders the parent and mounts "third" while skipping
    //    unchanged SegmentItemViews ("first" and "second") via Equatable / Node.==.
    counter.reset()
    viewModel.componentsModel.applyBatch(adding: [
      ComponentModel(
        id: "third",
        type: "Text",
        properties: ["text": .string("Tab Three")]
      ),
      ComponentModel(
        id: "root",
        type: "SegmentedGroup",
        properties: [
          "children": .array([.string("first"), .string("second"), .string("third")])
        ]
      ),
    ])
    #if canImport(AppKit)
      flushLayout(in: window, hostingView: hostingView)
    #elseif canImport(UIKit)
      flushLayout(in: window, hostingView: hostingController.view)
    #endif

    #expect(counter.count(for: "Surface") == 0)
    #expect(counter.count(for: "segmentedBuilder") == 1)
    #expect(counter.count(for: "segmentedBody") == 1)
    #expect(counter.count(for: "segment_first") == 0)
    #expect(counter.count(for: "segment_second") == 0)
    #expect(counter.count(for: "segment_third") == 1)
    #expect(recorder.value(for: "third") == "Tab Three")

    // 4. Subsequent mutation to /first after parent Equatable-skip still invalidates "first".
    counter.reset()
    viewModel.dataModel.set("/first", value: .string("Tab One Final"))
    #if canImport(AppKit)
      flushLayout(in: window, hostingView: hostingView)
    #elseif canImport(UIKit)
      flushLayout(in: window, hostingView: hostingController.view)
    #endif

    #expect(counter.count(for: "segmentedBody") == 0)
    #expect(counter.count(for: "segment_first") == 1)
    #expect(counter.count(for: "segment_second") == 0)
    #expect(counter.count(for: "segment_third") == 0)
    #expect(recorder.value(for: "first") == "Tab One Final")
    #expect(recorder.value(for: "second") == "Tab Two")
    #expect(recorder.value(for: "third") == "Tab Three")
  }

  private func makeChildListContainerSchema() throws -> Schema {
    try Schema(
      instance: """
        {
          "allOf": [
            { "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/ComponentCommon" },
            {
              "type": "object",
              "properties": {
                "id": { "type": "string" },
                "component": { "type": "string" },
                "children": {
                  "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/ChildList"
                }
              }
            }
          ]
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
  }
}

private struct RenderedTextsPreferenceKey: PreferenceKey {
  static let defaultValue: [String: String] = [:]

  static func reduce(value: inout [String: String], nextValue: () -> [String: String]) {
    value.merge(nextValue(), uniquingKeysWith: { _, latest in latest })
  }
}

private final class RenderedOutputRecorder: @unchecked Sendable {
  private var values: [String: String] = [:]

  func replaceAll(_ newValues: [String: String]) {
    values = newValues
  }

  func value(for id: String) -> String? {
    values[id]
  }
}

private struct InlineButtonGroupView: View {
  let node: Node
  let counter: RedrawCounter

  var body: some View {
    let _ = counter.record("buttonGroupBody")
    let items = node.children(for: "children").map { child in
      (id: child.id, label: child.string(for: "text") ?? "", action: child.action(for: "action"))
    }
    HStack {
      ForEach(items, id: \.id) { item in
        Button(item.label) {
          item.action?()
        }
        .preference(key: RenderedTextsPreferenceKey.self, value: [item.id: item.label])
      }
    }
  }
}

private struct SegmentedGroupView: View {
  let node: Node
  let counter: RedrawCounter

  var body: some View {
    let _ = counter.record("segmentedBody")
    HStack {
      ForEach(node.children(for: "children")) { child in
        SegmentItemView(child: child, counter: counter)
      }
    }
  }
}

private struct SegmentItemView: View, Equatable {
  let child: Node
  let counter: RedrawCounter

  var body: some View {
    let _ = counter.record("segment_\(child.id)")
    let label = child.string(for: "text") ?? ""
    Text(label)
      .preference(key: RenderedTextsPreferenceKey.self, value: [child.id: label])
  }
}
