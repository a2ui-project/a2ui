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
import OrderedJSON

/// Helper for creating a ``JSONSchema.Context`` pre-populated with
/// A2UI common type schemas.
public enum A2UISchemaRegistry {
  /// Creates a ``Context`` with A2UI common type schemas registered.
  ///
  /// The returned context has A2UI v0.9.1 common types available for
  /// `$ref` resolution. Use it when constructing ``Schema`` instances
  /// that reference A2UI common types.
  ///
  /// - Returns: A `Context` with all A2UI common types registered.
  public static func makeContext() -> Context {
    Context(
      dialect: .draft2020_12,
      remoteSchema: A2UICommonSchema.allSchemas
    )
  }
}
