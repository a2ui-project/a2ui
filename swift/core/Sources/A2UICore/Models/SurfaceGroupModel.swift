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

import Combine
import Foundation
import OrderedCollections
import OrderedJSON

/// The root state model managing the collection of active surfaces.
///
/// `SurfaceGroupModel` owns the surface dictionary and surface lifecycle
/// (add/remove). It mirrors the `SurfaceGroupModel` type in the `web_core`
/// reference implementation.
@MainActor
public final class SurfaceGroupModel: ObservableObject {
  /// The map of active surfaces, published to the UI.
  @Published public private(set) var surfacesMap: [String: SurfaceViewModel] = [:]

  public init() {}

  // MARK: - Surface Lifecycle

  /// Adds a surface to the group.
  ///
  /// If a surface with the same ID already exists, the call is
  /// silently ignored (matching `web_core`'s behavior).
  public func addSurface(_ vm: SurfaceViewModel) {
    guard surfacesMap[vm.surfaceID] == nil else { return }
    surfacesMap[vm.surfaceID] = vm
  }

  /// Removes a surface from the group by its ID.
  public func removeSurface(id: String) {
    guard surfacesMap[id] != nil else { return }
    surfacesMap.removeValue(forKey: id)
  }

  // MARK: - Surface Lookup

  /// Retrieves a surface by its ID.
  public func surface(id: String) -> SurfaceViewModel? {
    surfacesMap[id]
  }

  /// Returns a snapshot of all active surfaces.
  public func allSurfaces() -> [String: SurfaceViewModel] {
    surfacesMap
  }

  // MARK: - Data Model Aggregation

  /// Aggregates the data models of all surfaces that have
  /// `sendDataModel` enabled.
  ///
  /// Returns `nil` if no surfaces have the flag set.
  public func getClientDataModel() -> JSONValue? {
    var result: OrderedDictionary<String, JSONValue> = [:]
    for (surfaceID, vm) in surfacesMap {
      if vm.sendDataModel {
        result[surfaceID] = vm.dataModel.data
      }
    }
    guard !result.isEmpty else { return nil }
    return .object(result)
  }
}
