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
  public static let choicePicker = ComponentImplementation(
    api: BasicCatalogComponents.choicePicker
  ) { node in
    A2UIChoicePicker(node: node)
  }
}

// MARK: - Layout

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

/// SwiftUI component view for the A2UI Basic Catalog `ChoicePicker` selection component.
public struct A2UIChoicePicker: View {
  public let node: Node

  @State private var filterText = ""
  @State private var fallbackSelections: [String] = []

  public init(node: Node) {
    self.node = node
  }

  public struct OptionItem: Identifiable, Equatable {
    public let id: String
    public let label: String
    public let value: String
  }

  private var labelText: String {
    node.string(for: "label") ?? ""
  }

  private var variant: String {
    node.string(for: "variant") ?? "mutuallyExclusive"
  }

  private var displayStyle: String {
    node.string(for: "displayStyle") ?? "checkbox"
  }

  private var isFilterable: Bool {
    node.bool(for: "filterable") ?? false
  }

  private var options: [OptionItem] {
    if let array = node.array(for: "options") {
      return array.enumerated().compactMap { index, element in
        if let str = element as? String {
          return OptionItem(id: str, label: str, value: str)
        }
        if let dict = element as? ResolvedDictionary {
          let label =
            (dict["label"] as? String)
            ?? (dict["label"] as? DataBinding<String>)?.value
            ?? "Option \(index + 1)"
          let value =
            (dict["value"] as? String)
            ?? (dict["value"] as? DataBinding<String>)?.value
            ?? "\(index)"
          return OptionItem(id: value, label: label, value: value)
        }
        return nil
      }
    }

    if let rawArray = node.properties["options"] as? [Any] {
      return rawArray.enumerated().compactMap { index, element in
        if let str = element as? String {
          return OptionItem(id: str, label: str, value: str)
        }
        if let dict = element as? [String: Any] {
          let label = (dict["label"] as? String) ?? "Option \(index + 1)"
          let value = (dict["value"] as? String) ?? "\(index)"
          return OptionItem(id: value, label: label, value: value)
        }
        return nil
      }
    }

    if let json = node.jsonValue(for: "options"), let array = json.arrayValue {
      return array.enumerated().map { index, item in
        if let str = item.stringValue {
          return OptionItem(id: str, label: str, value: str)
        }
        let optLabel = item["label"]?.stringValue ?? "Option \(index + 1)"
        let optVal = item["value"]?.stringValue ?? "\(index)"
        return OptionItem(id: optVal, label: optLabel, value: optVal)
      }
    }

    return []
  }

  private var filteredOptions: [OptionItem] {
    if filterText.isEmpty {
      return options
    }
    return options.filter { $0.label.localizedCaseInsensitiveContains(filterText) }
  }

  private var selectedValues: [String] {
    if let arrayBinding = node.dataBinding(for: "value") as DataBinding<[String]>? {
      return arrayBinding.value ?? fallbackSelections
    }
    if let stringBinding = node.dataBinding(for: "value") as DataBinding<String>? {
      if let val = stringBinding.value, !val.isEmpty {
        return [val]
      }
      return fallbackSelections
    }
    if let str = node.string(for: "value"), !str.isEmpty {
      return [str]
    }
    return fallbackSelections
  }

  private var validationErrors: [String] {
    node.validationErrors
  }

  private var hasError: Bool {
    !validationErrors.isEmpty
  }

  private func toggleSelection(_ optionVal: String) {
    var current = selectedValues
    if variant == "mutuallyExclusive" {
      current = [optionVal]
    } else {
      if let idx = current.firstIndex(of: optionVal) {
        current.remove(at: idx)
      } else {
        current.append(optionVal)
      }
    }

    if let binding = node.dataBinding(for: "value") as DataBinding<[String]>? {
      binding.set(current)
    } else if let stringBinding = node.dataBinding(for: "value") as DataBinding<String>? {
      stringBinding.set(current.first ?? "")
    } else {
      fallbackSelections = current
    }
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if !labelText.isEmpty {
        Text(labelText)
          .font(.subheadline.weight(.medium))
          .foregroundStyle(hasError ? Color.red : Color.secondary)
      }

      if isFilterable {
        HStack {
          Image(systemName: "magnifyingglass")
            .foregroundStyle(.secondary)
          TextField("Search options", text: $filterText)
            .textFieldStyle(.plain)
        }
        .padding(8)
        .background(Color.gray.opacity(0.12))
        .cornerRadius(8)
        .accessibilityIdentifier("A2UIChoicePicker_Search_\(node.id)")
      }

      if displayStyle == "chips" {
        chipsView
      } else {
        checkboxListView
      }

      if let firstError = validationErrors.first {
        Text(firstError)
          .font(.caption)
          .foregroundStyle(Color.red)
          .accessibilityIdentifier("A2UIChoicePicker_Error_\(node.id)")
      }
    }
    .accessibilityIdentifier("A2UIChoicePicker_\(node.id)")
  }

  @ViewBuilder
  private var chipsView: some View {
    FlowLayout(spacing: 8, lineSpacing: 8) {
      ForEach(filteredOptions, id: \.id) { option in
        let isSelected = selectedValues.contains(option.value)
        Button(action: { toggleSelection(option.value) }) {
          Text(option.label)
            .font(.subheadline)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(isSelected ? Color.accentColor : Color.gray.opacity(0.12))
            .foregroundStyle(isSelected ? Color.white : Color.primary)
            .clipShape(Capsule())
            .overlay(
              Capsule()
                .stroke(Color.primary.opacity(0.1), lineWidth: isSelected ? 0 : 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("A2UIChoiceOption_\(option.value)")
      }
    }
  }

  @ViewBuilder
  private var checkboxListView: some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(filteredOptions, id: \.id) { option in
        let isSelected = selectedValues.contains(option.value)
        Button(action: { toggleSelection(option.value) }) {
          HStack(spacing: 10) {
            Image(
              systemName: variant == "mutuallyExclusive"
                ? (isSelected ? "largecircle.fill.circle" : "circle")
                : (isSelected ? "checkmark.square.fill" : "square")
            )
            .font(.system(size: 18))
            .foregroundStyle(isSelected ? Color.accentColor : Color.secondary)

            Text(option.label)
              .font(.body)
              .foregroundStyle(Color.primary)

            Spacer()
          }
          .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("A2UIChoiceOption_\(option.value)")
      }
    }
  }
}
