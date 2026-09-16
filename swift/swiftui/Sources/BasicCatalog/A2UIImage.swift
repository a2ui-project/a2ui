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
  public static let image = ComponentImplementation(api: BasicCatalogComponents.image) { node in
    A2UIImage(node: node)
  }
}

// MARK: - View

/// SwiftUI component view for the A2UI Basic Catalog `Image` component.
public struct A2UIImage: View {
  public let node: Node

  public init(node: Node) {
    self.node = node
  }

  private var urlString: String {
    node.string(for: "url") ?? ""
  }

  private var imageDescription: String {
    node.string(for: "description") ?? ""
  }

  private var fit: String {
    node.string(for: "fit") ?? "fill"
  }

  private var variant: String {
    node.string(for: "variant") ?? "mediumFeature"
  }

  public var body: some View {
    if let url = URL(string: urlString), !urlString.isEmpty {
      AsyncImage(url: url) { phase in
        switch phase {
        case .empty:
          ProgressView()
            .frame(maxWidth: .infinity, minHeight: placeholderHeight)
        case .success(let image):
          applyVariantSizing(image: image)
        case .failure:
          Image(systemName: "photo")
            .font(.largeTitle)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: placeholderHeight)
            .background(Color.gray.opacity(0.15))
        @unknown default:
          EmptyView()
        }
      }
      .accessibilityLabel(imageDescription.isEmpty ? "Image" : imageDescription)
    } else {
      Image(systemName: "photo")
        .font(.largeTitle)
        .foregroundStyle(.secondary)
        .frame(minWidth: 40, minHeight: 40)
    }
  }

  @ViewBuilder
  private func applyVariantSizing(image: Image) -> some View {
    let resizable = image.resizable()

    switch variant {
    case "icon":
      resizable
        .aspectRatio(contentMode: contentMode)
        .frame(width: 24, height: 24)
        .clipped()

    case "avatar":
      resizable
        .aspectRatio(contentMode: .fill)
        .frame(width: 40, height: 40)
        .clipShape(Circle())

    case "smallFeature":
      resizable
        .aspectRatio(contentMode: contentMode)
        .frame(maxWidth: 100, maxHeight: 100)
        .clipped()

    case "largeFeature":
      resizable
        .aspectRatio(contentMode: contentMode)
        .frame(maxWidth: .infinity)
        .frame(maxHeight: 400)
        .clipped()

    case "header":
      resizable
        .aspectRatio(contentMode: .fill)
        .frame(maxWidth: .infinity)
        .frame(height: 200)
        .clipped()

    default:  // mediumFeature
      resizable
        .aspectRatio(contentMode: contentMode)
        .frame(maxWidth: .infinity)
        .clipped()
    }
  }

  private var contentMode: ContentMode {
    switch fit {
    case "contain", "scaleDown": return .fit
    case "cover": return .fill
    default: return .fill
    }
  }

  private var placeholderHeight: CGFloat {
    switch variant {
    case "icon": return 24
    case "avatar": return 40
    case "smallFeature": return 100
    case "header": return 200
    case "largeFeature": return 300
    default: return 200
    }
  }
}
