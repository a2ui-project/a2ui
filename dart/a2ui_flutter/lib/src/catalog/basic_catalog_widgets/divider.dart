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

import '../../model/catalog_item.dart';
import '../../primitives/simple_items.dart';

final _schema = S.object(
  description: 'A thin horizontal or vertical line used to separate content.',
  properties: {
    'axis': S.string(enumValues: ['horizontal', 'vertical']),
  },
);

extension type _DividerData.fromMap(JsonMap _json) {
  factory _DividerData({String? axis}) => _DividerData.fromMap({'axis': axis});

  String? get axis => _json['axis'] as String?;
}

/// A thin horizontal or vertical line used to separate content.
///
/// This widget displays a thin line to separate content, either horizontally
/// or vertically.
///
/// ## Parameters:
///
/// - `axis`: The direction of the divider. Can be `horizontal` or `vertical`.
///   Defaults to `horizontal`.
final divider = CatalogItem(
  name: 'Divider',
  dataSchema: _schema,
  widgetBuilder: (itemContext) {
    final dividerData = _DividerData.fromMap(itemContext.data as JsonMap);
    if (dividerData.axis == 'vertical') {
      return const VerticalDivider();
    }
    return const Divider();
  },
  exampleData: [
    () => '''
      [
        {
          "id": "root",
          "component": "Divider"
        }
      ]
    ''',
  ],
);
