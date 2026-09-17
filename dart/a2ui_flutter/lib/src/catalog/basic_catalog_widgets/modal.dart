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

/// @docImport '../../widgets/surface.dart';
library;

import 'package:flutter/material.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../../model/a2ui_schemas.dart';
import '../../model/catalog_item.dart';
import '../../primitives/simple_items.dart';
import '../../widgets/surface.dart' show Surface;

final _schema = S.object(
  description: 'A modal overlay that slides up from the bottom of the screen.',
  properties: {
    'trigger': A2uiSchemas.componentReference(
      description: 'The widget that opens the modal.',
    ),
    'content': A2uiSchemas.componentReference(
      description: 'The widget to display in the modal.',
    ),
  },
  required: ['trigger', 'content'],
);

extension type _ModalData.fromMap(JsonMap _json) {
  factory _ModalData({required String trigger, required String content}) =>
      _ModalData.fromMap({'trigger': trigger, 'content': content});

  String get trigger {
    final Object? val = _json['trigger'];
    if (val is String) return val;

    if (val == null) {
      return '';
    }
    throw ArgumentError('Invalid trigger: $val');
  }

  String get content {
    final Object? val = _json['content'];
    if (val is String) return val;
    throw ArgumentError('Invalid content: $val');
  }
}

/// A modal overlay that slides up from the bottom of the screen.
///
/// This component doesn't render the modal content directly. Instead, it
/// renders the `trigger` widget. The `trigger` is expected to
/// trigger an action (e.g., on button press) that causes the `content` to
/// be displayed within a modal bottom sheet by the [Surface].
///
/// ## Parameters:
///
/// - `trigger`: The ID of the widget that opens the modal.
/// - `content`: The ID of the widget to display in the modal.
final modal = CatalogItem(
  name: 'Modal',
  dataSchema: _schema,
  widgetBuilder: (itemContext) {
    final modalData = _ModalData.fromMap(itemContext.data as JsonMap);
    return ElevatedButton(
      onPressed: () {
        showModalBottomSheet<void>(
          context: itemContext.buildContext,
          builder: (context) {
            return itemContext.buildChild(modalData.content);
          },
        );
      },
      child: itemContext.buildChild(modalData.trigger),
    );
  },
  exampleData: [
    () => '''
      [
        {
          "id": "root",
          "component": "Modal",
          "trigger": "trigger_text",
          "content": "modal_content"
        },
        {
          "id": "trigger_text",
          "component": "Text",
          "text": "Open Modal"
        },
        {
          "id": "modal_content",
          "component": "Text",
          "text": "This is a modal."
        }
      ]
    ''',
  ],
);
