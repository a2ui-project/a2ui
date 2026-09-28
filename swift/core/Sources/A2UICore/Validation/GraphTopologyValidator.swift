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

import OrderedCollections
import OrderedJSON

/// Validates component graph topology, hierarchy completeness, and structural cycles.
public enum GraphTopologyValidator {
  private static let maxGlobalDepth = 50

  public typealias Reference = (referenceID: String, field: String)
  public typealias AdjacencyMap = [String: [Reference]]

  /// Validates the topology and integrity of a list of component JSON objects.
  ///
  /// - Parameters:
  ///   - components: The component JSON dictionaries to validate.
  ///   - rootID: The expected root component ID (default "root").
  ///   - config: The validation configuration controlling strictness.
  /// - Throws: `A2UIIntegrityError` or `A2UIRecursionError` on structural violations.
  public static func validate(
    components: [[String: JSONValue]],
    rootID: String = "root",
    config: ValidationConfig = .strict
  ) throws {
    let (allComponentIDs, adjacencyList) = try buildAdjacencyMap(from: components)

    try validateRootPresence(allIDs: allComponentIDs, rootID: rootID, config: config)
    try validateNoDanglingReferences(
      components: components,
      allIDs: allComponentIDs,
      adjacencyList: adjacencyList,
      config: config
    )
    try validateCyclesAndReachability(
      allIDs: allComponentIDs,
      adjacencyList: adjacencyList,
      rootID: rootID,
      config: config
    )
  }

  private static func buildAdjacencyMap(
    from components: [[String: JSONValue]]
  ) throws -> (allIDs: Set<String>, adjacencyList: AdjacencyMap) {
    var allComponentIDs: Set<String> = []
    var adjacencyList: AdjacencyMap = [:]

    for component in components {
      guard let componentID = component["id"]?.stringValue else { continue }
      if allComponentIDs.contains(componentID) {
        throw A2UIIntegrityError("Duplicate component ID: \(componentID)")
      }
      allComponentIDs.insert(componentID)
      adjacencyList[componentID] = []

      let references = extractReferences(from: component)
      for reference in references {
        if reference.referenceID == componentID {
          throw A2UIRecursionError(
            """
            Self-reference detected: Component '\(componentID)' \
            references itself in field '\(reference.field)'
            """
          )
        }
        adjacencyList[componentID, default: []].append(reference)
      }
    }
    return (allComponentIDs, adjacencyList)
  }

  private static func validateRootPresence(
    allIDs: Set<String>,
    rootID: String,
    config: ValidationConfig
  ) throws {
    if !config.allowMissingRoot && !allIDs.contains(rootID) {
      throw A2UIIntegrityError("Missing root component: No component has id='\(rootID)'")
    }
  }

  private static func validateNoDanglingReferences(
    components: [[String: JSONValue]],
    allIDs: Set<String>,
    adjacencyList: AdjacencyMap,
    config: ValidationConfig
  ) throws {
    guard !config.allowDanglingReferences else { return }

    for component in components {
      guard let componentID = component["id"]?.stringValue else { continue }
      for reference in adjacencyList[componentID] ?? [] {
        if !allIDs.contains(reference.referenceID) {
          throw A2UIIntegrityError(
            """
            Component '\(componentID)' references non-existent component \
            '\(reference.referenceID)' in field '\(reference.field)'
            """
          )
        }
      }
    }
  }

  private static func validateCyclesAndReachability(
    allIDs: Set<String>,
    adjacencyList: AdjacencyMap,
    rootID: String,
    config: ValidationConfig
  ) throws {
    var visited: Set<String> = []
    var recursionStack: Set<String> = []

    func depthFirstSearch(nodeID: String, depth: Int) throws {
      if depth > maxGlobalDepth {
        throw A2UIRecursionError(
          "Global recursion limit exceeded: logical depth > \(maxGlobalDepth)"
        )
      }
      visited.insert(nodeID)
      recursionStack.insert(nodeID)

      for reference in adjacencyList[nodeID] ?? [] {
        let neighbor = reference.referenceID
        if !visited.contains(neighbor) {
          if allIDs.contains(neighbor) {
            try depthFirstSearch(nodeID: neighbor, depth: depth + 1)
          }
        } else if recursionStack.contains(neighbor) {
          throw A2UIRecursionError(
            "Circular reference detected involving component '\(neighbor)'"
          )
        }
      }
      recursionStack.remove(nodeID)
    }

    if config.allowMissingRoot {
      for nodeID in allIDs.sorted() {
        if !visited.contains(nodeID) {
          try depthFirstSearch(nodeID: nodeID, depth: 0)
        }
      }
    } else if allIDs.contains(rootID) {
      try depthFirstSearch(nodeID: rootID, depth: 0)

      if !config.allowOrphanComponents {
        let orphans = allIDs.subtracting(visited)
        if let firstOrphan = orphans.sorted().first {
          throw A2UIIntegrityError("Component '\(firstOrphan)' is not reachable from '\(rootID)'")
        }
      }
    }
  }

  /// Extracts component reference pointers from a component property dictionary.
  public static func extractReferences(
    from component: [String: JSONValue]
  ) -> [Reference] {
    var references: [Reference] = []

    for (key, propertyValue) in component
    where key != "id" && key != "component" && key != "catalogId" {
      collectReferences(from: propertyValue, path: key, into: &references)
    }
    return references
  }

  private static func collectReferences(
    from value: JSONValue,
    path: String,
    into result: inout [Reference]
  ) {
    switch value {
    case .string(let stringValue):
      let lowercasedPath = path.lowercased()
      if lowercasedPath.hasSuffix("child") || lowercasedPath.hasSuffix("componentid") {
        result.append((stringValue, path))
      }

    case .array(let array):
      for (index, item) in array.enumerated() {
        if let stringValue = item.stringValue {
          let lowercasedPath = path.lowercased()
          if lowercasedPath.contains("child") {
            result.append((stringValue, path))
          }
        } else {
          collectReferences(from: item, path: "\(path)[\(index)]", into: &result)
        }
      }

    case .object(let dictionary):
      if let componentID = dictionary["componentId"]?.stringValue {
        result.append((componentID, "\(path).componentId"))
      } else {
        for (key, propertyValue) in dictionary {
          collectReferences(from: propertyValue, path: "\(path).\(key)", into: &result)
        }
      }

    default:
      break
    }
  }
}
