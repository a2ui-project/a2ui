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

/// Lays out the children of a Row or Column along one axis, like a CSS flex container.
///
/// - Children with a weight (``A2UIWeightKey``) share the space the others leave free in
///   proportion to their weights, like `flex: <weight>`. With `justify` set to `stretch`, every
///   child without a weight counts as weighing 1.
/// - Otherwise the free space is placed around the children according to `justify`, like
///   `justify-content`.
/// - On the cross axis, children are aligned according to `align`, like `align-items`. Children
///   that stretch get the container's cross size.
///
/// The container fills the space offered along its main axis unless `justify` is `start` and no
/// child has a weight, in which case it fits its children.
struct A2UIFlexLayout: Layout {
  let axis: Axis
  let justify: String
  let align: String
  let spacing: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let available = mainLength(of: proposal)
    let crossProposal = measuringCross(for: proposal)
    let sizes = mainSizes(of: subviews, available: available, crossProposal: crossProposal)
    let content = sizes.reduce(0, +) + gaps(subviews)
    let fills = justify != "start" || weights(of: subviews).contains { $0 > 0 }
    let cross =
      subviews.indices.map { index in
        crossLength(
          of: subviews[index].sizeThatFits(proposed(main: sizes[index], cross: crossProposal)))
      }.max() ?? 0
    return size(main: fills ? available ?? content : content, cross: cross)
  }

  func placeSubviews(
    in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
  ) {
    guard !subviews.isEmpty else { return }
    let boundsMain = mainLength(of: bounds.size)
    let boundsCross = crossLength(of: bounds.size)
    let crossProposal = measuringCross(for: ProposedViewSize(bounds.size))
    let sizes = mainSizes(of: subviews, available: boundsMain, crossProposal: crossProposal)
    let free = max(boundsMain - sizes.reduce(0, +) - gaps(subviews), 0)
    let (leading, between) = justifyOffsets(free: free, count: subviews.count)
    var position = leading
    for index in subviews.indices {
      let subview = subviews[index]
      let cross: CGFloat
      if align == "stretch" {
        cross = boundsCross
      } else {
        let measured = subview.sizeThatFits(proposed(main: sizes[index], cross: crossProposal))
        cross = crossLength(of: measured)
      }
      let crossOffset: CGFloat
      switch align {
      case "center": crossOffset = (boundsCross - cross) / 2
      case "end": crossOffset = boundsCross - cross
      default: crossOffset = 0
      }
      let origin =
        axis == .horizontal
        ? CGPoint(x: bounds.minX + position, y: bounds.minY + crossOffset)
        : CGPoint(x: bounds.minX + crossOffset, y: bounds.minY + position)
      subview.place(
        at: origin, anchor: .topLeading, proposal: proposed(main: sizes[index], cross: cross))
      position += sizes[index] + spacing + between
    }
  }

  /// The main-axis length of each child.
  ///
  /// A child without a weight gets its ideal length. With `available` space, the children with a
  /// weight split what the others leave free in proportion to their weights; if the others don't
  /// fit, they shrink in proportion to their lengths, like `flex-shrink: 1`.
  private func mainSizes(
    of subviews: Subviews, available: CGFloat?, crossProposal: CGFloat?
  ) -> [CGFloat] {
    let weights = weights(of: subviews)
    let ideal = subviews.indices.map { index in
      weights[index] > 0 && available != nil
        ? 0
        : mainLength(of: subviews[index].sizeThatFits(proposed(main: nil, cross: crossProposal)))
    }
    guard let available else { return ideal }
    let totalIdeal = ideal.reduce(0, +)
    let free = available - gaps(subviews) - totalIdeal
    let totalWeight = weights.reduce(0, +)
    return subviews.indices.map { index in
      if weights[index] > 0 {
        return max(free, 0) * weights[index] / totalWeight
      }
      if free < 0 && totalIdeal > 0 {
        return max(ideal[index] + free * ideal[index] / totalIdeal, 0)
      }
      return ideal[index]
    }
  }

  /// The weight of each child, counting a child without one as weighing 1 when `justify` is
  /// `stretch`.
  private func weights(of subviews: Subviews) -> [CGFloat] {
    subviews.map { subview in
      let weight = CGFloat(subview[A2UIWeightKey.self])
      return weight > 0 ? weight : justify == "stretch" ? 1 : 0
    }
  }

  /// The space before the first child and the extra space between children for `free` space.
  private func justifyOffsets(free: CGFloat, count: Int) -> (leading: CGFloat, between: CGFloat) {
    let count = CGFloat(count)
    switch justify {
    case "end": return (free, 0)
    case "center": return (free / 2, 0)
    case "spaceBetween": return count > 1 ? (0, free / (count - 1)) : (0, 0)
    case "spaceAround": return (free / count / 2, free / count)
    case "spaceEvenly": return (free / (count + 1), free / (count + 1))
    default: return (0, 0)
    }
  }

  private func gaps(_ subviews: Subviews) -> CGFloat {
    spacing * CGFloat(max(subviews.count - 1, 0))
  }

  private func mainLength(of proposal: ProposedViewSize) -> CGFloat? {
    let length = axis == .horizontal ? proposal.width : proposal.height
    return length.flatMap { $0.isFinite ? $0 : nil }
  }

  /// The cross-axis length to measure children with: a column's width, but not a row's height,
  /// which follows its children like a CSS row's.
  private func measuringCross(for proposal: ProposedViewSize) -> CGFloat? {
    axis == .vertical ? proposal.width : nil
  }

  private func mainLength(of size: CGSize) -> CGFloat {
    axis == .horizontal ? size.width : size.height
  }

  private func crossLength(of size: CGSize) -> CGFloat {
    axis == .horizontal ? size.height : size.width
  }

  private func proposed(main: CGFloat?, cross: CGFloat?) -> ProposedViewSize {
    axis == .horizontal
      ? ProposedViewSize(width: main, height: cross) : ProposedViewSize(width: cross, height: main)
  }

  private func size(main: CGFloat, cross: CGFloat) -> CGSize {
    axis == .horizontal
      ? CGSize(width: main, height: cross) : CGSize(width: cross, height: main)
  }
}
