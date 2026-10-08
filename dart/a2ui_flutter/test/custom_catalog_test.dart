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

import 'dart:async';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/basic_catalog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import 'support/surface_harness.dart';

const String _demoCatalogId = 'https://example.com/demo/catalog.json';

/// A star rating from 0 to 5 whose `value` is two-way.
final ComponentImplementation _rating = ComponentImplementation(
  name: 'Rating',
  schema: Schema.object(
    properties: {
      'label': CommonSchemas.dynamicString,
      'value': Schema.fromMap({
        r'$ref':
            'https://a2ui.org/specification/v0_9/common_types.json#/\$defs/DynamicNumber',
      }),
      'onChanged': CommonSchemas.action,
    },
    required: ['value'],
  ),
  builder: (context, node, props, buildChild) {
    final WritableBinding<Object?>? value = props.writable('value');
    final double rating = props.number('value') ?? 0;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(props.string('label') ?? ''),
        for (var star = 1; star <= 5; star++)
          IconButton(
            tooltip: '$star',
            icon: Icon(star <= rating ? Icons.star : Icons.star_border),
            onPressed: value == null
                ? null
                : () {
                    value.set(star);
                    unawaited(props.action('onChanged')?.call());
                  },
          ),
      ],
    );
  },
);

WidgetCatalog _demoCatalog([List<ComponentImplementation> extra = const []]) =>
    WidgetCatalog(
      id: _demoCatalogId,
      components: [
        BasicComponents.row,
        BasicComponents.column,
        BasicComponents.text,
        _rating,
        ...extra,
      ],
      functions: BasicCatalog.v0_9().functions.values.toList(),
      themeSchema: BasicComponents.api.themeSchema,
    );

List<Map<String, Object?>> _review(Object? value) => [
  {
    'id': 'root',
    'component': 'Column',
    'children': ['title', 'rating'],
  },
  {'id': 'title', 'component': 'Text', 'text': 'Your review'},
  {
    'id': 'rating',
    'component': 'Rating',
    'label': 'Stars',
    'value': value,
    'onChanged': {
      'event': {
        'name': 'rated',
        'context': {
          'stars': {'path': '/stars'},
        },
      },
    },
  },
];

void main() {
  testWidgets('renders basic and custom components under its own id', (
    tester,
  ) async {
    final SurfaceHarness harness = await pumpComponents(
      tester,
      _review({'path': '/stars'}),
      catalog: _demoCatalog(),
      data: {'stars': 2},
    );

    expect(harness.surface().defaultCatalog?.id, _demoCatalogId);
    expect(find.text('Your review'), findsOneWidget);
    expect(find.text('Stars'), findsOneWidget);
    expect(find.byIcon(Icons.star), findsNWidgets(2));
    expect(find.byIcon(Icons.star_border), findsNWidgets(3));
    expect(harness.errors, isEmpty);
  });

  testWidgets('gives a builder the surface through A2uiSurface.of', (
    tester,
  ) async {
    final themed = ComponentImplementation(
      name: 'Themed',
      schema: Schema.object(),
      builder: (context, node, props, buildChild) =>
          Text('${A2uiSurface.of(context).theme['primaryColor']}'),
    );
    await pumpSurface(tester, [
      createSurface(_demoCatalogId, theme: {'primaryColor': '#00BFFF'}),
      updateComponents([
        {'id': 'root', 'component': 'Themed'},
      ]),
    ], catalog: _demoCatalog([themed]));

    expect(find.text('#00BFFF'), findsOneWidget);
    expect(A2uiSurface.maybeOf(tester.element(find.byType(Scaffold))), isNull);
  });

  testWidgets('writes a bound DynamicNumber back and sends the action', (
    tester,
  ) async {
    final SurfaceHarness harness = await pumpComponents(
      tester,
      _review({'path': '/stars'}),
      catalog: _demoCatalog(),
      data: {'stars': 2},
    );

    await tester.tap(find.byTooltip('4'));
    await tester.pump();

    expect(harness.data('/stars'), 4);
    expect(find.byIcon(Icons.star), findsNWidgets(4));
    expect(harness.actions.single.name, 'rated');
    expect(harness.actions.single.context, {'stars': 4});
  });

  testWidgets('leaves an app key equal to a component id or type to the '
      "builder's widget", (tester) async {
    final stepper = ComponentImplementation(
      name: 'Stepper',
      schema: Schema.object(properties: {}),
      builder: (context, node, props, buildChild) => const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('3', key: Key('qty')),
          Text('+', key: Key('Stepper')),
        ],
      ),
    );

    await pumpComponents(tester, [
      {
        'id': 'root',
        'component': 'Row',
        'children': ['qty'],
      },
      {'id': 'qty', 'component': 'Stepper'},
    ], catalog: _demoCatalog([stepper]));

    expect(tester.widget<Text>(find.byKey(const Key('qty'))).data, '3');
    expect(tester.widget<Text>(find.byKey(const Key('Stepper'))).data, '+');
  });
}
