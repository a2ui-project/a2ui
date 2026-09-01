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

struct AccessibilityConformanceTests {
  @Test @MainActor
  func accessibilityConformance() throws {
    let rawYaml = try ConformanceTestHelper.loadYAML(filename: "core/accessibility.yaml")
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYaml)

    #expect(!testCases.isEmpty, "Should find test cases in accessibility.yaml")

    for testCase in testCases {
      guard let surfaceDictionary = testCase.surface else { continue }
      let assertions = testCase.assertions?["accessibility_tree"]?.objectValue ?? [:]

      let rootComponentType = surfaceDictionary["component"]?.stringValue ?? "Column"
      let rootID = surfaceDictionary["id"]?.stringValue ?? "root"

      var componentsList: [ComponentModel] = []

      var rootProperties: [String: JSONValue] = [:]
      for (key, propertyValue) in surfaceDictionary
      where key != "id" && key != "component" && key != "components" {
        rootProperties[key] = propertyValue
      }
      componentsList.append(
        ComponentModel(id: rootID, type: rootComponentType, properties: rootProperties)
      )

      if let nestedComponents = surfaceDictionary["components"]?.objectValue {
        for (componentID, componentDefinitionValue) in nestedComponents {
          guard let componentDefinition = componentDefinitionValue.objectValue else { continue }
          let componentType = componentDefinition["component"]?.stringValue ?? "Text"
          var componentProperties: [String: JSONValue] = [:]
          for (key, propertyValue) in componentDefinition
          where key != "id" && key != "component" {
            componentProperties[key] = propertyValue
          }
          componentsList.append(
            ComponentModel(id: componentID, type: componentType, properties: componentProperties)
          )
        }
      }

      let surfaceViewModel = SurfaceViewModel(
        surfaceID: "accessibility-surface",
        catalog: AnyCatalog(id: "std", components: [])
      )

      for component in componentsList {
        surfaceViewModel.componentsModel.addComponent(component)
      }

      for (targetComponentID, expectedTreeObject) in assertions {
        guard let expectedDictionary = expectedTreeObject.objectValue else { continue }
        guard let componentModel = surfaceViewModel.componentsModel.get(targetComponentID) else {
          Issue.record(
            "[\(testCase.name)] Component '\(targetComponentID)' not found in components model")
          continue
        }

        var resolvedProperties: [String: any Resolved] = [:]
        for (key, propertyValue) in componentModel.properties {
          if let stringValue = propertyValue.stringValue {
            resolvedProperties[key] = stringValue
          } else if let booleanValue = propertyValue.boolValue {
            resolvedProperties[key] = booleanValue
          } else {
            resolvedProperties[key] = propertyValue
          }
        }

        let node = Node(
          id: targetComponentID,
          type: componentModel.type,
          properties: resolvedProperties
        )
        let accessibilityAttributes = node.accessibilityAttributes

        if let expectedLabel = expectedDictionary["label"]?.stringValue {
          #expect(
            accessibilityAttributes?.label == expectedLabel,
            """
            [\(testCase.name)] Expected label '\(expectedLabel)' for '\(targetComponentID)', \
            got '\(accessibilityAttributes?.label ?? "")'
            """
          )
        }

        if let expectedDescription = expectedDictionary["description"]?.stringValue {
          #expect(
            accessibilityAttributes?.description == expectedDescription,
            """
            [\(testCase.name)] Expected description '\(expectedDescription)' for \
            '\(targetComponentID)', got '\(accessibilityAttributes?.description ?? "")'
            """
          )
        }

        if let expectedLive = expectedDictionary["live"]?.stringValue {
          #expect(
            accessibilityAttributes?.live == expectedLive,
            """
            [\(testCase.name)] Expected live '\(expectedLive)' for '\(targetComponentID)', \
            got '\(accessibilityAttributes?.live ?? "")'
            """
          )
        }

        if let expectedHidden = expectedDictionary["hidden"]?.boolValue {
          #expect(
            accessibilityAttributes?.hidden == expectedHidden,
            """
            [\(testCase.name)] Expected hidden '\(expectedHidden)' for '\(targetComponentID)', \
            got '\(accessibilityAttributes?.hidden == true)'
            """
          )
        }
      }
    }
  }
}
