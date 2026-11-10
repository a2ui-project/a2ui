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

/// Applies a ``URLSecurityPolicy`` in the order every SDK uses: the baseline, then the policy,
/// then the baseline again on a URL the policy rewrote.
///
/// Components and functions call `sanitizeURL` on ``SurfaceViewModel`` or ``DataContext``
/// instead, which also report blocked URLs.
enum URLPolicyEvaluator {
  /// Checks `url` with the baseline, `policy`, and the baseline again on a rewritten URL.
  ///
  /// - Returns: The URL to use, or `nil` when it is blocked.
  static func apply(
    _ policy: any URLSecurityPolicy,
    to url: String,
    context: URLContext,
    info: URLCheckInfo?
  ) -> String? {
    let allowSVG = policy.allowSVGDataURLs
    guard URLBaseline.check(url, context: context, allowSVGDataURLs: allowSVG) != nil,
      let result = policy.sanitizeURL(url, context: context, info: info)
    else {
      return nil
    }
    return result == url
      ? result : URLBaseline.check(result, context: context, allowSVGDataURLs: allowSVG)
  }
}
