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
import SwiftUI

/// Provides SwiftUI `Binding` access to `DataBinding` values.
///
/// This extension bridges A2UI's thread-safe `DataBinding` to
/// SwiftUI's `Binding` for use in form controls and other two-way
/// bound views.
@MainActor
extension DataBinding {
  /// A SwiftUI `Binding` backed by this `DataBinding`.
  public var swiftUIBinding: Binding<Value?> {
    Binding(
      get: {
        self.value
      },
      set: { newValue in
        if let newValue {
          self.set(newValue)
        }
      }
    )
  }

  /// A SwiftUI `Binding` backed by this `DataBinding` with a fallback default value.
  public func swiftUIBinding(default defaultValue: Value) -> Binding<Value> {
    Binding(
      get: {
        self.value ?? defaultValue
      },
      set: { newValue in
        self.set(newValue)
      }
    )
  }
}

@MainActor
extension DataBinding where Value == String {
  /// A non-optional SwiftUI `Binding<String>` defaulting to empty string if `value` is nil.
  public var stringBinding: Binding<String> {
    swiftUIBinding(default: "")
  }
}

@MainActor
extension DataBinding where Value == Bool {
  /// A non-optional SwiftUI `Binding<Bool>` defaulting to false if `value` is nil.
  public var boolBinding: Binding<Bool> {
    swiftUIBinding(default: false)
  }
}

@MainActor
extension DataBinding where Value == Double {
  /// A non-optional SwiftUI `Binding<Double>` defaulting to 0.0 if `value` is nil.
  public var doubleBinding: Binding<Double> {
    swiftUIBinding(default: 0.0)
  }
}

// MARK: - Node SwiftUI Binding Accessors

@MainActor
extension Node {
  /// Returns a two-way SwiftUI `Binding<Value>` for the given property key,
  /// falling back to `defaultValue` if the binding is unset or missing.
  public func binding<Value: Sendable & Equatable>(
    for key: String,
    default defaultValue: Value
  ) -> Binding<Value> {
    if let dataBinding = properties[key] as? DataBinding<Value> {
      return dataBinding.swiftUIBinding(default: defaultValue)
    }
    return .constant(defaultValue)
  }

  /// Returns a SwiftUI `Binding<Value?>` for the given property key,
  /// evaluating to `nil` if the binding is unset or missing.
  public func optionalBinding<Value: Sendable & Equatable>(
    for key: String
  ) -> Binding<Value?> {
    if let dataBinding = properties[key] as? DataBinding<Value> {
      return dataBinding.swiftUIBinding
    }
    return .constant(nil)
  }
}
