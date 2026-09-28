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
import OrderedJSON
import SwiftUI

// MARK: - Component Implementation

@MainActor
extension BasicCatalogImplementation {
  public static let icon = ComponentImplementation(api: BasicCatalogComponents.icon) { node in
    A2UIIcon(node: node)
  }
}

// MARK: - View

/// A SwiftUI shape rendering an SVG path `d` attribute data string.
public struct SVGPathShape: Shape {
  public let pathData: String

  public init(pathData: String) {
    self.pathData = pathData
  }

  public func path(in rect: CGRect) -> Path {
    let rawPath = SVGPathParser.parse(pathData)
    let boundingBox = rawPath.boundingRect
    guard boundingBox.width > 0, boundingBox.height > 0 else {
      return rawPath
    }

    let contentWidth = max(boundingBox.width, boundingBox.maxX)
    let contentHeight = max(boundingBox.height, boundingBox.maxY)
    let refSize = max(max(contentWidth, contentHeight), 24.0)

    let scale = min(rect.width / refSize, rect.height / refSize)

    var transform = CGAffineTransform.identity
    let scaledWidth = boundingBox.width * scale
    let scaledHeight = boundingBox.height * scale
    let offsetX = rect.minX + (rect.width - scaledWidth) / 2.0 - (boundingBox.minX * scale)
    let offsetY = rect.minY + (rect.height - scaledHeight) / 2.0 - (boundingBox.minY * scale)

    transform = transform.translatedBy(x: offsetX, y: offsetY)
    transform = transform.scaledBy(x: scale, y: scale)

    return rawPath.applying(transform)
  }
}

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
      "M", "m", "L", "l", "H", "h", "V", "v", "C", "c", "S", "s", "Q", "q", "T", "t", "A", "a", "Z",
      "z",
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

/// SwiftUI component view for the A2UI Basic Catalog `Icon` component.
public struct A2UIIcon: View {
  public let node: Node

  public init(node: Node) {
    self.node = node
  }

  public enum IconSource: Equatable {
    case sfSymbol(String)
    case svg(String)
    case unknown
  }

  public var iconSource: IconSource {
    // 1. Resolved dictionary with svgPath
    if let dict = node.dictionary(for: "name") {
      if let pathStr = (dict["svgPath"] as? String)
        ?? (dict["svgPath"] as? DataBinding<String>)?.value, !pathStr.isEmpty
      {
        return .svg(pathStr)
      }
    }

    if let dict = node.properties["name"] as? ResolvedDictionary {
      if let pathStr = (dict["svgPath"] as? String)
        ?? (dict["svgPath"] as? DataBinding<String>)?.value, !pathStr.isEmpty
      {
        return .svg(pathStr)
      }
    }

    if let dict = node.properties["name"] as? [String: Any],
      let pathStr = dict["svgPath"] as? String, !pathStr.isEmpty
    {
      return .svg(pathStr)
    }

    // 2. Direct string name or JSON-stringified object
    if let str = node.string(for: "name"), !str.isEmpty {
      let trimmed = str.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed.starts(with: "{") {
        if let data = trimmed.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let svgPath = obj["svgPath"] as? String, !svgPath.isEmpty
        {
          return .svg(svgPath)
        }
      }
      if trimmed.starts(with: "M") || trimmed.starts(with: "m") {
        return .svg(trimmed)
      }
      return .sfSymbol(str)
    }

    // 3. Raw JSONValue fallback
    if let json = node.jsonValue(for: "name") {
      if let str = json.stringValue, !str.isEmpty {
        let trimmed = str.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.starts(with: "M") || trimmed.starts(with: "m") {
          return .svg(trimmed)
        }
        return .sfSymbol(str)
      }
      if let svgPath = json["svgPath"]?.stringValue, !svgPath.isEmpty {
        return .svg(svgPath)
      }
    }

    return .unknown
  }

