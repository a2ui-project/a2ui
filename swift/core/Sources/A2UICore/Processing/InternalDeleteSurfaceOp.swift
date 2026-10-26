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

/// Version-neutral internal operation for deleting an active surface.
public struct InternalDeleteSurfaceOp: Sendable, Equatable {
  public let surfaceID: String

  /// Blueprint-compatible camelCase alias for `surfaceID`.
  public var surfaceId: String { surfaceID }

  public init(surfaceID: String) {
    self.surfaceID = surfaceID
  }
}
