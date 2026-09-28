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
import OrderedJSON
import SwiftUI
import Testing

struct ThemeEnvironmentTests {

  @Test func themeKeyDefaultValueIsNil() {
    #expect(A2UIThemeKey.defaultValue == nil)
  }

  @Test func themeEnvironmentCanBeSet() throws {
    let theme: [String: JSONValue] = ["color": .string("blue")]
    var environment = EnvironmentValues()
    environment.a2uiTheme = theme
    #expect(environment.a2uiTheme != nil)
    #expect(environment.a2uiTheme?["color"]?.stringValue == "blue")
  }

  @Test func themeEnvironmentDefaultsToNil() {
    let environment = EnvironmentValues()
    #expect(environment.a2uiTheme == nil)
  }
}
