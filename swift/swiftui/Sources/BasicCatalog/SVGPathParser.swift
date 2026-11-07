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
  public static func parse(_ d: String) -> Path {
    var path = Path()
    var currentPoint: CGPoint = .zero
    var startPoint: CGPoint = .zero
    var lastControlPoint: CGPoint? = nil

    let tokens = tokenize(d)
    var index = 0

    func nextNumber() -> CGFloat? {
      guard index < tokens.count else { return nil }
      if case .number(let val) = tokens[index] {
        index += 1
        return CGFloat(val)
      }
      return nil
    }

    func nextPoint(relative: Bool) -> CGPoint? {
      guard let x = nextNumber(), let y = nextNumber() else { return nil }
      return relative ? CGPoint(x: currentPoint.x + x, y: currentPoint.y + y) : CGPoint(x: x, y: y)
    }

    while index < tokens.count {
      guard case .command(let cmd) = tokens[index] else {
        index += 1
        continue
      }
      index += 1

      switch cmd {
      case "M", "m":
        let isRel = (cmd == "m")
        if let pt = nextPoint(relative: isRel) {
          currentPoint = pt
          startPoint = pt
          path.move(to: pt)
          lastControlPoint = nil
          while let nextPt = nextPoint(relative: isRel) {
            currentPoint = nextPt
            path.addLine(to: nextPt)
          }
        }

      case "L", "l":
        let isRel = (cmd == "l")
        while let pt = nextPoint(relative: isRel) {
          currentPoint = pt
          path.addLine(to: pt)
          lastControlPoint = nil
        }

      case "H", "h":
        let isRel = (cmd == "h")
        while let x = nextNumber() {
          let targetX = isRel ? currentPoint.x + x : x
          currentPoint = CGPoint(x: targetX, y: currentPoint.y)
          path.addLine(to: currentPoint)
          lastControlPoint = nil
        }

      case "V", "v":
        let isRel = (cmd == "v")
        while let y = nextNumber() {
          let targetY = isRel ? currentPoint.y + y : y
          currentPoint = CGPoint(x: currentPoint.x, y: targetY)
          path.addLine(to: currentPoint)
          lastControlPoint = nil
        }

      case "C", "c":
        let isRel = (cmd == "c")
        while let cp1 = nextPoint(relative: isRel),
          let cp2 = nextPoint(relative: isRel),
          let endPt = nextPoint(relative: isRel)
        {
          path.addCurve(to: endPt, control1: cp1, control2: cp2)
          lastControlPoint = cp2
          currentPoint = endPt
        }

      case "S", "s":
        let isRel = (cmd == "s")
        while let cp2 = nextPoint(relative: isRel),
          let endPt = nextPoint(relative: isRel)
        {
          let cp1: CGPoint
          if let last = lastControlPoint {
            cp1 = CGPoint(x: 2 * currentPoint.x - last.x, y: 2 * currentPoint.y - last.y)
          } else {
            cp1 = currentPoint
          }
          path.addCurve(to: endPt, control1: cp1, control2: cp2)
          lastControlPoint = cp2
          currentPoint = endPt
        }

      case "Q", "q":
        let isRel = (cmd == "q")
        while let cp = nextPoint(relative: isRel),
          let endPt = nextPoint(relative: isRel)
        {
          path.addQuadCurve(to: endPt, control: cp)
          lastControlPoint = cp
          currentPoint = endPt
        }

      case "T", "t":
        let isRel = (cmd == "t")
        while let endPt = nextPoint(relative: isRel) {
          let cp: CGPoint
          if let last = lastControlPoint {
            cp = CGPoint(x: 2 * currentPoint.x - last.x, y: 2 * currentPoint.y - last.y)
          } else {
            cp = currentPoint
          }
          path.addQuadCurve(to: endPt, control: cp)
          lastControlPoint = cp
          currentPoint = endPt
        }

      case "Z", "z":
        path.closeSubpath()
        currentPoint = startPoint
        lastControlPoint = nil

      default:
        break
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
    let commandChars: Set<Character> = [
      "M", "m", "L", "l", "H", "h", "V", "v", "C", "c", "S", "s", "Q", "q", "T", "t", "A", "a",
      "Z", "z",
    ]
    var currentNumberStr = ""

    func flushNumber() {
      if !currentNumberStr.isEmpty {
        if let num = Double(currentNumberStr) {
          tokens.append(.number(num))
        }
        currentNumberStr = ""
      }
    }

    var hasDecimalInCurrent = false

    for char in input {
      if commandChars.contains(char) {
        flushNumber()
        hasDecimalInCurrent = false
        tokens.append(.command(char))
      } else if char.isWhitespace || char == "," {
        flushNumber()
        hasDecimalInCurrent = false
      } else if char == "-" {
        flushNumber()
        hasDecimalInCurrent = false
        currentNumberStr.append(char)
      } else if char == "." {
        if hasDecimalInCurrent {
          flushNumber()
        }
        hasDecimalInCurrent = true
        currentNumberStr.append(char)
      } else if char.isNumber {
        currentNumberStr.append(char)
      }
    }
    flushNumber()

    return tokens
  }
}
