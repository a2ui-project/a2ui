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
import Foundation
import OrderedCollections
import OrderedJSON
import Testing

/// Runs the shared `conformance/core/accessibility.yaml` suite.
///
/// Each case's components are added to a surface built with the case's catalogs, and every
/// `accessibilityTree` expectation is compared with the `accessibilityAttributes` of the node that
/// the surface's `NodeResolver` resolves. An expectation is a string, a boolean, or a `{path}`
/// (or `{"@path"}`) reference into the surface data model. The cases carry no data, so before
/// checking a case with references the runner writes a value to each referenced path and checks,
/// then writes a different value and checks again, so a binding that does not follow the data
/// model fails. Any other expectation shape, and any field the runner does not know, records an
/// issue.
@MainActor
struct AccessibilityConformanceTests {
  /// `accessibilityTree` fields that describe how a UI framework exposes a component: its role and
  /// its toggle state. `A2UICore` has no model for them, so this runner does not check them.
  private static let rendererOnlyFields: Set<String> = ["role", "checked"]

  /// How many times a case with data model references is checked, each time with different values
  /// at the referenced paths.
  private static let dataModelRounds = 2

  @Test func accessibilityConformance() throws {
    let rawYaml = try ConformanceTestHelper.loadYAML(filename: "core/accessibility.yaml")
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYaml)

    #expect(!testCases.isEmpty, "Should find test cases in accessibility.yaml")

    var checkedFields = 0
    var checkedReferences = 0

    for testCase in testCases {
      guard testCase.action == "accessibility_check" else {
        Issue.record("[\(testCase.name)] Unhandled action '\(testCase.action ?? "")'")
        continue
      }
      guard let surfaceDefinition = testCase.surface else {
        Issue.record("[\(testCase.name)] The case has no surface")
        continue
      }
      guard let expectedTree = testCase.assertions?["accessibilityTree"]?.objectValue else {
        Issue.record("[\(testCase.name)] The case has no accessibilityTree assertions")
        continue
      }

      let surface = try makeSurface(testCase: testCase, surfaceDefinition: surfaceDefinition)

      let references = dataModelReferences(in: expectedTree, testCase: testCase)
      if references.isEmpty {
        checkedFields += check(expectedTree, on: surface, testCase: testCase)
        continue
      }
      for round in 0..<Self.dataModelRounds {
        for (path, field) in references.sorted(by: { $0.key < $1.key }) {
          guard let value = sampleValue(for: field, round: round) else {
            Issue.record(
              "[\(testCase.name)] No sample value for field '\(field)' bound to '\(path)'")
            continue
          }
          surface.dataModel.set(path, value: value)
          checkedReferences += 1
        }
        checkedFields += check(expectedTree, on: surface, testCase: testCase)
      }
    }

