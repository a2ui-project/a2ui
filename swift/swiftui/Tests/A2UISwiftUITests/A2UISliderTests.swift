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
import A2UISwiftUI
import BasicCatalog
import BasicCatalogSwiftUI
import Testing

@MainActor
struct A2UISliderTests {

  @Test func stepValueDividesRangeIntoSteps() throws {
    let node = Node(
      id: "s1",
      type: "Slider",
      properties: ["min": 1, "max": 7, "steps": 6]
    )
    #expect(try #require(A2UISlider(componentNode: ComponentNode(node: node)).stepValue) == 1)
  }

  @Test func stepValueIsNilForInvalidSteps() {
    let invalid: [Node] = [
      Node(id: "s2", type: "Slider", properties: ["min": 0, "max": 100]),
      Node(id: "s3", type: "Slider", properties: ["min": 0, "max": 100, "steps": 0]),
      Node(id: "s4", type: "Slider", properties: ["min": 0, "max": 100, "steps": -3]),
      Node(id: "s5", type: "Slider", properties: ["min": 50, "max": 50, "steps": 4]),
      Node(
        id: "s6", type: "Slider",
        properties: ["min": 0, "max": Double.leastNormalMagnitude, "steps": Int.max]),
    ]
    for node in invalid {
      #expect(A2UISlider(componentNode: ComponentNode(node: node)).stepValue == nil)
    }
  }
}
