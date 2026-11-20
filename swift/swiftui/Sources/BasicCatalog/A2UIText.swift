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
  public static let text = ComponentImplementation(api: BasicCatalogComponents.text) { node in
    A2UIText(node: node)
  }
}

// MARK: - View

/// SwiftUI component view for the A2UI Basic Catalog `Text` component.
public struct A2UIText: View {
  /// Summary of the visible text and semantic formatting constructs rendered by ``A2UIText``.
  @_spi(Testing)
  public struct RenderedMarkdown: Sendable, Equatable {
    public let visibleText: String
    public let presentSemantics: Set<String>

    public init(visibleText: String, presentSemantics: Set<String>) {
      self.visibleText = visibleText
      self.presentSemantics = presentSemantics
    }
  }

  public let node: Node

  public init(node: Node) {
    self.node = node
  }

  private var textContent: String {
    node.string(for: "text") ?? ""
  }

  private var variant: String {
    node.string(for: "variant") ?? "body"
  }

  public var body: some View {
    textForVariant(textContent, variant: variant)
      .accessibilityIdentifier("a2ui-\(node.id)")
      .a2uiAccessibleText(Self.accessibleText(textContent, variant: variant))
      .a2uiAccessibilityElement(for: node, children: .combine)
  }

  /// Evaluates the rendered visible text and semantic formatting constructs for this `Text` node.
  @_spi(Testing)
  public var renderedMarkdown: RenderedMarkdown {
    switch variant {
    case "h1", "h2", "h3", "h4", "h5":
      let attributed = attributedMarkdown(textContent)
      var semantics = inlineMarkdownSemantics(in: attributed)
      semantics.insert("heading")
      Self.collectRenderedViewSemantics(in: body, into: &semantics)
      return RenderedMarkdown(
        visibleText: String(attributed.characters),
        presentSemantics: semantics
      )
    case "caption":
      let attributed = attributedMarkdown(textContent)
      var semantics = inlineMarkdownSemantics(in: attributed)
      semantics.insert("emphasis")
      Self.collectRenderedViewSemantics(in: body, into: &semantics)
      return RenderedMarkdown(
        visibleText: String(attributed.characters),
        presentSemantics: semantics
      )
    default:
      let summary = MarkdownBlockView(text: textContent).renderedMarkdown()
      var semantics = summary.presentSemantics
      Self.collectRenderedViewSemantics(in: body, into: &semantics)
      return RenderedMarkdown(visibleText: summary.visibleText, presentSemantics: semantics)
    }
  }

  /// Returns the font for a heading level, used by both the `h1`–`h5` variants and Markdown
  /// headings.
  ///
  /// Headings map to semantic text styles so they scale with Dynamic Type along with body
  /// text. Levels deeper than 5 use a semibold subheadline.
  public static func headingFont(level: Int) -> Font {
    switch level {
    case 1: return .largeTitle
    case 2: return .title
    case 3: return .title2
    case 4: return .title3
    case 5: return .headline
    default: return .subheadline.weight(.semibold)
    }
  }

  @ViewBuilder
  private func textForVariant(_ text: String, variant: String) -> some View {
    switch variant {
    case "h1", "h2", "h3", "h4", "h5":
      let level = Int(variant.dropFirst()) ?? 1
      Text(attributedMarkdown(text))
        .font(Self.headingFont(level: level))
        .a2uiHeading(level: level)
    case "caption":
      Text(attributedMarkdown(text))
        .font(.caption)
        .italic()
        .foregroundStyle(.secondary)
    default:
      MarkdownBlockView(text: text)
    }
  }

  private static func collectRenderedViewSemantics(
    in value: Any,
    into semantics: inout Set<String>
  ) {
    if let view = value as? any View {
      let typeName = String(reflecting: type(of: view))
      if typeName.hasPrefix("SwiftUI.Image") || typeName.hasPrefix("SwiftUI.AsyncImage") {
        semantics.insert("image")
        return
      }
      if typeName.hasPrefix("BasicCatalogSwiftUI.") {
        collectRenderedViewSemantics(in: expandBody(of: view), into: &semantics)
        return
      }
    }
    for child in Mirror(reflecting: value).children {
      collectRenderedViewSemantics(in: child.value, into: &semantics)
    }
  }

  private static func expandBody<ViewType: View>(of view: ViewType) -> any View {
    view.body
  }
}

extension View {
  /// Marks this view as a heading for assistive technologies, so VoiceOver announces it as one
  /// and lists it in the headings rotor, like the `<h1>`–`<h5>` elements of the web renderer.
  ///
  /// Levels deeper than 6 are reported as level 6, the deepest level SwiftUI supports.
  func a2uiHeading(level: Int) -> some View {
    let headingLevel: AccessibilityHeadingLevel =
      switch level {
      case 1: .h1
      case 2: .h2
      case 3: .h3
      case 4: .h4
      case 5: .h5
      default: .h6
      }
    return
      self
      .accessibilityAddTraits(.isHeader)
      .accessibilityHeading(headingLevel)
  }
}

/// Parses inline Markdown into an `AttributedString`, stripping link and image URL attributes
/// because Basic Catalog `Text` renders link and image syntax as plain text without targets.
func attributedMarkdown(_ text: String) -> AttributedString {
  guard
    var attributed = try? AttributedString(
      markdown: text,
      options: AttributedString.MarkdownParsingOptions(
        interpretedSyntax: .inlineOnlyPreservingWhitespace
      )
    )
  else {
    return AttributedString(text)
  }
  for run in attributed.runs {
    let linkURL: URL? = run.link
    if linkURL != nil {
      attributed[run.range].link = nil
    }
    let imageURL: URL? = run.imageURL
    if imageURL != nil {
      attributed[run.range].imageURL = nil
    }
  }
  return attributed
}

func inlineMarkdownSemantics(in attributed: AttributedString) -> Set<String> {
  var semantics: Set<String> = []
  for run in attributed.runs {
    if let intent: InlinePresentationIntent = run.inlinePresentationIntent {
      if intent.contains(.stronglyEmphasized) {
        semantics.insert("strong")
      }
      if intent.contains(.emphasized) {
        semantics.insert("emphasis")
      }
      if intent.contains(.code) {
        semantics.insert("code")
      }
    }
    let linkURL: URL? = run.link
    if linkURL != nil {
      semantics.insert("link")
    }
    let imageURL: URL? = run.imageURL
    if imageURL != nil {
      semantics.insert("image")
    }
  }
  return semantics
}
