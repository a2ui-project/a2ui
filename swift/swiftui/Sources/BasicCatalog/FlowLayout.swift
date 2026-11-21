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

  private struct ItemPlacement {
    let origin: CGPoint
    let size: CGSize
  }

  private func computeLayout(
    maxWidth: CGFloat,
    subviews: Subviews
  ) -> (size: CGSize, placements: [ItemPlacement]) {
    guard !subviews.isEmpty else { return (.zero, []) }
    var placements: [ItemPlacement] = []
    placements.reserveCapacity(subviews.count)

    var currentX: CGFloat = 0
    var currentY: CGFloat = 0
    var lineHeight: CGFloat = 0
    var maxLineWidth: CGFloat = 0

    for subview in subviews {
      let idealSize = subview.sizeThatFits(.unspecified)
      let size =
        if maxWidth.isFinite, idealSize.width > maxWidth {
          subview.sizeThatFits(ProposedViewSize(width: maxWidth, height: nil))
        } else {
          idealSize
        }
      if currentX > 0, currentX + size.width > maxWidth {
        maxLineWidth = max(maxLineWidth, currentX - spacing)
        currentX = 0
        currentY += lineHeight + lineSpacing
        lineHeight = 0
      }
      placements.append(ItemPlacement(origin: CGPoint(x: currentX, y: currentY), size: size))
      currentX += size.width + spacing
      lineHeight = max(lineHeight, size.height)
    }
    maxLineWidth = max(maxLineWidth, currentX > 0 ? currentX - spacing : 0)
    return (CGSize(width: maxLineWidth, height: currentY + lineHeight), placements)
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    computeLayout(maxWidth: proposal.width ?? .infinity, subviews: subviews).size
  }

  func placeSubviews(
    in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
  ) {
    let (_, placements) = computeLayout(maxWidth: bounds.width, subviews: subviews)
    for (subview, placement) in zip(subviews, placements) {
      let point = CGPoint(
        x: bounds.minX + placement.origin.x,
        y: bounds.minY + placement.origin.y
      )
      subview.place(at: point, proposal: ProposedViewSize(placement.size))
    }
  }
}
