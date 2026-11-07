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

/// A custom SwiftUI layout arranging child views in wrapping horizontal rows.
struct FlowLayout: Layout {
  var spacing: CGFloat = 8
  var lineSpacing: CGFloat = 8

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    guard !subviews.isEmpty else { return .zero }
    let maxWidth = proposal.width ?? .infinity
    var currentX: CGFloat = 0
    var currentY: CGFloat = 0
    var lineHeight: CGFloat = 0
    var maxLineWidth: CGFloat = 0

    for subview in subviews {
      let size = subview.sizeThatFits(.unspecified)
      if currentX + size.width > maxWidth && currentX > 0 {
        maxLineWidth = max(maxLineWidth, currentX - spacing)
        currentX = 0
        currentY += lineHeight + lineSpacing
        lineHeight = 0
      }
      currentX += size.width + spacing
      lineHeight = max(lineHeight, size.height)
    }
    maxLineWidth = max(maxLineWidth, currentX > 0 ? currentX - spacing : 0)

    return CGSize(width: maxLineWidth, height: currentY + lineHeight)
  }

  func placeSubviews(
    in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
  ) {
    guard !subviews.isEmpty else { return }
    var currentX: CGFloat = bounds.minX
    var currentY: CGFloat = bounds.minY
    var lineHeight: CGFloat = 0

    for subview in subviews {
      let size = subview.sizeThatFits(.unspecified)
      if currentX + size.width > bounds.maxX && currentX > bounds.minX {
        currentX = bounds.minX
        currentY += lineHeight + lineSpacing
        lineHeight = 0
      }
      subview.place(at: CGPoint(x: currentX, y: currentY), proposal: ProposedViewSize(size))
      currentX += size.width + spacing
      lineHeight = max(lineHeight, size.height)
    }
  }
}
