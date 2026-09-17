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

import '../model/catalog.dart';
import '../model/catalog_item.dart';
import '../primitives/constants.dart';
import 'basic_catalog_widgets/audio_player.dart' as audio_player_item;
import 'basic_catalog_widgets/button.dart' as button_item;
import 'basic_catalog_widgets/card.dart' as card_item;
import 'basic_catalog_widgets/check_box.dart' as check_box_item;
import 'basic_catalog_widgets/choice_picker.dart' as choice_picker_item;
import 'basic_catalog_widgets/column.dart' as column_item;
import 'basic_catalog_widgets/date_time_input.dart' as date_time_input_item;
import 'basic_catalog_widgets/divider.dart' as divider_item;
import 'basic_catalog_widgets/icon.dart' as icon_item;
import 'basic_catalog_widgets/image.dart' as image_item;
import 'basic_catalog_widgets/list.dart' as list_item;
import 'basic_catalog_widgets/modal.dart' as modal_item;
import 'basic_catalog_widgets/row.dart' as row_item;
import 'basic_catalog_widgets/slider.dart' as slider_item;
import 'basic_catalog_widgets/tabs.dart' as tabs_item;
import 'basic_catalog_widgets/text.dart' as text_item;
import 'basic_catalog_widgets/text_field.dart' as text_field_item;
import 'basic_catalog_widgets/video.dart' as video_item;
import 'basic_functions.dart';

/// A collection of basic catalog items that can be used to build simple
/// interactive UIs.
abstract final class BasicCatalogItems {
  BasicCatalogItems._();

  /// A UI element for playing audio content.
  ///
  /// This typically includes controls like play/pause, seek, and volume.
  static final CatalogItem audioPlayer = audio_player_item.audioPlayer;

  /// An interactive button that triggers an action when pressed.
  ///
  /// Conforms to Material Design guidelines for elevated buttons.
  static final CatalogItem button = button_item.button;

  /// A Material Design card, a container for related information and
  /// actions.
  ///
  /// Often used to group content visually.
  static final CatalogItem card = card_item.card;

  /// A checkbox that allows the user to toggle a boolean state.
  static final CatalogItem checkBox = check_box_item.checkBox;

  /// A layout widget that arranges its children in a vertical
  /// sequence.
  static final CatalogItem column = column_item.column;

  /// A widget for selecting a date and/or time.
  static final CatalogItem dateTimeInput = date_time_input_item.dateTimeInput;

  /// A thin horizontal line used to separate content.
  static final CatalogItem divider = divider_item.divider;

  /// An icon.
  static final CatalogItem icon = icon_item.icon;

  /// A UI element for displaying image data from a URL or other
  /// source.
  static final CatalogItem image = image_item.image;

  /// A scrollable list of child widgets.
  ///
  /// Can be configured to lay out items linearly.
  static final CatalogItem list = list_item.list;

  /// A modal overlay that slides up from the bottom of the screen.
  ///
  /// Used to present a set of options or a piece of content requiring user
  /// interaction.
  static final CatalogItem modal = modal_item.modal;

  /// A widget allowing the user to select one or more options from a
  /// list.
  static final CatalogItem choicePicker = choice_picker_item.choicePicker;

  /// A layout widget that arranges its children in a horizontal
  /// sequence.
  static final CatalogItem row = row_item.row;

  /// A slider control for selecting a value from a range.
  static final CatalogItem slider = slider_item.slider;

  /// A set of tabs for navigating between different views or
  /// sections.
  static final CatalogItem tabs = tabs_item.tabs;

  /// A block of styled text.
  static final CatalogItem text = text_item.text;

  /// An input field where the user can enter text.
  static final CatalogItem textField = text_field_item.textField;

  /// A UI element for playing video content.
  ///
  /// This typically includes controls like play/pause, seek, and volume.
  static final CatalogItem video = video_item.video;

  static final String basicCatalogRules = _basicCatalogRules;

  /// Creates a basic catalog without items that require additional data.
  ///
  /// This is useful for the app, that do not work with images, audio or video.
  static Catalog asNoAssetCatalog({
    List<String> systemPromptFragments = const [],
  }) => asCatalog(
    systemPromptFragments: systemPromptFragments,
  ).copyWithout(itemsToRemove: [audioPlayer, image, video]);

  /// Creates a catalog with all basic catalog items.
  ///
  /// Some items (audioPlayer, image, video) require additional data to be
  /// properly displayed. If the app does not work with such data, use
  /// [asNoAssetCatalog] instead.
  static Catalog asCatalog({List<String> systemPromptFragments = const []}) {
    return Catalog(
      [
        audioPlayer,
        button,
        card,
        checkBox,
        column,
        dateTimeInput,
        divider,
        icon,
        image,
        list,
        modal,
        choicePicker,
        row,
        slider,
        tabs,
        text,
        textField,
        video,
      ],
      functions: BasicFunctions.all,
      catalogId: basicCatalogId,
      catalogIdAliases: const [legacyBasicCatalogId],
      systemPromptFragments: [basicCatalogRules, ...systemPromptFragments],
    );
  }
}

/// The text content of basic_catalog_rules.txt.
const String _basicCatalogRules = r'''
**REQUIRED PROPERTIES:** You MUST include ALL required properties for every component, even if they are inside a template or will be bound to data.
- For 'Text', you MUST provide 'text'. If dynamic, use { "path": "..." }.
- For 'Image', you MUST provide 'url'. If dynamic, use { "path": "..." }.
- For 'Button', you MUST provide 'action'.
- For 'TextField', 'CheckBox', etc., you MUST provide 'label'.

**EXAMPLES:**

1. Create a surface:
```json
{
  "version": "v0.9",
  "createSurface": {
    "surfaceId": "main",
    "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
    "sendDataModel": true
  }
}
```

2. Update components:
```json
{
  "version": "v0.9",
  "updateComponents": {
    "surfaceId": "main",
    "components": [
      {
        // The root component MUST have id "root"
        "id": "root",
        "component": "Column",
        "justify": "start",
        "children": [
          "headerText",
          "content"
        ]
      }
    ]
  }
}
```

**IMPORTANT:**
- One of the components sent in one of the `updateComponents` MUST have id "root", or nothing will be displayed.
- Do NOT nest `components` inside `createSurface`. Use `updateComponents` to add components to a surface.
- `createSurface` ONLY sets up the surface (ID and catalog). It does NOT take content.
- To show a UI, you typically send a `createSurface` message (if the surface doesn't exist), followed by an `updateComponents` message.
''';
