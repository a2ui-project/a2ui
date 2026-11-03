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
import Testing

/// Runs the shared `conformance/core/thinking.yaml` suite against
/// `removeA2UIThinking`.
struct ThinkingConformanceTests {
  @Test func thinkingConformance() throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: "core/thinking.yaml")
    let cases = (rawYAML as? [[String: Any]]) ?? []
    #expect(!cases.isEmpty, "core/thinking.yaml should hold test cases")

    for testCase in cases {
      let name = testCase["name"] as? String ?? "unnamed case"
      #expect(testCase["action"] as? String == "remove_a2ui_thinking", "\(name)")
      guard let input = testCase["input"] as? String,
        let expected = testCase["expect"] as? String
      else {
        Issue.record("\(name): missing input or expect")
        continue
      }
      #expect(removeA2UIThinking(input) == expected, "\(name)")
    }
  }
}
