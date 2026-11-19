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
import JSONSchema
import SwiftUI
import Testing

#if canImport(AppKit)
  import AppKit
#elseif canImport(UIKit)
  import UIKit
#endif

private struct CatalogEnvironmentProbeView: View {
  @Environment(\.a2uiCatalogs) private var catalogs
  @Environment(\.a2uiDefaultCatalogID) private var defaultCatalogID
  let onRead: ([String: Catalog<ComponentImplementation>], String?) -> Void

  var body: some View {
    Color.clear
      .onAppear {
        onRead(catalogs, defaultCatalogID)
      }
  }
}

@MainActor
private final class HostSession {
  #if canImport(AppKit)
    private let hostingView: NSHostingView<AnyView>
    private let window: NSWindow
  #elseif canImport(UIKit)
    private let hostingController: UIHostingController<AnyView>
    private let window: UIWindow
  #endif

  init<Content: View>(_ view: Content) {
    let rootView = AnyView(view.frame(width: 400, height: 200))
    #if canImport(AppKit)
      let hostingView = NSHostingView(rootView: rootView)
      hostingView.frame = NSRect(x: 0, y: 0, width: 400, height: 200)
      let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 400, height: 200),
        styleMask: [.borderless],
        backing: .buffered,
        defer: false
      )
      window.isReleasedWhenClosed = false
      window.contentView = hostingView
      window.makeKeyAndOrderFront(nil)
      self.hostingView = hostingView
      self.window = window
    #elseif canImport(UIKit)
      let hostingController = UIHostingController(rootView: rootView)
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 200))
      window.rootViewController = hostingController
      window.makeKeyAndVisible()
      hostingController.view.frame = window.bounds
      self.hostingController = hostingController
      self.window = window
    #endif
    flush()
  }

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

  func tearDown() {
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
}

@Suite(.serialized)
@MainActor
struct SwiftUICatalogRenderingTests {

  @Test func catalogResolvesUnqualifiedFallback() throws {
    let schema = try Schema(instance: "{\"type\": \"object\"}")
    let buttonComponent = ComponentImplementation(name: "button", schema: schema) { node in
      AnyView(Text(node.type))
    }
    let catalog = Catalog(id: "catalogA", components: [buttonComponent])

    let node = Node(
      id: "btn1",
      type: "button",
      catalogID: "catalogA",
      properties: [:]
    )
    let renderedView = Surface.render(node: node, using: ["catalogA": catalog])
    #expect(renderedView != nil)
  }

  @Test func catalogResolvesQualifiedOverFallback() throws {
    let schema = try Schema(instance: "{\"type\": \"object\"}")
    var qualifiedCalled = false
    var fallbackCalled = false

    let qualifiedButton = ComponentImplementation(name: "button", schema: schema) { _ in
      qualifiedCalled = true
      return AnyView(Text("Qualified"))
    }
    let fallbackButton = ComponentImplementation(name: "button", schema: schema) { _ in
      fallbackCalled = true
      return AnyView(Text("Fallback"))
    }

    let catalogA = Catalog(id: "catalogA", components: [qualifiedButton])
    let catalogB = Catalog(id: "catalogB", components: [fallbackButton])

    let node = Node(
      id: "btn1",
      type: "button",
      catalogID: "catalogA",
      properties: [:]
    )
    _ = Surface.render(
      node: node, using: ["catalogA": catalogA, "catalogB": catalogB], defaultCatalogID: "catalogB")
    #expect(qualifiedCalled)
    #expect(!fallbackCalled)
  }

