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

    func flushNumber() {
      guard !currentNumber.isEmpty else { return }
      if let number = Double(currentNumber) {
        tokens.append(.number(number))
      }
      currentNumber = ""
      hasDecimalInCurrent = false
      hasExponentInCurrent = false
    }

    for character in input {
      if character == "e" || character == "E",
        !hasExponentInCurrent,
        currentNumber.contains(where: { $0.isASCII && $0.isWholeNumber })
      {
        hasExponentInCurrent = true
        currentNumber.append(character)
      } else if commandCharacters.contains(character) {
        flushNumber()
        tokens.append(.command(character))
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
