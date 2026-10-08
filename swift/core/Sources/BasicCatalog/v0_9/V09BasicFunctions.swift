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

/// Standard function implementations for the A2UI v0.9 and v0.9.1 Basic Catalog.
public enum V09BasicFunctions: Sendable {
  /// Standard function implementations for A2UI Protocol v0.9 and v0.9.1.
  public static let allFunctions: [any FunctionImplementation] = [
    AndFunction(),
    EmailFunction(returnValidationResult: false),
    FormatCurrencyFunction(),
    FormatDateFunction(),
    FormatNumberFunction(),
    FormatStringFunction(),
    LengthFunction(returnValidationResult: false),
    NotFunction(),
    NumericFunction(returnValidationResult: false),
    OpenURLFunction(),
    OrFunction(),
    PluralizeFunction(),
    RegexFunction(returnValidationResult: false),
    RequiredFunction(returnValidationResult: false),
  ]
}
