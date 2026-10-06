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
import '../../model/ui_models.dart';
import '../../primitives/simple_items.dart';
import 'widget_helpers.dart';

const _verticalColumnSpacing = 8.0;

final _schema = S.object(
  description: 'A layout widget that arranges its children vertically.',
  properties: {
    'justify': S.string(
      description: 'How children are aligned on the main axis. ',
      enumValues: [
        'start',
        'center',
        'end',
        'spaceBetween',
        'spaceAround',
        'spaceEvenly',
        'stretch', // Added stretch to match keys
      ],
    ),
    'align': S.string(
      description: 'How children are aligned on the cross axis. ',
      enumValues: ['start', 'center', 'end', 'stretch'],
    ),
    'children': A2uiSchemas.componentArrayReference(
      description:
          'Either an explicit list of widget IDs for the children, or a '
          'template with a data binding to the list of children.',
    ),
  },
  required: ['children'],
);

extension type _ColumnData.fromMap(JsonMap _json) {
  factory _ColumnData({Object? children, String? justify, String? align}) =>
      _ColumnData.fromMap({
        'children': children,
        'justify': justify,
        'align': align,
      });

  Object? get children => _json['children'];
  String? get justify => _json['justify'] as String?;
  String? get align => _json['align'] as String?;
}

MainAxisAlignment _parseMainAxisAlignment(String? alignment) =>
    switch (alignment) {
      'start' => .start,
      'center' => .center,
      'end' => .end,
      'spaceBetween' => .spaceBetween,
      'spaceAround' => .spaceAround,
      'spaceEvenly' => .spaceEvenly,
      _ => .start,
    };

CrossAxisAlignment _parseCrossAxisAlignment(String? alignment) =>
    switch (alignment) {
      'start' => .start,
      'center' => .center,
      'end' => .end,
      'stretch' => .stretch,
      _ => .start,
    };

/// A layout widget that arranges its children in a vertical sequence.
///
/// This widget is analogous to Flutter's [Column] widget. It arranges a list of
/// child components from top to bottom.
///
/// ## Parameters:
///
/// - `justify`: How the children should be placed along the main axis. Can
///   be `start`, `center`, `end`, `spaceBetween`, `spaceAround`, or
///   `spaceEvenly`. Defaults to `start`.
/// - `align`: How the children should be aligned on the cross axis. Can
///   be `start`, `center`, `end`, or `stretch`. Defaults to
///   `start`.
/// - `children`: A list of child widget IDs to display in the column.
final column = CatalogItem(
  name: 'Column',
  dataSchema: _schema,
  widgetBuilder: (itemContext) {
    final columnData = _ColumnData.fromMap(itemContext.data as JsonMap);
    return ComponentChildrenBuilder(
      childrenData: columnData.children,
      dataContext: itemContext.dataContext,
      buildChild: itemContext.buildChild,
      getComponent: itemContext.getComponent,
      explicitListBuilder: (childIds, buildChild, getComponent, dataContext) {
        return Column(
          mainAxisAlignment: _parseMainAxisAlignment(columnData.justify),
          crossAxisAlignment: _parseCrossAxisAlignment(columnData.align),
          mainAxisSize: MainAxisSize.min,
          spacing: _verticalColumnSpacing,
          children: childIds.map((componentId) {
            final explicitWeight =
                getComponent(componentId)?.properties['weight'] as int?;
            final bool isImplicitlyFlexible =
                itemContext
                    .getCatalogItem(getComponent(componentId)?.type ?? '')
                    ?.isImplicitlyFlexible ??
                false;
            final int? weight =
                explicitWeight ?? (isImplicitlyFlexible ? 1 : null);
            final FlexFit fit = explicitWeight != null
                ? FlexFit.tight
                : FlexFit.loose;

            return buildWeightedChild(
              componentId: componentId,
              dataContext: dataContext,
              buildChild: buildChild,
              weight: weight,
              flexFit: fit,
            );
          }).toList(),
        );
      },
      templateListWidgetBuilder: (context, data, componentId, dataBinding) {
        final List<Object?> values;
        final List<String> keys;

        if (data is List) {
          values = data;
          keys = List.generate(data.length, (index) => index.toString());
        } else if (data is Map) {
          values = data.values.toList();
          keys = data.keys.map((k) => k.toString()).toList();
        } else {
          return const SizedBox.shrink();
        }

        final Component? component = itemContext.getComponent(componentId);
        final explicitWeight = component?.properties['weight'] as int?;
        final bool isImplicitlyFlexible =
            itemContext
                .getCatalogItem(component?.type ?? '')
                ?.isImplicitlyFlexible ??
            false;
        final int? weight = explicitWeight ?? (isImplicitlyFlexible ? 1 : null);
        final FlexFit fit = explicitWeight != null
            ? FlexFit.tight
            : FlexFit.loose;

        return Column(
          mainAxisAlignment: _parseMainAxisAlignment(columnData.justify),
          crossAxisAlignment: _parseCrossAxisAlignment(columnData.align),
          mainAxisSize: MainAxisSize.min,
          children: [
            for (var i = 0; i < values.length; i++) ...[
              buildWeightedChild(
                componentId: componentId,
                dataContext: itemContext.dataContext.nested(
                  DataPath('$dataBinding/${keys[i]}'),
                ),
                buildChild: itemContext.buildChild,
                weight: weight,
                flexFit: fit,
                key: ValueKey(keys[i]),
              ),
            ],
          ],
        );
      },
    );
  },
  exampleData: [
    () => '''
      [
        {
          "id": "root",
          "component": "Column",
          "children": [
            "advice_text",
            "advice_options",
            "submit_button"
          ]
        },
        {
          "id": "advice_text",
          "component": "Text",
          "text": "What kind of advice are you looking for?"
        },
        {
          "id": "advice_options",
          "component": "Text",
          "text": "Some advice options."
        },
        {
          "id": "submit_button",
          "component": "Button",
          "child": "submit_button_text",
          "action": {
            "event": {
              "name": "submit"
            }
          }
        },
        {
          "id": "submit_button_text",
          "component": "Text",
          "text": "Submit"
        }
      ]
    ''',
  ],
);
