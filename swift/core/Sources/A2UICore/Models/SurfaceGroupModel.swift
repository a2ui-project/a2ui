// Copyright 2026 Google LLC
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
/// `SurfaceGroupModel` owns the surface dictionary, lifecycle
/// (add/remove), and cross-surface aggregation such as
/// `sendDataModel` tracking. It mirrors the `SurfaceGroupModel` type
/// in the `web_core` reference implementation.
public final class SurfaceGroupModel: @unchecked Sendable, ObservableObject {
  private let lock = NSRecursiveLock()
  private var _surfaces: [String: SurfaceViewModel] = [:]

  /// The dictionary of active surfaces, published to the UI on the
  /// Main Thread.
  @Published public private(set) var surfacesMap: [String: SurfaceViewModel] = [:]

  /// A thread-safe snapshot of all active surfaces.
  public var surfaces: [String: SurfaceViewModel] {
    lock.withLock { _surfaces }
  }

  public init() {}

  // MARK: - Surface Lifecycle

  /// Adds a surface to the group.
  ///
  /// If a surface with the same ID already exists, the call is
  /// silently ignored (matching `web_core`'s behavior).
  public func addSurface(_ vm: SurfaceViewModel) {
    lock.withLock {
      guard _surfaces[vm.surfaceID] == nil else { return }
      _surfaces[vm.surfaceID] = vm
      publishSnapshot()
    }
  }

  /// Removes a surface from the group by its ID.
  public func removeSurface(id: String) {
    lock.withLock {
      guard _surfaces[id] != nil else { return }
      _surfaces.removeValue(forKey: id)
      publishSnapshot()
    }
  }

  // MARK: - Private

  private func publishSnapshot() {
    let snapshot = surfaces
    DispatchQueue.main.async { [weak self] in
      self?.surfacesMap = snapshot
    }
  }
}
