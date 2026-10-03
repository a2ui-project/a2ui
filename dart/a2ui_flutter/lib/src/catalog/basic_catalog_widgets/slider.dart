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
  description: 'A slider for selecting a value from a range.',
  properties: {
    'value': A2uiSchemas.numberReference(),
    'min': S.number(description: 'The minimum value. Defaults to 0.0.'),
    'max': S.number(description: 'The maximum value. Defaults to 1.0.'),
    'label': A2uiSchemas.stringReference(
      description: 'The label for the slider.',
    ),
    'checks': A2uiSchemas.checkable(),
  },
  required: ['value'],
);

extension type _SliderData.fromMap(JsonMap _json) {
  factory _SliderData({
    required JsonMap value,
    double? min,
    double? max,
    List<JsonMap>? checks,
  }) => _SliderData.fromMap({
    'value': value,
    'min': min,
    'max': max,
    'checks': checks,
  });

  Object get value => _json['value'] as Object;
  double get min => (_json['min'] as num?)?.toDouble() ?? 0.0;
  double get max => (_json['max'] as num?)?.toDouble() ?? 1.0;
  List<JsonMap>? get checks => (_json['checks'] as List?)?.cast<JsonMap>();

  String? get label {
    final Object? val = _json['label'];
    if (val is String) return val;
    if (val is Map && val.containsKey('value')) {
      return val['value'] as String?;
    }
    return null;
  }
}

/// A Material Design slider.
///
/// This widget allows the user to select a value from a range by sliding a
/// thumb along a track. The `value` is bidirectionally bound to the data model.
/// This is analogous to Flutter's [Slider] widget.
///
/// ## Parameters:
///
/// - `value`: The current value of the slider.
/// - `min`: The minimum value of the slider. Defaults to 0.0.
/// - `max`: The maximum value of the slider. Defaults to 1.0.
/// - `label`: The label for the slider.
final slider = CatalogItem(
  name: 'Slider',
  dataSchema: _schema,
  widgetBuilder: (CatalogItemContext itemContext) {
    final sliderData = _SliderData.fromMap(itemContext.data as JsonMap);
    final Object valueRef = sliderData.value;
    final path = (valueRef is Map && valueRef.containsKey('path'))
        ? valueRef['path'] as String
        : '${itemContext.id}.value';

    return BoundNumber(
      dataContext: itemContext.dataContext,
      value: {'path': path},
      builder: (context, value) {
        // If value is null (nothing in DataContext yet), fall back to
        // literal value if provided.
        var effectiveValue = value;
        if (effectiveValue == null) {
          if (valueRef is num) {
            effectiveValue = valueRef;
          }
        }

        final Widget sliderWidget = Padding(
          padding: const EdgeInsetsDirectional.only(end: 16.0),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Expanded(
                child: Slider(
                  value: (effectiveValue ?? sliderData.min).toDouble(),
                  min: sliderData.min,
                  max: sliderData.max,
                  divisions: (sliderData.max - sliderData.min).toInt(),
                  onChanged: (newValue) {
                    itemContext.dataContext.update(DataPath(path), newValue);
                  },
                ),
              ),
              Text(
                value?.toStringAsFixed(0) ?? sliderData.min.toStringAsFixed(0),
              ),
            ],
          ),
        );

        return BoundString(
          dataContext: itemContext.dataContext,
          value: sliderData.label,
          builder: (context, label) {
            return StreamBuilder<bool>(
              stream: itemContext.dataContext.evaluateConditionStream(
                checksToExpression(sliderData.checks),
              ),
              initialData: true,
              builder: (context, snapshot) {
                final bool isValid = snapshot.data ?? true;
                final bool isError = !isValid;

                final List<Widget> children = [
                  if (label != null)
                    Padding(
                      padding: const EdgeInsets.only(left: 16.0, bottom: 8.0),
                      child: Text(
                        label,
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                    ),
                  sliderWidget,
                ];

                if (isError) {
                  children.add(
                    Padding(
                      padding: const EdgeInsets.only(left: 16.0, top: 4.0),
                      child: Text(
                        'Invalid value',
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  );
                }

                if (children.length == 1) {
                  return children.first;
                }
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: children,
                );
              },
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
          "component": "Slider",
          "min": 0,
          "max": 10,
          "value": {
            "path": "/myValue"
          }
        }
      ]
    ''',
  ],
);