  public var body: some View {
    Group {
      switch iconSource {
      case .sfSymbol(let name):
        let symbol = sfSymbolName(for: name)
        Image(systemName: symbol)
          .font(.system(size: 20))
          .frame(width: 24, height: 24)
          .accessibilityLabel(name)

      case .svg(let pathData):
        SVGPathShape(pathData: pathData)
          .fill()
          .frame(width: 24, height: 24)
          .accessibilityLabel("Custom icon")

      case .unknown:
        Image(systemName: "questionmark.circle")
          .font(.system(size: 20))
          .frame(width: 24, height: 24)
          .accessibilityLabel("Icon")
      }
    }
    .accessibilityIdentifier("A2UIIcon_\(node.id)")
  }

  private func sfSymbolName(for name: String) -> String {
    switch name {
    case "accountCircle", "account_circle": return "person.crop.circle"
    case "add": return "plus"
    case "arrowBack", "arrow_back": return "arrow.backward"
    case "arrowForward", "arrow_forward": return "arrow.forward"
    case "arrowUpward", "arrow_upward", "arrowUp", "arrow_up": return "arrow.up"
    case "arrowDownward", "arrow_downward", "arrowDown", "arrow_down": return "arrow.down"
    case "attachFile", "attach_file": return "paperclip"
    case "calendarToday", "calendar_today": return "calendar"
    case "call": return "phone"
    case "camera": return "camera"
    case "check": return "checkmark"
    case "close": return "xmark"
    case "delete": return "trash"
    case "directionsRun", "directions_run": return "figure.run"
    case "download": return "arrow.down.to.line"
    case "edit": return "pencil"
    case "event": return "calendar.badge.clock"
    case "error": return "exclamationmark.circle"
    case "fastForward", "fast_forward": return "forward.fill"
    case "favorite": return "heart.fill"
    case "favoriteOff", "favorite_off": return "heart"
    case "folder": return "folder"
    case "help": return "questionmark.circle"
    case "home": return "house"
    case "info": return "info.circle"
    case "locationOn", "location_on": return "mappin.and.ellipse"
    case "lock": return "lock"
    case "lockOpen", "lock_open": return "lock.open"
    case "mail": return "envelope"
    case "menu": return "line.3.horizontal"
    case "moreVert", "more_vert": return "ellipsis"
    case "moreHoriz", "more_horiz": return "ellipsis"
    case "notifications": return "bell"
    case "notificationsOff", "notifications_off": return "bell.slash"
    case "pause": return "pause.fill"
    case "payment": return "creditcard"
    case "person": return "person"
    case "phone": return "phone"
    case "photo": return "photo"
    case "play": return "play.fill"
    case "print": return "printer"
    case "priorityHigh", "priority_high": return "exclamationmark.triangle"
    case "refresh": return "arrow.clockwise"
    case "rewind": return "backward.fill"
    case "search": return "magnifyingglass"
    case "send": return "paperplane"
    case "settings": return "gearshape"
    case "share": return "square.and.arrow.up"
    case "shoppingCart", "shopping_cart": return "cart"
    case "skipNext", "skip_next": return "forward.end.fill"
    case "skipPrevious", "skip_previous": return "backward.end.fill"
    case "star": return "star.fill"
    case "starHalf", "star_half": return "star.leadinghalf.filled"
    case "starOff", "star_off": return "star"
    case "stop": return "stop.fill"
    case "trendingUp", "trending_up": return "chart.line.uptrend.xyaxis"
    case "trendingDown", "trending_down": return "chart.line.downtrend.xyaxis"
    case "upload": return "arrow.up.to.line"
    case "visibility": return "eye"
    case "visibilityOff", "visibility_off": return "eye.slash"
    case "volumeDown", "volume_down": return "speaker.wave.1"
    case "volumeMute", "volume_mute": return "speaker.slash"
    case "volumeOff", "volume_off": return "speaker.slash"
    case "volumeUp", "volume_up": return "speaker.wave.3"
    case "warning": return "exclamationmark.triangle"
    default:
      return name.isEmpty ? "questionmark.circle" : name
    }
  }
}
