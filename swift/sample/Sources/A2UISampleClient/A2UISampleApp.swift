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

import A2UICore
import A2UISwiftUI
import SwiftUI

// Minimal @main entry point for the A2UI sample iOS client app.
// Will be expanded in a future PR with full demo scenario.

@main
struct A2UISampleApp: App {
  var body: some Scene {
    WindowGroup {
      ContentView()
    }
  }
}

struct ContentView: View {
  var body: some View {
    VStack {
      Text("A2UI Sample Client")
        .font(.headline)
      Text("Full demo coming soon")
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }
    .padding()
  }
}
