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
    var allComponentIDs: Set<String> = []
    var adjacencyList: [String: [(referenceID: String, field: String)]] = [:]

    // 1. Check for duplicate IDs and build adjacency list
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
            "Self-reference detected: Component '\(componentID)' references itself in field '\(reference.field)'"
          )
        }
        adjacencyList[componentID, default: []].append(reference)
      }
    }

    // 2. Check for missing root component
    if !config.allowMissingRoot && !allComponentIDs.contains(rootID) {
      throw A2UIIntegrityError("Missing root component: No component has id='\(rootID)'")
    }

    // 3. Check for dangling references (references to missing IDs)
    if !config.allowDanglingReferences {
      for component in components {
        guard let componentID = component["id"]?.stringValue else { continue }
        for reference in adjacencyList[componentID] ?? [] {
          if !allComponentIDs.contains(reference.referenceID) {
            throw A2UIIntegrityError(
              "Component '\(componentID)' references non-existent component '\(reference.referenceID)' in field '\(reference.field)'"
            )
          }
        }
      }
    }

    // 4. DFS Cycle Detection and Depth Limits
    var visited: Set<String> = []
    var recursionStack: Set<String> = []

    func depthFirstSearch(nodeID: String, depth: Int) throws {
      if depth > maxGlobalDepth {
        throw A2UIRecursionError(
          "Global recursion limit exceeded: logical depth > \(maxGlobalDepth)")
      }
      visited.insert(nodeID)
      recursionStack.insert(nodeID)

      for reference in adjacencyList[nodeID] ?? [] {
        let neighbor = reference.referenceID
        if !visited.contains(neighbor) {
          if allComponentIDs.contains(neighbor) {
            try depthFirstSearch(nodeID: neighbor, depth: depth + 1)
          }
        } else if recursionStack.contains(neighbor) {
          throw A2UIRecursionError("Circular reference detected involving component '\(neighbor)'")
        }
      }
      recursionStack.remove(nodeID)
    }

    if config.allowMissingRoot {
      for nodeID in allComponentIDs.sorted() {
        if !visited.contains(nodeID) {
          try depthFirstSearch(nodeID: nodeID, depth: 0)
        }
      }
    } else if allComponentIDs.contains(rootID) {
      try depthFirstSearch(nodeID: rootID, depth: 0)

      if !config.allowOrphanComponents {
        let orphans = allComponentIDs.subtracting(visited)
        if let firstOrphan = orphans.sorted().first {
          throw A2UIIntegrityError("Component '\(firstOrphan)' is not reachable from '\(rootID)'")
        }
      }
    }
  }

  /// Extracts component reference pointers from a component property dictionary.
  public static func extractReferences(
    from component: [String: JSONValue]
  ) -> [(referenceID: String, field: String)] {
    var references: [(referenceID: String, field: String)] = []

    for (key, propertyValue) in component
    where key != "id" && key != "component" && key != "catalogId" {
      collectReferences(from: propertyValue, path: key, into: &references)
    }
    return references
  }

  private static func collectReferences(
    from value: JSONValue,
    path: String,
    into result: inout [(referenceID: String, field: String)]
  ) {
    switch value {
    case .string(let stringValue):
      // Only treat string as reference if field path suggests child/componentId link
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
