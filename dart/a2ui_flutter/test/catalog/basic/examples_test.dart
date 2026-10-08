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

import 'dart:convert';
import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/basic_catalog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../../support/fake_video_player_platform.dart';
import '../../support/image_server.dart';
import '../../support/surface_harness.dart';

final Schema _dynamicNumber = Schema.fromMap({
  r'$ref':
      'https://a2ui.org/specification/v0_9/common_types.json#/\$defs/DynamicNumber',
});

/// Stand-ins for the custom components an example names in
/// `customComponents`.
final List<ComponentImplementation> _customComponents = [
  ComponentImplementation(
    name: 'CustomGrid',
    schema: Schema.object(
      properties: {
        'title': CommonSchemas.dynamicString,
        'description': CommonSchemas.dynamicString,
        'children': CommonSchemas.childList,
      },
    ),
    builder: (context, node, props, buildChild) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(props.string('title') ?? ''),
        for (final ComponentNode<ComponentImplementation> child
            in props.children('children'))
          buildChild(child),
      ],
    ),
  ),
  ComponentImplementation(
    name: 'CustomSlider',
    schema: Schema.object(
      properties: {
        'label': CommonSchemas.dynamicString,
        'value': _dynamicNumber,
        'min': _dynamicNumber,
        'max': _dynamicNumber,
      },
    ),
    builder: (context, node, props, buildChild) =>
        Text('${props.string('label')}: ${props.string('value')}'),
  ),
];

/// One spec example: its messages and the custom components it names.
class _Example {
  _Example(File file)
    : name = file.uri.pathSegments.last,
      _document = jsonDecode(file.readAsStringSync()) as Map<String, Object?>;

  final String name;
  final Map<String, Object?> _document;

  List<Map<String, Object?>> get messages => [
    for (final Object? message in _document['messages']! as List)
      message! as Map<String, Object?>,
  ];

  /// The basic catalog, with the stand-ins for any custom components.
  WidgetCatalog get catalog {
    final Set<String> custom = {
      ...?(_document['customComponents'] as List?)?.cast<String>(),
    };
    final WidgetCatalog basic = basicCatalog();
    if (custom.isEmpty) return basic;
    return basic.copyWith(
      components: [
        ...basic.components.values,
        ..._customComponents.where((c) => custom.contains(c.name)),
      ],
    );
  }
}

/// Processes [example]'s messages as one payload, as an agent sends them,
/// then pumps the surface and lets its images load.
///
/// Each message is checked on its own, so the graph checks a surface built
/// across several messages cannot pass yet are relaxed: a missing root,
/// references to components a later message adds, and components left
/// unreachable, since v0.9 cannot remove a component. Fails on any other
/// processing error, an exception while rendering or an error the surface
/// reports.
Future<void> _render(WidgetTester tester, _Example example) async {
  final SurfaceHarness harness = await pumpSurface(
    tester,
    example.messages,
    catalog: example.catalog,
    validationConfig: const ValidationConfig(
      allowOrphanComponents: true,
      allowDanglingReferences: true,
      allowMissingRoot: true,
    ),
  );
  await settleImages(tester);

  expect(tester.takeException(), isNull);
  expect(harness.errors, isEmpty);
  expect(
    find.descendant(of: find.byType(A2uiSurface), matching: find.byType(Text)),
    findsWidgets,
  );
}

void main() {
  final List<_Example> examples = [
    for (final File file in Directory(
      '../../specification/v0_9/catalogs/basic/examples',
    ).listSync().whereType<File>().where((f) => f.path.endsWith('.json')))
      _Example(file),
  ]..sort((a, b) => a.name.compareTo(b.name));

  setUp(() => FakeVideoPlayerPlatform().install());

  test('finds the examples', () => expect(examples, isNotEmpty));

  for (final example in examples) {
    testWidgets('renders ${example.name}', (tester) async {
      await withImageServer(
        ImageServer({}, fallback: widePng),
        () => _render(tester, example),
      );
    });
  }
}
