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
import Foundation
import OrderedJSON
import SwiftUI
import Testing

#if canImport(AppKit)
  import AppKit
#elseif canImport(UIKit)
  import UIKit
#endif

@MainActor
struct A2UIImageTests {

  // MARK: - Resolving the property

  @Test(arguments: A2UIImage.Fit.allCases)
  func fitResolvesEveryCatalogValue(fit: A2UIImage.Fit) {
    for variant in ["mediumFeature", "avatar", "header"] {
      #expect(A2UIImage.Fit(property: fit.rawValue, variant: variant) == fit)
    }
  }

  @Test func fitCasesMatchCatalogEnum() {
    #expect(
      A2UIImage.Fit.allCases.map(\.rawValue) == ["contain", "cover", "fill", "none", "scaleDown"])
  }

  @Test(arguments: ["icon", "smallFeature", "mediumFeature", "largeFeature"])
  func fitDefaultsToFill(variant: String) {
    #expect(A2UIImage.Fit(property: nil, variant: variant) == .fill)
  }

  @Test(arguments: ["avatar", "header"])
  func fitDefaultsToCoverForFixedShapeVariants(variant: String) {
    #expect(A2UIImage.Fit(property: nil, variant: variant) == .cover)
  }

  @Test func unknownFitFallsBackToDefault() {
    #expect(A2UIImage.Fit(property: "scale-down", variant: "mediumFeature") == .fill)
    #expect(A2UIImage.Fit(property: "stretch", variant: "header") == .cover)
  }

  @Test func imageReadsFitFromNode() {
    let defaulted = A2UIImage(
      node: Node(id: "img1", type: "Image", properties: ["url": "https://example.com/a.png"]))
    #expect(defaulted.fit == .fill)

    let explicit = A2UIImage(
      node: Node(
        id: "img2", type: "Image",
        properties: ["url": "https://example.com/a.png", "fit": "none", "variant": "header"]))
    #expect(explicit.fit == .none)
    _ = explicit.body
  }

  // MARK: - Layout

  /// A 20x10 image laid out in a 100x100 frame: it has to grow to fill the frame.
  @Test(arguments: [
    (A2UIImage.Fit.fill, CGSize(width: 100, height: 100)),
    (.contain, CGSize(width: 100, height: 50)),
    (.cover, CGSize(width: 200, height: 100)),
    (.none, CGSize(width: 20, height: 10)),
    (.scaleDown, CGSize(width: 20, height: 10)),
  ])
  func smallImageSize(fit: A2UIImage.Fit, expected: CGSize) {
    let image = Self.solidImage(width: 20, height: 10)
    #expect(
      Self.size(of: fit.apply(to: image), proposing: CGSize(width: 100, height: 100)) == expected)
  }

  /// A 400x200 image laid out in a 100x100 frame: it has to shrink to fit the frame.
  @Test(arguments: [
    (A2UIImage.Fit.fill, CGSize(width: 100, height: 100)),
    (.contain, CGSize(width: 100, height: 50)),
    (.cover, CGSize(width: 200, height: 100)),
    (.none, CGSize(width: 400, height: 200)),
    (.scaleDown, CGSize(width: 100, height: 50)),
  ])
  func largeImageSize(fit: A2UIImage.Fit, expected: CGSize) {
    let image = Self.solidImage(width: 400, height: 200)
    #expect(
      Self.size(of: fit.apply(to: image), proposing: CGSize(width: 100, height: 100)) == expected)
  }

  // MARK: - Helpers

  private static func solidImage(width: CGFloat, height: CGFloat) -> Image {
    Image(size: CGSize(width: width, height: height)) { context in
      context.fill(Path(CGRect(x: 0, y: 0, width: width, height: height)), with: .color(.blue))
    }
  }

  private static func size(of view: some View, proposing proposal: CGSize) -> CGSize {
    #if canImport(AppKit)
      NSHostingController(rootView: view).sizeThatFits(in: proposal)
    #elseif canImport(UIKit)
      UIHostingController(rootView: view).sizeThatFits(in: proposal)
    #endif
  }
}
