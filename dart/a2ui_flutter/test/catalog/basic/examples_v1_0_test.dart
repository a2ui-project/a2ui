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

// SPIKE: renders every v1.0 basic catalog example through A2uiSurface,
// validated against the v1.0 common types a2ui_core embeds.

import 'dart:convert';
import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/basic_catalog.dart';
// ignore: deprecated_member_use, see https://github.com/a2ui-project/a2ui/issues/3235
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_video_player_platform.dart';
import '../../support/image_server.dart';
import '../../support/surface_harness.dart';

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
}

Future<void> _render(
  WidgetTester tester,
  _Example example,
  ValidationConfig? config,
) async {
  final SurfaceHarness harness = await pumpSurface(
    tester,
    example.messages,
    catalog: basicCatalogV1_0(),
    validationConfig: config,
    version: A2uiProtocolVersion.v1_0,
  );
  await settleImages(tester);

  final Object? exception = tester.takeException();
  expect(exception, isNull, reason: 'render exception: $exception');
  expect(
    harness.errors.map((e) => '${e.code}: ${e.message}').toList(),
    isEmpty,
  );
  expect(
    find.descendant(of: find.byType(A2uiSurface), matching: find.byType(Text)),
    findsWidgets,
  );
}

void main() {
  final List<_Example> examples = [
    for (final File file in Directory(
      '../../catalogs/basic/v1/examples',
    ).listSync().whereType<File>().where((f) => f.path.endsWith('.json')))
      _Example(file),
  ]..sort((a, b) => a.name.compareTo(b.name));

  setUp(() => FakeVideoPlayerPlatform().install());

  test('finds the examples', () => expect(examples, hasLength(43)));

  const Map<String, ValidationConfig> configs = {
    'relaxed': ValidationConfig(
      allowOrphanComponents: true,
      allowDanglingReferences: true,
      allowMissingRoot: true,
    ),
    'strict': ValidationConfig.strict,
  };

  for (final MapEntry<String, ValidationConfig> config in configs.entries) {
    group(config.key, () {
      for (final example in examples) {
        testWidgets('renders ${example.name}', (tester) async {
          await withImageServer(
            ImageServer({}, fallback: widePng),
            () => _render(tester, example, config.value),
          );
        });
      }
    });
  }
}
