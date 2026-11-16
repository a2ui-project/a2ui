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
///
/// A ``A2UIButton`` in the trigger opens the sheet from its own action, so a tap, a VoiceOver
/// activation, and a keyboard activation all open it, and none does while the button is disabled.
/// Any other trigger opens it on a tap or its default accessibility action, unless one of the
/// trigger's checks fails.
public struct A2UIModal: View {
  public let node: Node

  @State private var isPresented = false

  /// Whether a control in the trigger reported that it opens the sheet from its own action.
  @State private var triggerOpensSheet = false

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
          .environment(\.a2uiModalTriggerAction, { isPresented = true })
          .onPreferenceChange(A2UIModalTriggerHandledKey.self) { handled in
            // SwiftUI delivers preference changes on the main thread.
            MainActor.assumeIsolated {
              if triggerOpensSheet != handled {
                triggerOpensSheet = handled
              }
            }
          }
          .modifier(
            ModalTriggerFallback(isEnabled: !triggerOpensSheet) {
              if triggerNode.isValid {
                isPresented = true
              }
            }
          )
      }
    }
    // A nested Modal's trigger must not affect this one.
    .transformPreference(A2UIModalTriggerHandledKey.self) { $0 = false }
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
      // A sheet inherits the presenter's environment. When this Modal sits in another Modal's
      // trigger, a Button in this content must not open that other Modal.
      .environment(\.a2uiModalTriggerAction, nil)
    }
  }
}

/// Opens the sheet on a tap or the default accessibility action of a trigger that has no control
/// opening it from its own action.
private struct ModalTriggerFallback: ViewModifier {
  let isEnabled: Bool
  let open: () -> Void

  func body(content: Content) -> some View {
    if isEnabled {
      content
        // Makes the whole trigger frame tappable, including empty space in a layout container.
        .contentShape(Rectangle())
        .simultaneousGesture(TapGesture().onEnded(open))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { open() }
    } else {
      content
    }
  }
}
