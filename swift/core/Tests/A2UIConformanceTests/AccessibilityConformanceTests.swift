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
/// `accessibilityTree` expectation is compared with the `accessibilityAttributes` of the node in
/// the surface's `rootNode` tree. An expectation is a string, a boolean, or a `{path}` (or
/// `{"@path"}`) reference into the surface data model. The cases carry no data, so before
/// checking a case with references the runner writes a value to each referenced path and checks,
/// then writes different values and checks again. Paths bound to the same field get different
/// values in each round, so a binding that does not follow the data model, or follows the wrong
/// path, fails. Any other expectation shape, and any field the runner does not know, records an
/// issue.
@MainActor
struct AccessibilityConformanceTests {
  /// `accessibilityTree` fields that describe how a UI framework exposes a component: its role and
  /// its toggle state. `A2UICore` has no model for them, so this runner does not check them.
  private static let rendererOnlyFields: Set<String> = ["role", "checked"]

  /// How many times a case with data model references is checked, each time with different values
  /// at the referenced paths.
  private static let dataModelRounds = 2

  private static let knownCaseKeys: Set<String> = [
    "action",
    "assertions",
    "catalogPath",
    "messages",
    "protocolVersion",
    "steps",
    "surface",
  ]

  private static let knownAssertionsKeys: Set<String> = [
    "accessibilityTree",
    "axeCore",
  ]

  private static let knownStepKeys: Set<String> = [
    "assertions",
    "messages",
  ]

  @Test(arguments: ConformanceTestHelper.cases("core/accessibility.yaml"))
  func accessibilityConformance(_ conformanceCase: ConformanceCase) throws {
    try ConformanceManifest.run(conformanceCase) {
      try runSingleAccessibilityCase(conformanceCase)
    }
  }

