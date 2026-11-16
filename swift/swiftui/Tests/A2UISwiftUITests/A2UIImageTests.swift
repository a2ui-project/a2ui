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
import BasicCatalogSwiftUI
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

  // MARK: - Variant sizing

  /// A 400x100 banner in a 300-point column: the header crops it to the column's width.
  @Test(arguments: [A2UIImage.Fit.cover, .none, .fill])
  func headerKeepsWideImageInProposedWidth(fit: A2UIImage.Fit) {
    let view = Self.imageView(variant: "header", fit: fit)
    let wide = Self.solidImage(width: 400, height: 100)
    #expect(
      Self.size(
        of: VStack { view.applyVariantSizing(image: wide) },
        proposing: CGSize(width: 300, height: 500)
      ) == CGSize(width: 300, height: 200))
  }

  /// A 20x10 image in a 300-point column keeps its intrinsic height, as an `<img>` with
  /// `max-width: 100%; height: auto` does.
  @Test(arguments: A2UIImage.Fit.allCases)
  func mediumFeatureDoesNotInflateSmallImageHeight(fit: A2UIImage.Fit) {
    let view = Self.imageView(variant: "mediumFeature", fit: fit)
    let small = Self.solidImage(width: 20, height: 10)
    #expect(
      Self.size(
        of: view.applyVariantSizing(image: small).fixedSize(horizontal: false, vertical: true),
        proposing: CGSize(width: 300, height: 500)
      ) == CGSize(width: 300, height: 10))
  }

  /// A 400x200 image in a 300-point column with an open height, as in a scroll view: it shrinks
  /// to the column's width and keeps its aspect ratio, even with the default `fill`.
  @Test(arguments: A2UIImage.Fit.allCases)
  func mediumFeatureShrinksLargeImageKeepingAspectRatio(fit: A2UIImage.Fit) {
    let view = Self.imageView(variant: "mediumFeature", fit: fit)
    let large = Self.solidImage(width: 400, height: 200)
    #expect(
      Self.size(
        of: view.applyVariantSizing(image: large).fixedSize(horizontal: false, vertical: true),
        proposing: CGSize(width: 300, height: 500)
      ) == CGSize(width: 300, height: 150))
  }

  /// A 200x800 image in a 300-point column: `largeFeature` caps its height at 400 points.
  @Test(arguments: A2UIImage.Fit.allCases)
  func largeFeatureCapsTallImageHeight(fit: A2UIImage.Fit) {
    let view = Self.imageView(variant: "largeFeature", fit: fit)
    let tall = Self.solidImage(width: 200, height: 800)
    #expect(
      Self.size(
        of: view.applyVariantSizing(image: tall).fixedSize(horizontal: false, vertical: true),
        proposing: CGSize(width: 300, height: 1000)
      ) == CGSize(width: 300, height: 400))
  }

  // MARK: - Helpers

  private static func imageView(variant: String, fit: A2UIImage.Fit) -> A2UIImage {
    A2UIImage(
      node: Node(
        id: "img", type: "Image",
        properties: [
          "url": "https://example.com/a.png", "variant": variant, "fit": fit.rawValue,
        ]))
  }

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
