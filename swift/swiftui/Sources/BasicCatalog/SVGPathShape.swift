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

import SwiftUI

/// A SwiftUI shape rendering an SVG path `d` attribute data string.
public struct SVGPathShape: Shape {
  public let pathData: String
  private let parsedPath: Path
  private let boundingBox: CGRect

  public init(pathData: String) {
    self.pathData = pathData
    let parsed = SVGPathParser.parse(pathData)
    self.parsedPath = parsed
    self.boundingBox = parsed.boundingRect
  }

  public func path(in rect: CGRect) -> Path {
    guard boundingBox.width > 0, boundingBox.height > 0 else {
      return parsedPath
    }

    let contentWidth = max(boundingBox.width, boundingBox.maxX)
    let contentHeight = max(boundingBox.height, boundingBox.maxY)
    let referenceSize = max(contentWidth, contentHeight, 24.0)

    let scale = min(rect.width / referenceSize, rect.height / referenceSize)

    var transform = CGAffineTransform.identity
    let scaledWidth = boundingBox.width * scale
    let scaledHeight = boundingBox.height * scale
    let offsetX = rect.minX + (rect.width - scaledWidth) / 2.0 - (boundingBox.minX * scale)
    let offsetY = rect.minY + (rect.height - scaledHeight) / 2.0 - (boundingBox.minY * scale)

    transform = transform.translatedBy(x: offsetX, y: offsetY)
    transform = transform.scaledBy(x: scale, y: scale)

    return parsedPath.applying(transform)
  }
}