  private func runSingleAccessibilityCase(_ conformanceCase: ConformanceCase) throws {
    try validateCaseStructure(conformanceCase)
    let testCase = try #require(
      conformanceCase.parsedTestCase(),
      "[\(conformanceCase.name)] Could not parse accessibility case"
    )
    guard testCase.action == "accessibility_check" else {
      Issue.record("[\(testCase.name)] Unhandled action '\(testCase.action ?? "")'")
      throw UnknownConformanceKeyError(
        "[\(testCase.name)] Unhandled action '\(testCase.action ?? "")'"
      )
    }
    let surfaceDefinition = try #require(
      testCase.surface,
      "[\(testCase.name)] The case has no surface"
    )
    let expectedTree = try #require(
      testCase.assertions?["accessibilityTree"]?.objectValue,
      "[\(testCase.name)] The case has no accessibilityTree assertions"
    )

    let surface = try makeSurface(testCase: testCase, surfaceDefinition: surfaceDefinition)
    let references = dataModelReferences(in: expectedTree, testCase: testCase)
    if references.isEmpty {
      let checkedFields = try check(expectedTree, on: surface, testCase: testCase)
      #expect(checkedFields > 0, "[\(testCase.name)] no accessibilityTree assertion was checked")
      return
    }
    try checkDataModelRounds(
      expectedTree: expectedTree,
      references: references,
      surface: surface,
      testCase: testCase
    )
  }

  private func validateCaseStructure(_ conformanceCase: ConformanceCase) throws {
    let rawDict = conformanceCase.rawDictionary
    try ConformanceTestHelper.assertKnownKeys(
      rawDict,
      Self.knownCaseKeys,
      "core/accessibility.yaml case '\(conformanceCase.name)'"
    )
    if let assertions = rawDict["assertions"] as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        assertions,
        Self.knownAssertionsKeys,
        "core/accessibility.yaml assertions in '\(conformanceCase.name)'",
        allowMetadata: false
      )
    }
    if let steps = rawDict["steps"] as? [[String: Any]] {
      for (index, step) in steps.enumerated() {
        try ConformanceTestHelper.assertKnownKeys(
          step,
          Self.knownStepKeys,
          "core/accessibility.yaml step[\(index)] in '\(conformanceCase.name)'"
        )
      }
    }
  }

  private func checkDataModelRounds(
    expectedTree: OrderedDictionary<String, JSONValue>,
    references: [String: String],
    surface: SurfaceViewModel,
    testCase: ConformanceTestCase
  ) throws {
    let sortedReferences = references.sorted { $0.key < $1.key }
    var checkedFields = 0
    var checkedReferences = 0
    for round in 0..<Self.dataModelRounds {
      for (index, (path, field)) in sortedReferences.enumerated() {
        let value = try sampleValue(
          for: field,
          path: path,
          index: index,
          round: round,
          testName: testCase.name
        )
        surface.dataModel.set(path, value: value)
        checkedReferences += 1
      }
      checkedFields += try check(expectedTree, on: surface, testCase: testCase)
    }
    #expect(checkedFields > 0, "[\(testCase.name)] no accessibilityTree assertion was checked")
    #expect(checkedReferences > 0, "[\(testCase.name)] no data model reference was checked")
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
    let defaultCatalog = try #require(
      catalogs.first,
      "[\(testCase.name)] The case has no catalog"
    )
    let surface = SurfaceViewModel(
      surfaceID: "accessibility-surface",
      catalogs: catalogs,
      defaultCatalogID: defaultCatalog.id,
      protocolVersion: testCase.protocolVersion.flatMap(A2UIProtocolVersion.init(lenientRawValue:))
    )

    var definitions = [("root", surfaceDefinition)]
    for (componentID, definition) in surfaceDefinition["components"]?.objectValue ?? [:] {
      guard let componentDictionary = definition.dictionaryValue else {
        Issue.record("[\(testCase.name)] Component '\(componentID)' is not an object")
        continue
      }
      definitions.append((componentID, componentDictionary))
    }
    let metadataKeys: Set<String> = ["id", "component", "catalogId", "components"]
    var components: [ComponentModel] = []
    for (fallbackID, definition) in definitions {
      guard let type = definition["component"]?.stringValue else {
        Issue.record("[\(testCase.name)] Component '\(fallbackID)' has no component type")
        continue
      }
      components.append(
        ComponentModel(
          id: definition["id"]?.stringValue ?? fallbackID,
          type: type,
          catalogID: definition["catalogId"]?.stringValue,
          properties: definition.filter { !metadataKeys.contains($0.key) }
        )
      )
    }
    surface.componentsModel.applyBatch(adding: components)
    return surface
  }

  /// Compares every expectation of `expectedTree` with the resolved surface and returns how many
  /// fields it compared.
  private func check(
    _ expectedTree: OrderedDictionary<String, JSONValue>,
    on surface: SurfaceViewModel,
    testCase: ConformanceTestCase
  ) throws -> Int {
    guard surface.rootNode != nil else {
      Issue.record("[\(testCase.name)] The surface resolved no tree")
      return 0
    }
    var checkedFields = 0
    for (componentID, expectedNode) in expectedTree {
      guard let expectedFields = expectedNode.objectValue else {
        Issue.record("[\(testCase.name)] Expectation for '\(componentID)' is not an object")
        continue
      }
      checkedFields += try checkComponentFields(
        componentID: componentID,
        expectedFields: expectedFields,
        on: surface,
        testCase: testCase
      )
    }
    return checkedFields
  }

  private func checkComponentFields(
    componentID: String,
    expectedFields: OrderedDictionary<String, JSONValue>,
    on surface: SurfaceViewModel,
    testCase: ConformanceTestCase
  ) throws -> Int {
    guard
      let node = surface.findNode(id: componentID)
        ?? resolveDetached(componentID: componentID, on: surface)
    else {
      Issue.record("[\(testCase.name)] Component '\(componentID)' could not be resolved")
      return 0
    }
    let attributes = node.accessibilityAttributes
    var checkedFields = 0
    for (field, expectedShape) in expectedFields {
      guard !Self.rendererOnlyFields.contains(field) else { continue }
      let actual = try actualFieldValue(
        field: field,
        attributes: attributes,
        componentID: componentID,
        testName: testCase.name
      )
      guard
        let expected = try resolveExpectation(
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
    return checkedFields
  }

  private func actualFieldValue(
    field: String,
    attributes: AccessibilityAttributes?,
    componentID: String,
    testName: String
  ) throws -> JSONValue? {
    switch field {
    case "label": return attributes?.label.map(JSONValue.string)
    case "description": return attributes?.description.map(JSONValue.string)
    case "live": return attributes?.live.map(JSONValue.string)
    case "hidden": return attributes?.hidden.map(JSONValue.boolean)
    default:
      Issue.record("[\(testName)] Unhandled field '\(field)' for '\(componentID)'")
      throw UnknownConformanceKeyError(
        "[\(testName)] Unhandled field '\(field)' for '\(componentID)'"
      )
    }
  }

  /// Returns the value an expectation stands for: a string or a boolean as is, or the data model
  /// value at the path of a `{path}` or `{"@path"}` reference. Throws for any other shape, and
  /// records an issue and returns `nil` for a reference to a path that has no value.
  private func resolveExpectation(
    _ shape: JSONValue,
    dataModel: DataModel,
    context: String
  ) throws -> JSONValue? {
    switch shape {
    case .string, .boolean:
      return shape
    default:
      guard let path = referencedPath(in: shape) else {
        Issue.record("\(context): unhandled expectation shape \(shape)")
        throw UnknownConformanceKeyError("\(context): unhandled expectation shape \(shape)")
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

  /// A value of the field's type that differs across paths and from one round to the next.
  ///
  /// Two-state values alternate with the path's `index`, so two paths bound to the same field
  /// get different values in each round and a component bound to the wrong one fails.
  private func sampleValue(
    for field: String,
    path: String,
    index: Int,
    round: Int,
    testName: String
  ) throws -> JSONValue {
    let isEvenStep = (round + index).isMultiple(of: 2)
    switch field {
    case "label", "description": return .string("\(field) \(path) \(round)")
    case "live": return .string(isEvenStep ? "polite" : "assertive")
    case "hidden": return .boolean(isEvenStep)
    default:
      Issue.record("[\(testName)] No sample value for field '\(field)' bound to '\(path)'")
      throw UnknownConformanceKeyError(
        "[\(testName)] No sample value for field '\(field)' bound to '\(path)'"
      )
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
}
