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

const _horizontalRowSpacing = 16.0;

final _schema = S.object(
  description: 'A layout widget that arranges its children horizontally.',
  properties: {
    'children': A2uiSchemas.componentArrayReference(
      description:
          'Either an explicit list of widget IDs for the children, or a '
          'template with a data binding to the list of children.',
    ),
    'justify': S.string(
      enumValues: [
        'start',
        'center',
        'end',
        'spaceBetween',
        'spaceAround',
        'spaceEvenly',
        'stretch',
      ],
    ),
    'align': S.string(enumValues: ['start', 'center', 'end', 'stretch']),
  },
  required: ['children'],
);

extension type _RowData.fromMap(JsonMap _json) {
  factory _RowData({Object? children, String? justify, String? align}) =>
      _RowData.fromMap({
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

/// A layout widget that arranges its children in a horizontal sequence.
///
/// This widget is analogous to Flutter's [Row] widget. It arranges a list of
/// child components from left to right.
///
/// ## Parameters:
///
/// - `children`: A list of child widget IDs to display in the row.
/// - `justify`: How the children should be placed along the main axis. Can
///   be `start`, `center`, `end`, `spaceBetween`, `spaceAround`, or
///   `spaceEvenly`. Defaults to `start`.
/// - `align`: How the children should be aligned on the cross axis. Can
///   be `start`, `center`, `end`, or `stretch`. Defaults to
///   `start`.
final row = CatalogItem(
  name: 'Row',
  dataSchema: _schema,
  widgetBuilder: (itemContext) {
    final rowData = _RowData.fromMap(itemContext.data as JsonMap);
    return ComponentChildrenBuilder(
      childrenData: rowData.children,
      dataContext: itemContext.dataContext,
      buildChild: itemContext.buildChild,
      getComponent: itemContext.getComponent,
      explicitListBuilder: (childIds, buildChild, getComponent, dataContext) {
        return Row(
          mainAxisAlignment: _parseMainAxisAlignment(rowData.justify),
          crossAxisAlignment: _parseCrossAxisAlignment(rowData.align),
          mainAxisSize: MainAxisSize.min,
          spacing: _horizontalRowSpacing,
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

        return Row(
          mainAxisAlignment: _parseMainAxisAlignment(rowData.justify),
          crossAxisAlignment: _parseCrossAxisAlignment(rowData.align),
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
          "component": "Row",
          "children": [
            "text1",
            "text2"
          ]
        },
        {
          "id": "text1",
          "component": "Text",
          "text": "First"
        },
        {
          "id": "text2",
          "component": "Text",
          "text": "Second"
        }
      ]
    ''',
  ],
);
