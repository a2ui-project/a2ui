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

/// Lightweight parser converting SVG path data strings into SwiftUI `Path` instances.
public enum SVGPathParser {
  public static func parse(_ pathData: String) -> Path {
    var path = Path()
    var currentPoint: CGPoint = .zero
    var startPoint: CGPoint = .zero
    var lastCubicControlPoint: CGPoint? = nil
    var lastQuadraticControlPoint: CGPoint? = nil

    let tokens = tokenize(pathData)
    var index = 0

    func nextNumber() -> CGFloat? {
      guard index < tokens.count, case .number(let value) = tokens[index] else {
        return nil
      }
      index += 1
      return CGFloat(value)
    }

    func nextPoint(relative: Bool) -> CGPoint? {
      guard let x = nextNumber(), let y = nextNumber() else { return nil }
      return relative ? CGPoint(x: currentPoint.x + x, y: currentPoint.y + y) : CGPoint(x: x, y: y)
    }

    while index < tokens.count {
      guard case .command(let command) = tokens[index] else {
        index += 1
        continue
      }
      index += 1

      switch command {
      case "M", "m":
        let isRelative = (command == "m")
        if let point = nextPoint(relative: isRelative) {
          currentPoint = point
          startPoint = point
          path.move(to: point)
          lastCubicControlPoint = nil
          lastQuadraticControlPoint = nil
          while let nextPointValue = nextPoint(relative: isRelative) {
            currentPoint = nextPointValue
            path.addLine(to: nextPointValue)
          }
        }

      case "L", "l":
        let isRelative = (command == "l")
        while let point = nextPoint(relative: isRelative) {
          currentPoint = point
          path.addLine(to: point)
          lastCubicControlPoint = nil
          lastQuadraticControlPoint = nil
        }

      case "H", "h":
        let isRelative = (command == "h")
        while let x = nextNumber() {
          let targetX = isRelative ? currentPoint.x + x : x
          currentPoint = CGPoint(x: targetX, y: currentPoint.y)
          path.addLine(to: currentPoint)
          lastCubicControlPoint = nil
          lastQuadraticControlPoint = nil
        }

      case "V", "v":
        let isRelative = (command == "v")
        while let y = nextNumber() {
          let targetY = isRelative ? currentPoint.y + y : y
          currentPoint = CGPoint(x: currentPoint.x, y: targetY)
          path.addLine(to: currentPoint)
          lastCubicControlPoint = nil
          lastQuadraticControlPoint = nil
        }

      case "C", "c":
        let isRelative = (command == "c")
        while let controlPoint1 = nextPoint(relative: isRelative),
          let controlPoint2 = nextPoint(relative: isRelative),
          let endPoint = nextPoint(relative: isRelative)
        {
          path.addCurve(to: endPoint, control1: controlPoint1, control2: controlPoint2)
          lastCubicControlPoint = controlPoint2
          lastQuadraticControlPoint = nil
          currentPoint = endPoint
        }

      case "S", "s":
        let isRelative = (command == "s")
        while let controlPoint2 = nextPoint(relative: isRelative),
          let endPoint = nextPoint(relative: isRelative)
        {
          let controlPoint1: CGPoint
          if let last = lastCubicControlPoint {
            controlPoint1 = CGPoint(x: 2 * currentPoint.x - last.x, y: 2 * currentPoint.y - last.y)
          } else {
            controlPoint1 = currentPoint
          }
          path.addCurve(to: endPoint, control1: controlPoint1, control2: controlPoint2)
          lastCubicControlPoint = controlPoint2
          lastQuadraticControlPoint = nil
          currentPoint = endPoint
        }

      case "Q", "q":
        let isRelative = (command == "q")
        while let controlPoint = nextPoint(relative: isRelative),
          let endPoint = nextPoint(relative: isRelative)
        {
          path.addQuadCurve(to: endPoint, control: controlPoint)
          lastQuadraticControlPoint = controlPoint
          lastCubicControlPoint = nil
          currentPoint = endPoint
        }

      case "T", "t":
        let isRelative = (command == "t")
        while let endPoint = nextPoint(relative: isRelative) {
          let controlPoint: CGPoint
          if let last = lastQuadraticControlPoint {
            controlPoint = CGPoint(x: 2 * currentPoint.x - last.x, y: 2 * currentPoint.y - last.y)
          } else {
            controlPoint = currentPoint
          }
          path.addQuadCurve(to: endPoint, control: controlPoint)
          lastQuadraticControlPoint = controlPoint
          lastCubicControlPoint = nil
          currentPoint = endPoint
        }

      case "A", "a":
        let isRelative = (command == "a")
        while let radiusX = nextNumber(),
          let radiusY = nextNumber(),
          let xAxisRotation = nextNumber(),
          let largeArcFlag = nextNumber(),
          let sweepFlag = nextNumber(),
          let endPoint = nextPoint(relative: isRelative)
        {
          appendArc(
            to: &path,
            from: currentPoint,
            to: endPoint,
            radiusX: radiusX,
            radiusY: radiusY,
            xAxisRotationDegrees: xAxisRotation,
            largeArc: largeArcFlag != 0,
            sweep: sweepFlag != 0
          )
          lastCubicControlPoint = nil
          lastQuadraticControlPoint = nil
          currentPoint = endPoint
        }

      case "Z", "z":
        path.closeSubpath()
        currentPoint = startPoint
        lastCubicControlPoint = nil
        lastQuadraticControlPoint = nil

      default:
        lastCubicControlPoint = nil
        lastQuadraticControlPoint = nil
      }
    }

    return path
  }

