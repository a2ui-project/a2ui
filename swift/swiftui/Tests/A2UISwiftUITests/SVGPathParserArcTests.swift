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

import BasicCatalogSwiftUI
import SwiftUI
import Testing

struct SVGPathParserArcTests {

  private static let tolerance: CGFloat = 0.01

  private func expectRect(
    _ actual: CGRect, approximately expected: CGRect,
    sourceLocation: SourceLocation = #_sourceLocation
  ) {
    #expect(abs(actual.minX - expected.minX) < Self.tolerance, sourceLocation: sourceLocation)
    #expect(abs(actual.minY - expected.minY) < Self.tolerance, sourceLocation: sourceLocation)
    #expect(abs(actual.width - expected.width) < Self.tolerance, sourceLocation: sourceLocation)
    #expect(abs(actual.height - expected.height) < Self.tolerance, sourceLocation: sourceLocation)
  }

  private func expectPoint(
    _ actual: CGPoint?, approximately expected: CGPoint,
    sourceLocation: SourceLocation = #_sourceLocation
  ) throws {
    let actual = try #require(
      actual, "Expected a current point", sourceLocation: sourceLocation)
    #expect(abs(actual.x - expected.x) < Self.tolerance, sourceLocation: sourceLocation)
    #expect(abs(actual.y - expected.y) < Self.tolerance, sourceLocation: sourceLocation)
  }

  private func elements(of path: Path) -> [Path.Element] {
    var elements: [Path.Element] = []
    // `Path` is not a `Sequence`, so its elements can only be visited through `Path.forEach(_:)`.
    func collect(_ element: Path.Element) { elements.append(element) }
    path.forEach(collect)
    return elements
  }

  @Test func fullCircleFromTwoRelativeArcs() {
    let path = SVGPathParser.parse("M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z")
    expectRect(path.boundingRect, approximately: CGRect(x: 2, y: 2, width: 20, height: 20))
  }

  @Test func relativeArcWithCompactFlags() throws {
    // "0110 10" is large-arc 0, sweep 1, then the end point 10 10.
    let path = SVGPathParser.parse("M10 0a10 10 0 0110 10")
    expectRect(path.boundingRect, approximately: CGRect(x: 10, y: 0, width: 10, height: 10))
    try expectPoint(path.currentPoint, approximately: CGPoint(x: 20, y: 10))
  }

  @Test func compactFlagsWithoutAnySeparators() throws {
    let path = SVGPathParser.parse("M0 0a5 5 0 1010 0")
    // Large arc, counter-clockwise sweep from (0, 0) to (10, 0) bulges towards positive y.
    expectRect(path.boundingRect, approximately: CGRect(x: 0, y: 0, width: 10, height: 5))
    try expectPoint(path.currentPoint, approximately: CGPoint(x: 10, y: 0))
  }

  @Test func zeroRadiusArcDrawsStraightLine() {
    let path = SVGPathParser.parse("M0 0 A0 5 0 0 1 10 10")
    let elements = elements(of: path)
    #expect(elements.count == 2)
    #expect(elements.last == .line(to: CGPoint(x: 10, y: 10)))
  }

  @Test func arcToCurrentPointIsSkipped() {
    let path = SVGPathParser.parse("M5 5 A10 10 0 0 1 5 5")
    #expect(elements(of: path) == [.move(to: CGPoint(x: 5, y: 5))])
  }

  @Test func ellipticalArcWithXAxisRotation() {
    // An ellipse with radii 20 and 10, rotated 45 degrees, drawn as two halves between the ends
    // of its major axis. Its bounding box half-extent is sqrt(20² / 2 + 10² / 2) = sqrt(250).
    let axisEnd: CGFloat = 20 / 2.squareRoot()
    let path = SVGPathParser.parse(
      "M\(-axisEnd) \(-axisEnd) A20 10 45 1 1 \(axisEnd) \(axisEnd) "
        + "A20 10 45 1 1 \(-axisEnd) \(-axisEnd) Z")
    let halfExtent = CGFloat(250).squareRoot()
    expectRect(
      path.boundingRect,
      approximately: CGRect(
        x: -halfExtent, y: -halfExtent, width: 2 * halfExtent, height: 2 * halfExtent))
  }

  @Test func repeatedImplicitArcArguments() throws {
    let path = SVGPathParser.parse("M2 12 A10 10 0 0 1 22 12 10 10 0 0 1 2 12")
    expectRect(path.boundingRect, approximately: CGRect(x: 2, y: 2, width: 20, height: 20))
    try expectPoint(path.currentPoint, approximately: CGPoint(x: 2, y: 12))
  }

  @Test func undersizedRadiiAreScaledUp() {
    // Radius 1 cannot span 10 units, so it is scaled to 5 and the arc becomes a semicircle.
    let path = SVGPathParser.parse("M0 0 A1 1 0 0 1 10 0")
    expectRect(path.boundingRect, approximately: CGRect(x: 0, y: -5, width: 10, height: 5))
  }

  @Test func arcResetsSmoothCurveReflection() {
    let path = SVGPathParser.parse("M0 0 C0 -10 10 -10 10 0 A5 5 0 0 1 20 0 S30 10 30 0")
    guard case .curve(_, let control1, _) = elements(of: path).last else {
      Issue.record("Expected the smooth curve to be the last element")
      return
    }
    #expect(control1 == CGPoint(x: 20, y: 0))
  }
}
