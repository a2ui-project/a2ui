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

/// Protocol for handling user actions and errors sent from the client
/// to the server.
public protocol ActionHandling: AnyObject, Sendable {
  /// Handles a resolved action triggered by the client.
  ///
  /// - Parameters:
  ///   - action: The resolved action to handle.
  ///   - surfaceID: The ID of the surface that triggered the action.
  func handle(action: ResolvedAction, from surfaceID: String)

  /// Handles a client-side or validation error.
  ///
  /// - Parameters:
  ///   - error: The error to handle.
  ///   - surfaceID: The ID of the surface that produced the error.
  func handle(error: ClientServerError, from surfaceID: String)
}
