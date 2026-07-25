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

import OrderedJSON

/// Conformances to `Resolved` for primitive types that are safe to pass
/// across threads as resolved property values.
extension String: Resolved {}
extension Double: Resolved {}
extension Int: Resolved {}
extension Bool: Resolved {}
extension JSONValue: Resolved {}

/// Arrays of `Node` are `Resolved` when their elements are.
extension Array: Resolved where Element == Node {}
