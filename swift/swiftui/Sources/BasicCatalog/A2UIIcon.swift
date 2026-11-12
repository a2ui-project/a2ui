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
import Foundation
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

/// SwiftUI component view for the A2UI Basic Catalog `Icon` component.
public struct A2UIIcon: View {
  public let node: Node

  @ScaledMetric(relativeTo: .body) private var glyphSize: CGFloat = 20
  @ScaledMetric(relativeTo: .body) private var boxSize: CGFloat = 24

  public init(node: Node) {
    self.node = node
  }

  public enum IconSource: Equatable {
    case sfSymbol(String)
    case svg(String)
    case unknown
  }

  public var iconSource: IconSource {
    // 1. Resolved dictionary with svgPath (v1.0) or path (v0.8/v0.9)
    if let dict = node.dictionary(for: "name") {
      let rawVal = dict["svgPath"] ?? dict["path"]
      if let pathStr = (rawVal as? String)
        ?? (rawVal as? DataBinding<String>)?.value, !pathStr.isEmpty
      {
        return .svg(pathStr)
      }
    }

    // 2. Direct string name or JSON-stringified object
    if let str = node.string(for: "name"), !str.isEmpty {
      let trimmed = str.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed.starts(with: "{") {
        if let data = trimmed.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let svgPath = (obj["svgPath"] as? String) ?? (obj["path"] as? String),
          !svgPath.isEmpty
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
      if let svgPath = (json["svgPath"] ?? json["path"])?.stringValue, !svgPath.isEmpty {
        return .svg(svgPath)
      }
    }

    return .unknown
  }

  /// The agent's explicit accessibility label, which replaces the inferred icon label.
  private var explicitLabel: String? {
    node.explicitAccessibilityAttributes?.label
  }

  public var body: some View {
    Group {
      switch iconSource {
      case .sfSymbol(let name):
        let symbol = sfSymbolName(for: name)
        Image(systemName: symbol)
          .font(.system(size: glyphSize))
          .frame(width: boxSize, height: boxSize)
          .accessibilityLabel(explicitLabel ?? name)

      case .svg(let pathData):
        SVGPathShape(pathData: pathData)
          .fill()
          .frame(width: boxSize, height: boxSize)
          .accessibilityLabel(explicitLabel ?? "Custom icon")

      case .unknown:
        Image(systemName: "questionmark.circle")
          .font(.system(size: glyphSize))
          .frame(width: boxSize, height: boxSize)
          .accessibilityLabel(explicitLabel ?? "Icon")
      }
    }
    .accessibilityIdentifier("a2ui-\(node.id)")
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
