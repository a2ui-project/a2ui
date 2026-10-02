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
import 'package:json_schema_builder/json_schema_builder.dart';

import '../component_implementation.dart';
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

/// The standard canonical ID for the v0.9 basic catalog.
const String basicCatalogIdV09 =
    'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

/// Constructs a [Catalog] containing the Flutter implementations for the
/// Basic Catalog.
Catalog<FlutterComponentImplementation, FunctionImplementation>
createBasicCatalog({
  String id = basicCatalogIdV09,
  List<FlutterComponentImplementation> additionalComponents = const [],
  List<FunctionImplementation> additionalFunctions = const [],
}) {
  final defaultComponents = <FlutterComponentImplementation>[
    flutterTextImplementation,
    flutterColumnImplementation,
    flutterRowImplementation,
    flutterButtonImplementation,
    flutterTextFieldImplementation,
    flutterCardImplementation,
    flutterDividerImplementation,
    flutterCheckBoxImplementation,
    flutterSliderImplementation,
    flutterImageImplementation,
    flutterIconImplementation,
    flutterListImplementation,
    flutterModalImplementation,
    flutterTabsImplementation,
    flutterChoicePickerImplementation,
    flutterDateTimeInputImplementation,
  ];

  final defaultFunctions = <FunctionImplementation>[
    FormatStringFunction(),
    CapitalizeFunction(),
  ];

  return Catalog<FlutterComponentImplementation, FunctionImplementation>(
    id: id,
    components: [...defaultComponents, ...additionalComponents],
    functions: [...defaultFunctions, ...additionalFunctions],
    themeSchema: Schema.object(
      properties: {
        'primaryColor': Schema.string(pattern: r'^#[0-9a-fA-F]{6}$'),
      },
      additionalProperties: true,
    ),
  );
}