    #expect(checkedFields > 0, "no accessibilityTree assertion of the suite was checked")
    #expect(checkedReferences > 0, "no data model reference of the suite was checked")
  }

  /// Creates a surface with the case's catalogs and adds the case's components to it.
  ///
  /// The components go straight into the surface's components model rather than through an
  /// `updateComponents` message, because the suite's surfaces are not valid v1.0 payloads: they
  /// use `Container`, which the basic catalog has no component for, and properties such as
  /// `Button.title` and `CheckBox.checked` that the catalog does not define, and they leave out
  /// required ones such as `Button.child`, so `MessageProcessor` rejects them.
  private func makeSurface(
    testCase: ConformanceTestCase,
    surfaceDefinition: [String: JSONValue]
  ) throws -> SurfaceViewModel {
    let catalogs = try ConformanceTestHelper.buildCatalogs(for: testCase)
    let catalog = try #require(catalogs.first, "[\(testCase.name)] The case has no catalog")
    let surface = SurfaceViewModel(
      surfaceID: "accessibility-surface",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      protocolVersion: .v10
    )

    var definitions = [("root", surfaceDefinition)]
    for (componentID, definition) in surfaceDefinition["components"]?.objectValue ?? [:] {
      guard let object = definition.objectValue else {
        Issue.record("[\(testCase.name)] Component '\(componentID)' is not an object")
        continue
      }
      definitions.append(
        (componentID, object.reduce(into: [:]) { $0[$1.key] = $1.value })
      )
    }
    for (fallbackID, definition) in definitions {
      guard let type = definition["component"]?.stringValue else {
        Issue.record("[\(testCase.name)] Component '\(fallbackID)' has no component type")
        continue
      }
      surface.componentsModel.addComponent(
        ComponentModel(
          id: definition["id"]?.stringValue ?? fallbackID,
          type: type,
          properties: definition.filter { !["id", "component", "components"].contains($0.key) }
        )
      )
    }
    return surface
  }

  /// Compares every expectation of `expectedTree` with the resolved surface and returns how many
  /// fields it compared.
  private func check(
    _ expectedTree: OrderedDictionary<String, JSONValue>,
    on surface: SurfaceViewModel,
    testCase: ConformanceTestCase
  ) -> Int {
    guard let root = surface.nodeResolver.resolveTree() else {
      Issue.record("[\(testCase.name)] The surface resolved no tree")
      return 0
    }
    var checkedFields = 0
    for (componentID, expectedNode) in expectedTree {
      guard let expectedFields = expectedNode.objectValue else {
        Issue.record("[\(testCase.name)] Expectation for '\(componentID)' is not an object")
        continue
      }
      guard
        let node = findNode(id: componentID, in: root)
          ?? resolveDetached(componentID: componentID, on: surface)
      else {
        Issue.record("[\(testCase.name)] Component '\(componentID)' could not be resolved")
        continue
      }
      let attributes = node.accessibilityAttributes
      for (field, expectedShape) in expectedFields {
        if Self.rendererOnlyFields.contains(field) { continue }
        let actual: JSONValue?
        switch field {
        case "label": actual = attributes?.label.map { .string($0) }
        case "description": actual = attributes?.description.map { .string($0) }
        case "live": actual = attributes?.live.map { .string($0) }
        case "hidden": actual = attributes?.hidden.map { .boolean($0) }
        default:
          Issue.record("[\(testCase.name)] Unhandled field '\(field)' for '\(componentID)'")
          continue
        }
        guard
          let expected = resolveExpectation(
            expectedShape,
            dataModel: surface.dataModel,
            context: "[\(testCase.name)] \(componentID).\(field)"
          )
        else { continue }
        #expect(
          actual == expected,
          """
          [\(testCase.name)] Expected \(field) \(expected) for '\(componentID)', \
          got \(actual.map { "\($0)" } ?? "nil")
          """
        )
        checkedFields += 1
      }
    }
    return checkedFields
  }

  /// Returns the value an expectation stands for: a string or a boolean as is, or the data model
  /// value at the path of a `{path}` or `{"@path"}` reference. Records an issue and returns `nil`
  /// for any other shape, and for a reference to a path that has no value.
  private func resolveExpectation(
    _ shape: JSONValue,
    dataModel: DataModel,
    context: String
  ) -> JSONValue? {
    switch shape {
    case .string, .boolean:
      return shape
    default:
      guard let path = referencedPath(in: shape) else {
        Issue.record("\(context): unhandled expectation shape \(shape)")
        return nil
      }
      guard let value = dataModel.get(path) else {
        Issue.record("\(context): the data model has no value at '\(path)'")
        return nil
      }
      return value
    }
  }

  /// The path of a `{path: "/x"}` or `{"@path": "/x"}` reference, or `nil` for any other value.
  private func referencedPath(in value: JSONValue) -> String? {
    guard let object = value.objectValue, object.count == 1 else { return nil }
    return (object["path"] ?? object["@path"])?.stringValue
  }

  /// Maps each data model path that the expectations reference to the field that references it.
  private func dataModelReferences(
    in expectedTree: OrderedDictionary<String, JSONValue>,
    testCase: ConformanceTestCase
  ) -> [String: String] {
    var references: [String: String] = [:]
    for expectedNode in expectedTree.values {
      for (field, expectedShape) in expectedNode.objectValue ?? [:] {
        guard let path = referencedPath(in: expectedShape) else { continue }
        if let other = references[path], other != field {
          Issue.record(
            "[\(testCase.name)] '\(path)' is referenced by both '\(other)' and '\(field)'")
        }
        references[path] = field
      }
    }
    return references
  }

  /// A value of the field's type that differs from one round to the next.
  private func sampleValue(for field: String, round: Int) -> JSONValue? {
    switch field {
    case "label", "description": return .string("\(field) \(round)")
    case "live": return .string(round.isMultiple(of: 2) ? "polite" : "assertive")
    case "hidden": return .boolean(round.isMultiple(of: 2))
    default: return nil
    }
  }

  /// Resolves a component that the surface's tree does not reach, as the root of a tree of its
  /// own over the same catalogs and data model.
  ///
  /// `test_accessibility_live_region_assertive` puts its component in a `Container`, which the
  /// basic catalog does not define, so the resolver has no schema telling it that `child` is a
  /// component reference and never reaches the child.
  private func resolveDetached(componentID: String, on surface: SurfaceViewModel) -> Node? {
    guard let component = surface.componentsModel.get(componentID) else { return nil }
    // Keep the surface's other components, so children of the detached component resolve too.
    var components = surface.componentsModel.components
    components["root"] = ComponentModel(
      id: "root",
      type: component.type,
      catalogID: component.catalogID,
      properties: component.properties
    )
    let resolver = NodeResolver(
      surfaceID: surface.surfaceID,
      catalogs: surface.catalogs,
      defaultCatalogID: surface.defaultCatalogID,
      componentsModel: SurfaceComponentsModel(components: components),
      dataModel: surface.dataModel,
      protocolVersion: surface.protocolVersion
    )
    return resolver.resolveTree()
  }

  private func findNode(id: String, in node: Node) -> Node? {
    if node.id == id { return node }
    for child in node.allChildNodes {
      if let found = findNode(id: id, in: child) { return found }
    }
    return nil
  }
}
