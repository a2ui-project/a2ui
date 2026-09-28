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
import OrderedJSON
import SwiftUI

// MARK: - Component Implementation

@MainActor
extension BasicCatalogImplementation {
  public static let modal = ComponentImplementation(api: BasicCatalogComponents.modal) { node in
    A2UIModal(node: node)
  }
}

// MARK: - View

/// SwiftUI component view for the A2UI Basic Catalog `Modal` component.
public struct A2UIModal: View {
  public let node: Node

  @State private var isPresented = false

  public init(node: Node) {
    self.node = node
  }

  private var triggerNode: Node? {
    node.child(for: "trigger")
  }

  private var contentNode: Node? {
    node.child(for: "content")
  }

  public var body: some View {
    Group {
      if let triggerNode {
        ComponentNodeView(node: triggerNode)
          .simultaneousGesture(
            TapGesture().onEnded {
              isPresented = true
            }
          )
      }
    }
    .sheet(isPresented: $isPresented) {
      NavigationStack {
        ScrollView {
          if let contentNode {
            ComponentNodeView(node: contentNode)
              .padding()
          }
        }
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Close") {
              isPresented = false
            }
          }
        }
      }
    }
  }
}
