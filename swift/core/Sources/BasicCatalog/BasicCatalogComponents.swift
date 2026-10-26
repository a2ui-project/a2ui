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

/// Component API definitions for all 18 standard components in the A2UI Basic Catalog.
public enum BasicCatalogComponents: Sendable {
  // MARK: - Component Definitions (v0.9 / v0.9.1)

  public static let text: AnyComponentAPI = V09BasicCatalogComponents.text
  public static let image: AnyComponentAPI = V09BasicCatalogComponents.image
  public static let icon: AnyComponentAPI = V09BasicCatalogComponents.icon
  public static let video: AnyComponentAPI = V09BasicCatalogComponents.video
  public static let audioPlayer: AnyComponentAPI = V09BasicCatalogComponents.audioPlayer
  public static let row: AnyComponentAPI = V09BasicCatalogComponents.row
  public static let column: AnyComponentAPI = V09BasicCatalogComponents.column
  public static let list: AnyComponentAPI = V09BasicCatalogComponents.list
  public static let card: AnyComponentAPI = V09BasicCatalogComponents.card
  public static let tabs: AnyComponentAPI = V09BasicCatalogComponents.tabs
  public static let modal: AnyComponentAPI = V09BasicCatalogComponents.modal
  public static let divider: AnyComponentAPI = V09BasicCatalogComponents.divider
  public static let button: AnyComponentAPI = V09BasicCatalogComponents.button
  public static let textField: AnyComponentAPI = V09BasicCatalogComponents.textField
  public static let checkBox: AnyComponentAPI = V09BasicCatalogComponents.checkBox
  public static let choicePicker: AnyComponentAPI = V09BasicCatalogComponents.choicePicker
  public static let slider: AnyComponentAPI = V09BasicCatalogComponents.slider
  public static let dateTimeInput: AnyComponentAPI = V09BasicCatalogComponents.dateTimeInput

  // MARK: - Component Definitions (v1.0)

  public static let v10Text: AnyComponentAPI = V10BasicCatalogComponents.text
  public static let v10Image: AnyComponentAPI = V10BasicCatalogComponents.image
  public static let v10Icon: AnyComponentAPI = V10BasicCatalogComponents.icon
  public static let v10Video: AnyComponentAPI = V10BasicCatalogComponents.video
  public static let v10AudioPlayer: AnyComponentAPI = V10BasicCatalogComponents.audioPlayer
  public static let v10Row: AnyComponentAPI = V10BasicCatalogComponents.row
  public static let v10Column: AnyComponentAPI = V10BasicCatalogComponents.column
  public static let v10List: AnyComponentAPI = V10BasicCatalogComponents.list
  public static let v10Card: AnyComponentAPI = V10BasicCatalogComponents.card
  public static let v10Tabs: AnyComponentAPI = V10BasicCatalogComponents.tabs
  public static let v10Modal: AnyComponentAPI = V10BasicCatalogComponents.modal
  public static let v10Divider: AnyComponentAPI = V10BasicCatalogComponents.divider
  public static let v10Button: AnyComponentAPI = V10BasicCatalogComponents.button
  public static let v10TextField: AnyComponentAPI = V10BasicCatalogComponents.textField
  public static let v10CheckBox: AnyComponentAPI = V10BasicCatalogComponents.checkBox
  public static let v10ChoicePicker: AnyComponentAPI = V10BasicCatalogComponents.choicePicker
  public static let v10Slider: AnyComponentAPI = V10BasicCatalogComponents.slider
  public static let v10DateTimeInput: AnyComponentAPI = V10BasicCatalogComponents.dateTimeInput

  // MARK: - All Components (v0.9 / v0.9.1)

  public static let allComponents: [AnyComponentAPI] =
    V09BasicCatalogComponents.allComponents

  // MARK: - All Components (v1.0)

  public static let v10Components: [AnyComponentAPI] =
    V10BasicCatalogComponents.allComponents
}
