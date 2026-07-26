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

import JSONSchema

/// The framework-agnostic definition of a UI component.
///
/// Pairs a component name (as it appears in A2UI JSON) with the
/// JSON Schema that validates the component's properties.
/// Mirrors `ComponentApi` in the core blueprint.
public struct ComponentAPI: Sendable, Equatable {
  /// The component name as it appears in A2UI JSON (e.g., "Button").
  public var name: String

  /// The compiled JSON Schema used for validation and capability
  /// generation.
  public var schema: Schema

  public init(name: String, schema: Schema) {
    self.name = name
    self.schema = schema
  }
}
