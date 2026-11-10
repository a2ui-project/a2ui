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

/// Raised when component relationships contain cycles or exceed depth limits.
public final class A2UIRecursionError: A2UIValidationError, @unchecked Sendable {
  /// Creates a recursion error with an optional list of structured details.
  public override init(_ message: String, details: [A2UIErrorDetail] = []) {
    super.init(message, details: details)
  }
}
