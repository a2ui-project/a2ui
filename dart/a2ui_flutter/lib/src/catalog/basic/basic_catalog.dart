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

import 'package:a2ui_core/a2ui_core.dart';

import '../../component_implementation.dart';
import 'audio_player.dart';
import 'button.dart';
import 'card.dart';
import 'check_box.dart';
import 'choice_picker.dart';
import 'column.dart';
import 'date_time_input.dart';
import 'divider.dart';
import 'icon.dart';
import 'image.dart';
import 'list.dart';
import 'modal.dart';
import 'row.dart';
import 'slider.dart';
import 'tabs.dart';
import 'text.dart';
import 'text_field.dart';
import 'theme.dart';
import 'video.dart';

/// The v0.9 basic catalog: every basic component, and the functions of
/// [BasicCatalog.v0_9] formatting for [locale], under the basic catalog's id,
/// theme schema, title and description.
///
/// An `openUrl` call, which fails without [openUrl], may run whenever a bound
/// property resolves, not only on a tap.
WidgetCatalog basicCatalog({
  String locale = 'en-US',
  OpenUrlCallback? openUrl,
}) => WidgetCatalog(
  id: BasicCatalog.v0_9Id,
  components: BasicComponents.all,
  functions: BasicCatalog.v0_9(
    locale: locale,
    openUrl: openUrl,
  ).functions.values.toList(),
  themeSchema: BasicComponents.api.themeSchema,
  schemaId: BasicComponents.api.schemaId,
  title: BasicComponents.api.title,
  description: BasicComponents.api.description,
);

/// The v0.9 basic catalog's component implementations.
abstract final class BasicComponents {
  /// The basic catalog's specification: every component and function schema
  /// and the theme schema.
  static final CatalogApi api = BasicCatalog.v0_9Api();

  /// The basic `AudioPlayer` component.
  static final ComponentImplementation audioPlayer = _implement(
    'AudioPlayer',
    buildAudioPlayer,
  );

  /// The basic `Button` component.
  static final ComponentImplementation button = _implement(
    'Button',
    buildButton,
  );

  /// The basic `Card` component.
  static final ComponentImplementation card = _implement('Card', buildCard);

  /// The basic `CheckBox` component.
  static final ComponentImplementation checkBox = _implement(
    'CheckBox',
    buildCheckBox,
  );

  /// The basic `ChoicePicker` component.
  static final ComponentImplementation choicePicker = _implement(
    'ChoicePicker',
    buildChoicePicker,
  );

  /// The basic `Column` component.
  static final ComponentImplementation column = _implement(
    'Column',
    buildColumn,
  );

  /// The basic `DateTimeInput` component.
  static final ComponentImplementation dateTimeInput = _implement(
    'DateTimeInput',
    buildDateTimeInput,
  );

  /// The basic `Divider` component.
  static final ComponentImplementation divider = _implement(
    'Divider',
    buildDivider,
  );

  /// The basic `Icon` component.
  static final ComponentImplementation icon = _implement('Icon', buildIcon);

  /// The basic `Image` component.
  static final ComponentImplementation image = _implement('Image', buildImage);

  /// The basic `List` component.
  static final ComponentImplementation list = _implement('List', buildList);

  /// The basic `Modal` component.
  static final ComponentImplementation modal = _implement('Modal', buildModal);

  /// The basic `Row` component.
  static final ComponentImplementation row = _implement('Row', buildRow);

  /// The basic `Slider` component.
  static final ComponentImplementation slider = _implement(
    'Slider',
    buildSlider,
  );

  /// The basic `Tabs` component.
  static final ComponentImplementation tabs = _implement('Tabs', buildTabs);

  /// The basic `Text` component.
  static final ComponentImplementation text = _implement('Text', buildText);

  /// The basic `TextField` component.
  static final ComponentImplementation textField = _implement(
    'TextField',
    buildTextField,
  );

  /// The basic `Video` component.
  static final ComponentImplementation video = _implement('Video', buildVideo);

  /// Every basic component.
  static List<ComponentImplementation> get all => [
    audioPlayer,
    button,
    card,
    checkBox,
    choicePicker,
    column,
    dateTimeInput,
    divider,
    icon,
    image,
    list,
    modal,
    row,
    slider,
    tabs,
    text,
    textField,
    video,
  ];

  static ComponentImplementation _implement(
    String name,
    ComponentWidgetBuilder builder,
  ) => ComponentImplementation(
    name: name,
    schema: api.components[name]!.schema,
    builder: (context, node, props, buildChild) => BasicTheme(
      builder: (context) => builder(context, node, props, buildChild),
    ),
  );
}