  /// Appends an SVG elliptical arc to `path` as a series of cubic Bézier curves, each spanning at
  /// most 90 degrees, following the endpoint-to-center conversion and out-of-range parameter rules
  /// in SVG 1.1 Appendix F.6.
  private static func appendArc(
    to path: inout Path,
    from start: CGPoint,
    to end: CGPoint,
    radiusX: CGFloat,
    radiusY: CGFloat,
    xAxisRotationDegrees: CGFloat,
    largeArc: Bool,
    sweep: Bool
  ) {
    // F.6.2: identical endpoints omit the arc; a zero radius turns it into a straight line.
    guard start != end else { return }
    var scaledRadiusX = abs(radiusX)
    var scaledRadiusY = abs(radiusY)
    guard scaledRadiusX != 0, scaledRadiusY != 0 else {
      path.addLine(to: end)
      return
    }

    let phi = xAxisRotationDegrees * .pi / 180
    let cosPhi = cos(phi)
    let sinPhi = sin(phi)

    // F.6.5.1: move the start point into the ellipse's unrotated coordinate system.
    let halfDeltaX = (start.x - end.x) / 2
    let halfDeltaY = (start.y - end.y) / 2
    let x1Prime = cosPhi * halfDeltaX + sinPhi * halfDeltaY
    let y1Prime = -sinPhi * halfDeltaX + cosPhi * halfDeltaY

    // F.6.6.2: scale the radii up when they are too small to reach the end point.
    let lambda =
      (x1Prime * x1Prime) / (scaledRadiusX * scaledRadiusX)
      + (y1Prime * y1Prime) / (scaledRadiusY * scaledRadiusY)
    if lambda > 1 {
      let scale = sqrt(lambda)
      scaledRadiusX *= scale
      scaledRadiusY *= scale
    }

    // F.6.5.2: compute the transformed center.
    let scaledRadiusXSquared = scaledRadiusX * scaledRadiusX
    let scaledRadiusYSquared = scaledRadiusY * scaledRadiusY
    let numerator =
      scaledRadiusXSquared * scaledRadiusYSquared
      - scaledRadiusXSquared * y1Prime * y1Prime
      - scaledRadiusYSquared * x1Prime * x1Prime
    let denominator =
      scaledRadiusXSquared * y1Prime * y1Prime + scaledRadiusYSquared * x1Prime * x1Prime
    let sign: CGFloat = largeArc == sweep ? -1 : 1
    let coefficient = sign * sqrt(max(0, numerator / denominator))
    let centerXPrime = coefficient * (scaledRadiusX * y1Prime / scaledRadiusY)
    let centerYPrime = coefficient * -(scaledRadiusY * x1Prime / scaledRadiusX)

    // F.6.5.3: rotate the center back into user space.
    let centerX = cosPhi * centerXPrime - sinPhi * centerYPrime + (start.x + end.x) / 2
    let centerY = sinPhi * centerXPrime + cosPhi * centerYPrime + (start.y + end.y) / 2

    // F.6.5.5 and F.6.5.6: start angle and sweep angle on the unit circle.
    let startAngle = atan2(
      (y1Prime - centerYPrime) / scaledRadiusY, (x1Prime - centerXPrime) / scaledRadiusX)
    let endAngle = atan2(
      (-y1Prime - centerYPrime) / scaledRadiusY, (-x1Prime - centerXPrime) / scaledRadiusX)
    var sweepAngle = endAngle - startAngle
    if sweep, sweepAngle < 0 {
      sweepAngle += 2 * .pi
    } else if !sweep, sweepAngle > 0 {
      sweepAngle -= 2 * .pi
    }

    func userSpacePoint(unitX: CGFloat, unitY: CGFloat) -> CGPoint {
      CGPoint(
        x: centerX + scaledRadiusX * cosPhi * unitX - scaledRadiusY * sinPhi * unitY,
        y: centerY + scaledRadiusX * sinPhi * unitX + scaledRadiusY * cosPhi * unitY
      )
    }

    let segmentCount = max(1, Int((abs(sweepAngle) / (.pi / 2)).rounded(.up)))
    let segmentAngle = sweepAngle / CGFloat(segmentCount)
    let handleLength = 4.0 / 3.0 * tan(segmentAngle / 4)
    var angle = startAngle
    for segment in 0..<segmentCount {
      let nextAngle = angle + segmentAngle
      let control1 = userSpacePoint(
        unitX: cos(angle) - handleLength * sin(angle),
        unitY: sin(angle) + handleLength * cos(angle)
      )
      let control2 = userSpacePoint(
        unitX: cos(nextAngle) + handleLength * sin(nextAngle),
        unitY: sin(nextAngle) - handleLength * cos(nextAngle)
      )
      let segmentEnd =
        segment == segmentCount - 1
        ? end : userSpacePoint(unitX: cos(nextAngle), unitY: sin(nextAngle))
      path.addCurve(to: segmentEnd, control1: control1, control2: control2)
      angle = nextAngle
    }
  }

