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

import 'package:flutter/material.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../../model/a2ui_schemas.dart';
import '../../model/catalog_item.dart';
import '../../model/data_model.dart';
import '../../primitives/simple_items.dart';
import '../../widgets/widget_utilities.dart';
import 'widget_helpers.dart';

final _schema = S.object(
  description: 'A selectable checkbox used for boolean toggles with a label.',
  properties: {
    'label': A2uiSchemas.stringReference(),
    'value': A2uiSchemas.booleanReference(),
    'checks': A2uiSchemas.checkable(),
  },
  required: ['label', 'value'],
);

extension type _CheckBoxData.fromMap(JsonMap _json) {
  factory _CheckBoxData({
    required JsonMap label,
    required JsonMap value,
    List<JsonMap>? checks,
  }) =>
      _CheckBoxData.fromMap({'label': label, 'value': value, 'checks': checks});

  Object get label => _json['label'] as Object;
  Object get value => _json['value'] as Object;
  List<JsonMap>? get checks => (_json['checks'] as List?)?.cast<JsonMap>();
}

/// A Material Design checkbox with a label.
///
/// This widget displays a checkbox with a [Text] label. The checkbox's state
/// is bidirectionally bound to the data model path specified in the `value`
/// parameter.
///
/// ## Parameters:
///
/// - `label`: The text to display next to the checkbox.
/// - `value`: The boolean value of the checkbox.
final checkBox = CatalogItem(
  name: 'CheckBox',
  dataSchema: _schema,
  widgetBuilder: (itemContext) {
    final checkBoxData = _CheckBoxData.fromMap(itemContext.data as JsonMap);

    final Object valueRef = checkBoxData.value;
    final path = (valueRef is Map && valueRef.containsKey('path'))
        ? valueRef['path'] as String
        : '${itemContext.id}.value';

    return BoundString(
      dataContext: itemContext.dataContext,
      value: checkBoxData.label,
      builder: (context, label) {
        // Wrap the checkbox in validation
        return StreamBuilder<bool>(
          stream: itemContext.dataContext.evaluateConditionStream(
            checksToExpression(checkBoxData.checks),
          ),
          initialData: true,
          builder: (context, snapshot) {
            final bool isValid = snapshot.data ?? true;
            final bool isError = !isValid;

            return ListTileTheme.merge(
              child: BoundBool(
                dataContext: itemContext.dataContext,
                value: {'path': path},
                builder: (context, value) {
                  return CheckboxListTile(
                    title: Text(label ?? ''),
                    value: value ?? false,
                    onChanged: (bool? newValue) {
                      if (newValue != null) {
                        itemContext.dataContext.update(
                          DataPath(path),
                          newValue,
                        );
                      }
                    },
                    subtitle: isError
                        ? Text(
                            'Invalid value',
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.error,
                              fontSize: 12,
                            ),
                          )
                        : null,
                    isError: isError,
                  );
                },
              ),
            );
          },
        );
      },
    );
  },
  exampleData: [
    () => '''
      [
        {
          "id": "root",
          "component": "CheckBox",
          "label": "Check me",
          "value": {
            "path": "/myValue"
          }
        }
      ]
    ''',
  ],
  isImplicitlyFlexible: true,
);
