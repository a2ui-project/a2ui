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

  /// How the image is resized to fit its frame, resolved from the `fit` and `variant` properties.
  public var fit: Fit {
    Fit(property: node.string(for: "fit"), variant: variant)
  }

  private var variant: String {
    node.string(for: "variant") ?? "mediumFeature"
  }

  public var body: some View {
    if let url = BasicCatalog.sanitizeMediaURL(urlString) {
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
      .accessibilityLabel(
        node.explicitAccessibilityAttributes?.label
          ?? (imageDescription.isEmpty ? "Image" : imageDescription))
    } else {
      Image(systemName: "photo")
        .font(.largeTitle)
        .foregroundStyle(.secondary)
        .frame(minWidth: 40, minHeight: 40)
    }
  }

  @ViewBuilder
  private func applyVariantSizing(image: Image) -> some View {
    switch variant {
    case "icon":
      fit.apply(to: image)
        .frame(width: 24, height: 24)
        .clipped()

    case "avatar":
      fit.apply(to: image)
        .frame(width: 40, height: 40)
        .clipShape(Circle())

    case "smallFeature":
      aspectBox(image: image)
        .frame(maxWidth: 100, maxHeight: 100)

    case "largeFeature":
      aspectBox(image: image)
        .frame(maxWidth: .infinity)
        .frame(maxHeight: 400)

    case "header":
      fit.apply(to: image)
        .frame(maxWidth: .infinity)
        .frame(height: 200)
        .clipped()

    default:  // mediumFeature
      aspectBox(image: image)
        .frame(maxWidth: .infinity)
    }
  }

  /// Lays the image out in a frame with the image's own aspect ratio, as a web `<img>` with an
  /// automatic height is, then fits the image into that frame.
  ///
  /// Without this, `fill` would stretch the image to the full width at its intrinsic height
  /// whenever the parent leaves the height open, as a scroll view does.
  private func aspectBox(image: Image) -> some View {
    image
      .resizable()
      .aspectRatio(contentMode: .fit)
      .hidden()
      .overlay { fit.apply(to: image) }
      .clipped()
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

// MARK: - Fit

extension A2UIImage {
  /// The Basic Catalog `fit` values, with the semantics of CSS `object-fit`.
  public enum Fit: String, CaseIterable, Sendable {
    /// Scales the image to fit inside the frame, keeping its aspect ratio.
    case contain
    /// Scales the image to cover the frame, keeping its aspect ratio. The overflow is clipped.
    case cover
    /// Stretches the image to the frame, ignoring its aspect ratio.
    case fill
    /// Shows the image at its intrinsic size, centered. The overflow is clipped.
    case none
    /// Behaves like `none` or `contain`, whichever shows the image smaller.
    case scaleDown

    /// Resolves the `fit` property of an `Image` node.
    ///
    /// A missing or unknown value falls back to the catalog default, `fill`. The `avatar` and
    /// `header` variants fall back to `cover` instead, so a photo keeps its proportions in a frame
    /// of fixed shape.
    public init(property: String?, variant: String) {
      if let property, let fit = Fit(rawValue: property) {
        self = fit
      } else if variant == "avatar" || variant == "header" {
        self = .cover
      } else {
        self = .fill
      }
    }

    /// Sizes `image` for the frame its parent proposes.
    ///
    /// The parent sets the frame and clips anything that overflows it, so `cover` and `none` can
    /// report a size larger than the proposal.
    @ViewBuilder
    public func apply(to image: Image) -> some View {
      switch self {
      case .contain:
        image.resizable().aspectRatio(contentMode: .fit)
      case .cover:
        image.resizable().aspectRatio(contentMode: .fill)
      case .fill:
        image.resizable()
      case .none:
        image
      case .scaleDown:
        ViewThatFits {
          image
          image.resizable().aspectRatio(contentMode: .fit)
        }
      }
    }
  }
}