  @Test func implementationLookupOrder() throws {
    let schemaA = try Schema(instance: "{\"type\": \"object\", \"title\": \"a\"}")
    let schemaB = try Schema(instance: "{\"type\": \"object\", \"title\": \"b\"}")
    let catalogs = [
      "a": Catalog(
        id: "a",
        components: [
          ComponentImplementation(name: "button", schema: schemaA) { _ in AnyView(EmptyView()) }
        ]),
      "b": Catalog(
        id: "b",
        components: [
          ComponentImplementation(name: "button", schema: schemaB) { _ in AnyView(EmptyView()) }
        ]),
    ]
    func lookup(_ type: String, catalogID: String?, defaultCatalogID: String?) -> Schema? {
      let node = Node(id: "n", type: type, catalogID: catalogID, properties: [:])
      return Surface.implementation(for: node, using: catalogs, defaultCatalogID: defaultCatalogID)?
        .schema
    }

    // The node's own catalog wins over the default.
    #expect(lookup("button", catalogID: "a", defaultCatalogID: "b") == schemaA)
    // Without a catalog ID, the default catalog is used.
    #expect(lookup("button", catalogID: nil, defaultCatalogID: "b") == schemaB)
    // When the node's catalog lacks the type, falls back to the default catalog, then sorted keys.
    #expect(lookup("button", catalogID: "missing", defaultCatalogID: "b") == schemaB)
    #expect(lookup("button", catalogID: "missing", defaultCatalogID: "missing") == schemaA)
    #expect(lookup("unknown", catalogID: nil, defaultCatalogID: "a") == nil)
  }

  @Test func componentImplementationConformsToComponentAPIAndExposesBuilder() throws {
    let schema = try Schema(instance: "{\"type\": \"object\"}")
    var builderCalled = false
    let component = ComponentImplementation(
      name: "map",
      schema: schema
    ) { _ in
      builderCalled = true
      return AnyView(Text("Map"))
    }

    #expect(component.name == "map")
    #expect(component.schema == schema)
    let api: any ComponentAPI = component
    #expect(api.name == "map")
    #expect(api.schema == schema)

    let catalog = Catalog(id: "mapsCatalog", components: [component])
    let node = Node(
      id: "map1",
      type: "map",
      catalogID: "mapsCatalog",
      properties: [:]
    )
    _ = Surface.render(node: node, using: ["mapsCatalog": catalog])
    #expect(builderCalled)
  }

  @Test func catalogsEnvironmentDefaultsToEmpty() {
    let environment = EnvironmentValues()
    #expect(environment.a2uiCatalogs.isEmpty)
    #expect(environment.a2uiDefaultCatalogID == nil)
  }