  private enum Token {
    case command(Character)
    case number(Double)
  }

  private static func tokenize(_ input: String) -> [Token] {
    var tokens: [Token] = []
    let commandCharacters: Set<Character> = [
      "M", "m", "L", "l", "H", "h", "V", "v", "C", "c", "S", "s", "Q", "q", "T", "t", "A", "a",
      "Z", "z",
    ]
    var currentNumber = ""
    var hasDecimalInCurrent = false
    var hasExponentInCurrent = false
    // Position within the current arc's 7-number argument set, or `nil` outside `A`/`a`.
    var arcArgumentIndex: Int? = nil

    func appendNumber(_ number: Double) {
      tokens.append(.number(number))
      if let index = arcArgumentIndex {
        arcArgumentIndex = (index + 1) % 7
      }
    }

    func flushNumber() {
      guard !currentNumber.isEmpty else { return }
      if let number = Double(currentNumber) {
        appendNumber(number)
      }
      currentNumber = ""
      hasDecimalInCurrent = false
      hasExponentInCurrent = false
    }

    for character in input {
      if let index = arcArgumentIndex, index == 3 || index == 4, currentNumber.isEmpty,
        character == "0" || character == "1"
      {
        // Arc flags are single characters and may be written without separators,
        // so "a1 1 0 011 1" reads the flags as 0 and 1, followed by the end point 1 1.
        appendNumber(character == "1" ? 1 : 0)
      } else if character == "e" || character == "E",
        !hasExponentInCurrent,
        currentNumber.contains(where: { $0.isASCII && $0.isWholeNumber })
      {
        hasExponentInCurrent = true
        currentNumber.append(character)
      } else if commandCharacters.contains(character) {
        flushNumber()
        tokens.append(.command(character))
        arcArgumentIndex = (character == "A" || character == "a") ? 0 : nil
      } else if character.isWhitespace || character == "," {
        flushNumber()
      } else if character == "-" || character == "+" {
        if currentNumber.last == "e" || currentNumber.last == "E" {
          currentNumber.append(character)
        } else {
          flushNumber()
          if character == "-" {
            currentNumber.append(character)
          }
        }
      } else if character == "." {
        if hasDecimalInCurrent || hasExponentInCurrent {
          flushNumber()
        }
        hasDecimalInCurrent = true
        currentNumber.append(character)
      } else if character.isASCII, character.isWholeNumber {
        currentNumber.append(character)
      }
    }
    flushNumber()

    return tokens
  }
}
