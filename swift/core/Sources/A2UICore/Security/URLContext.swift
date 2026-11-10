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

/// How a renderer uses a URL, which decides the rules the URL is checked against.
public enum URLContext: String, CaseIterable, Hashable, Sendable {
  /// Loaded automatically without a user action, such as an image, video, or audio source.
  case media
  /// Opened when the user acts, such as a link or the `openUrl` function.
  case navigation
  /// Embedded in a frame.
  case iframe
}
