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
import SwiftUI

/// The root SwiftUI view for a single A2UI surface.
///
/// `Surface` observes a ``SurfaceViewModel`` and renders the resolved
/// component tree using registered component view builders from the active
/// ``ComponentRegistry``. The active theme and component registry are
/// propagated through the environment.
public struct Surface: View {
  @ObservedObject public var viewModel: SurfaceViewModel

  public let registry: ComponentRegistry?
  public let surfaceID: String

  public init(
    viewModel: SurfaceViewModel,
    registry: ComponentRegistry? = nil
  ) {
    self.viewModel = viewModel
    self.registry = registry
    self.surfaceID = viewModel.surfaceID
  }

  public var body: some View {
    if let rootNode = viewModel.rootNode {
      ComponentNodeView(node: rootNode)
        .environment(\.a2uiTheme, viewModel.theme)
        .environment(\.a2uiComponentRegistry, registry)
    } else {
      ProgressView()
    }
  }
}