  @Test func surfacePropagatesCatalogsEnvironmentToDescendants() throws {
    let schema = try Schema(instance: #"{"type": "object"}"#)
    var observedCatalogIDs: Set<String> = []
    var observedDefaultCatalogID: String?
    let probeComponent = ComponentImplementation(name: "probe", schema: schema) { _ in
      CatalogEnvironmentProbeView { catalogs, defaultCatalogID in
        observedCatalogIDs = Set(catalogs.keys)
        observedDefaultCatalogID = defaultCatalogID
      }
    }
    let extraComponent = ComponentImplementation(name: "extra", schema: schema) { _ in
      EmptyView()
    }
    let primaryCatalog = Catalog(id: "primary", components: [probeComponent])
    let secondaryCatalog = Catalog(id: "secondary", components: [extraComponent])
    let viewModel = SurfaceViewModel(
      surfaceID: "env-surface",
      catalogs: [primaryCatalog, secondaryCatalog],
      defaultCatalogID: secondaryCatalog.id
    )
    viewModel.componentsModel.addComponent(
      ComponentModel(id: "root", type: "probe", catalogID: primaryCatalog.id, properties: [:])
    )
    let surface = Surface(
      viewModel: viewModel,
      catalogs: [primaryCatalog, secondaryCatalog],
      defaultCatalogID: secondaryCatalog.id
    )
    let driver = HostedViewDriver(surface: surface)
    defer { driver.tearDown() }

    #expect(observedCatalogIDs == ["primary", "secondary"])
    #expect(observedDefaultCatalogID == "secondary")
  }

  @Test func environmentCatalogModifierSuppliesCatalogAndUsesViewModelDefault() throws {
    let schema = try Schema(instance: #"{"type": "object"}"#)
    var rendered = false
    var observedCatalogIDs: Set<String> = []
    var observedDefaultCatalogID: String?
    let badgeComponent = ComponentImplementation(name: "badge", schema: schema) { _ in
      rendered = true
      return CatalogEnvironmentProbeView { catalogs, defaultCatalogID in
        observedCatalogIDs = Set(catalogs.keys)
        observedDefaultCatalogID = defaultCatalogID
      }
    }
    let flightCatalog = Catalog(id: "flight", components: [badgeComponent])
    let viewModel = SurfaceViewModel(
      surfaceID: "env-supplied",
      catalog: flightCatalog
    )
    viewModel.componentsModel.addComponent(
      ComponentModel(id: "root", type: "badge", catalogID: flightCatalog.id, properties: [:])
    )

    let surface = Surface(viewModel: viewModel, catalogs: [])
    #expect(surface.catalogs.isEmpty)

    let host = HostSession(VStack { surface }.a2uiCatalog(flightCatalog))
    defer { host.tearDown() }

    #expect(rendered)
    #expect(observedCatalogIDs == ["flight"])
    #expect(observedDefaultCatalogID == "flight")
  }

  @Test func environmentCatalogsAccumulateAndCloserModifierWins() throws {
    let schema = try Schema(instance: #"{"type": "object"}"#)
    var renderedVariant: String?
    var observedCatalogIDs: Set<String> = []

    let outerShared = ComponentImplementation(name: "card", schema: schema) { _ in
      renderedVariant = "outer"
      return CatalogEnvironmentProbeView { catalogs, _ in
        observedCatalogIDs = Set(catalogs.keys)
      }
    }
    let arrayOverride = ComponentImplementation(name: "card", schema: schema) { _ in
      renderedVariant = "array-last"
      return CatalogEnvironmentProbeView { catalogs, _ in
        observedCatalogIDs = Set(catalogs.keys)
      }
    }
    let innerShared = ComponentImplementation(name: "card", schema: schema) { _ in
      renderedVariant = "inner"
      return CatalogEnvironmentProbeView { catalogs, _ in
        observedCatalogIDs = Set(catalogs.keys)
      }
    }
    let extraComponent = ComponentImplementation(name: "extra", schema: schema) { _ in
      EmptyView()
    }

    let outerCatalog = Catalog(id: "shared", components: [outerShared])
    let arrayOverrideCatalog = Catalog(id: "shared", components: [arrayOverride])
    let innerCatalog = Catalog(id: "shared", components: [innerShared])
    let extraCatalog = Catalog(id: "extra", components: [extraComponent])

    let viewModel = SurfaceViewModel(
      surfaceID: "stacked-env",
      catalogs: [outerCatalog, extraCatalog],
      defaultCatalogID: "shared"
    )
    viewModel.componentsModel.addComponent(
      ComponentModel(id: "root", type: "card", catalogID: "shared", properties: [:])
    )

    // Nested ancestors: inner modifier overrides outer array; outer extra catalog is preserved.
    let nestedHost = HostSession(
      VStack {
        Surface(viewModel: viewModel, catalogs: [])
          .a2uiCatalog(innerCatalog)
      }
      .a2uiCatalogs([outerCatalog, arrayOverrideCatalog, extraCatalog])
    )
    nestedHost.tearDown()

    #expect(renderedVariant == "inner")
    #expect(observedCatalogIDs == ["shared", "extra"])

    // Chained on the same view: closer (first) modifier wins, matching SwiftUI conventions.
    renderedVariant = nil
    let chainedHost = HostSession(
      Surface(viewModel: viewModel, catalogs: [])
        .a2uiCatalog(innerCatalog)
        .a2uiCatalogs([outerCatalog, arrayOverrideCatalog])
    )
    chainedHost.tearDown()

    #expect(renderedVariant == "inner")

    // Duplicate IDs within a single array: last element wins, matching Surface.init.
    renderedVariant = nil
    let arrayHost = HostSession(
      Surface(viewModel: viewModel, catalogs: [])
        .a2uiCatalogs([outerCatalog, arrayOverrideCatalog])
    )
    arrayHost.tearDown()

    #expect(renderedVariant == "array-last")
  }

  @Test func surfaceInitializerCatalogOverridesEnvironmentCatalog() throws {
    let schema = try Schema(instance: #"{"type": "object"}"#)
    var renderedSource: String?
    var observedCatalogIDs: Set<String> = []

    let envImpl = ComponentImplementation(name: "widget", schema: schema) { _ in
      renderedSource = "environment"
      return CatalogEnvironmentProbeView { catalogs, _ in
        observedCatalogIDs = Set(catalogs.keys)
      }
    }
    let localImpl = ComponentImplementation(name: "widget", schema: schema) { _ in
      renderedSource = "local"
      return CatalogEnvironmentProbeView { catalogs, _ in
        observedCatalogIDs = Set(catalogs.keys)
      }
    }
    let extraImpl = ComponentImplementation(name: "extra", schema: schema) { _ in
      EmptyView()
    }

    let envCatalog = Catalog(id: "shared", components: [envImpl])
    let localCatalog = Catalog(id: "shared", components: [localImpl])
    let extraCatalog = Catalog(id: "extra", components: [extraImpl])

    let viewModel = SurfaceViewModel(
      surfaceID: "local-wins",
      catalogs: [localCatalog, extraCatalog],
      defaultCatalogID: "shared"
    )
    viewModel.componentsModel.addComponent(
      ComponentModel(id: "root", type: "widget", catalogID: "shared", properties: [:])
    )

    let host = HostSession(
      Surface(viewModel: viewModel, catalogs: [localCatalog])
        .a2uiCatalogs([envCatalog, extraCatalog])
    )
    defer { host.tearDown() }

    #expect(renderedSource == "local")
    #expect(observedCatalogIDs == ["shared", "extra"])
  }

  @Test func nestedSurfaceInheritsAmbientCatalogsWithoutOuterLocalLeakage() throws {
    let schema = try Schema(instance: #"{"type": "object"}"#)
    var innerObservedCatalogIDs: Set<String> = []

    let innerProbe = ComponentImplementation(name: "innerProbe", schema: schema) { _ in
      CatalogEnvironmentProbeView { catalogs, _ in
        innerObservedCatalogIDs = Set(catalogs.keys)
      }
    }
    let ambientComponent = ComponentImplementation(name: "ambientItem", schema: schema) { _ in
      EmptyView()
    }

    let ambientCatalog = Catalog(id: "ambient", components: [ambientComponent])
    let innerLocalCatalog = Catalog(id: "inner-local", components: [innerProbe])

    let innerVM = SurfaceViewModel(
      surfaceID: "inner-surface",
      catalogs: [innerLocalCatalog, ambientCatalog],
      defaultCatalogID: "inner-local"
    )
    innerVM.componentsModel.addComponent(
      ComponentModel(id: "root", type: "innerProbe", catalogID: "inner-local", properties: [:])
    )

    let outerHost = ComponentImplementation(name: "outerHost", schema: schema) { _ in
      Surface(viewModel: innerVM, catalogs: [innerLocalCatalog])
    }
    let outerLocalCatalog = Catalog(id: "outer-local", components: [outerHost])

    let outerVM = SurfaceViewModel(
      surfaceID: "outer-surface",
      catalog: outerLocalCatalog
    )
    outerVM.componentsModel.addComponent(
      ComponentModel(id: "root", type: "outerHost", catalogID: "outer-local", properties: [:])
    )

    let host = HostSession(
      Surface(viewModel: outerVM, catalogs: [outerLocalCatalog])
        .a2uiCatalog(ambientCatalog)
    )
    defer { host.tearDown() }

    #expect(innerObservedCatalogIDs == ["ambient", "inner-local"])
  }

  @Test func environmentCatalogModifierInsideSurfaceDoesNotMutateEnclosingSurface() throws {
    let schema = try Schema(instance: #"{"type": "object"}"#)
    var childRenderedFromModifier = false
    var childObservedCatalogIDs: Set<String> = []

    let injectedComponent = ComponentImplementation(name: "probe", schema: schema) { _ in
      childRenderedFromModifier = true
      return EmptyView()
    }
    let injectedCatalog = Catalog(id: "injected", components: [injectedComponent])
    let overrideBaseCatalog = Catalog(id: "base", components: [injectedComponent])

    let baseProbe = ComponentImplementation(name: "probe", schema: schema) { _ in
      CatalogEnvironmentProbeView { catalogs, _ in
        childObservedCatalogIDs = Set(catalogs.keys)
      }
    }
    let wrapperSchema = try Schema(
      instance: """
        {
          "type": "object",
          "$defs": { "ComponentId": { "type": "string" } },
          "properties": { "child": { "$ref": "#/$defs/ComponentId" } }
        }
        """
    )
    let wrapper = ComponentImplementation(name: "wrapper", schema: wrapperSchema) { node in
      Group {
        if let child = node.child(for: "child") {
          ComponentNodeView(node: child)
            .a2uiCatalogs([injectedCatalog, overrideBaseCatalog])
        }
      }
    }
    let baseCatalog = Catalog(id: "base", components: [wrapper, baseProbe])

    let viewModel = SurfaceViewModel(surfaceID: "enclosing", catalog: baseCatalog)
    viewModel.componentsModel.applyBatch(adding: [
      ComponentModel(
        id: "root",
        type: "wrapper",
        catalogID: "base",
        properties: ["child": .string("leaf")]
      ),
      ComponentModel(id: "leaf", type: "probe", catalogID: "base", properties: [:]),
    ])
    _ = try #require(viewModel.rootNode?.child(for: "child"))

    let host = HostSession(Surface(viewModel: viewModel, catalog: baseCatalog))
    defer { host.tearDown() }

    #expect(!childRenderedFromModifier)
    #expect(childObservedCatalogIDs == ["base"])
  }

  @Test func publicA2UICatalogsEnvironmentUpdatesReactivelyWhenAncestorChanges() throws {
    let schema = try Schema(instance: #"{"type": "object"}"#)
    let recorder = CatalogIDRecorder()

    let observerComponent = ComponentImplementation(name: "observer", schema: schema) { _ in
      IsolatedPublicCatalogObserver(recorder: recorder).equatable()
    }
    let extraComponent = ComponentImplementation(name: "extra", schema: schema) { _ in
      EmptyView()
    }
    let baseCatalog = Catalog(id: "base", components: [observerComponent])
    let firstEnvCatalog = Catalog(id: "env-a", components: [extraComponent])
    let secondEnvCatalog = Catalog(id: "env-b", components: [extraComponent])

    let viewModel = SurfaceViewModel(surfaceID: "reactive-env", catalog: baseCatalog)
    viewModel.componentsModel.addComponent(
      ComponentModel(id: "root", type: "observer", catalogID: "base", properties: [:])
    )

    let hostState = ReactiveCatalogHostState(catalogs: [firstEnvCatalog])
    let rootView = ReactiveCatalogHostView(
      state: hostState,
      viewModel: viewModel,
      baseCatalog: baseCatalog
    )

    let host = HostSession(rootView)
    defer { host.tearDown() }

    #expect(recorder.snapshots == [["base", "env-a"]])

    hostState.catalogs = [firstEnvCatalog, secondEnvCatalog]
    host.flush()

    #expect(recorder.snapshots == [["base", "env-a"], ["base", "env-a", "env-b"]])
  }
}

@MainActor
@Observable
private final class ReactiveCatalogHostState {
  var catalogs: [Catalog<ComponentImplementation>]

  init(catalogs: [Catalog<ComponentImplementation>]) {
    self.catalogs = catalogs
  }
}

private struct ReactiveCatalogHostView: View {
  let state: ReactiveCatalogHostState
  let viewModel: SurfaceViewModel
  let baseCatalog: Catalog<ComponentImplementation>

  var body: some View {
    Surface(viewModel: viewModel, catalogs: [baseCatalog])
      .a2uiCatalogs(state.catalogs)
  }
}

@MainActor
private final class CatalogIDRecorder {
  private(set) var snapshots: [Set<String>] = []

  func record(_ ids: Set<String>) {
    snapshots.append(ids)
  }
}

private struct IsolatedPublicCatalogObserver: View, Equatable {
  @Environment(\.a2uiCatalogs) private var catalogs
  let recorder: CatalogIDRecorder

  nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.recorder === rhs.recorder
  }

  var body: some View {
    let keys = Set(catalogs.keys)
    let _ = recorder.record(keys)
    Text(keys.sorted().joined(separator: ","))
  }
}
