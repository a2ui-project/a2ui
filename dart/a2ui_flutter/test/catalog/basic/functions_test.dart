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
import 'package:a2ui_flutter/basic_catalog.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/surface_harness.dart';

const Map<String, Object?> _label = {
  'id': 'label',
  'component': 'Text',
  'text': 'Submit',
};

void main() {
  group('openUrl', () {
    const Map<String, Object?> openDocs = {
      'id': 'root',
      'component': 'Button',
      'child': 'label',
      'action': {
        'functionCall': {
          'call': 'openUrl',
          'args': {'url': 'https://example.com/docs'},
        },
      },
    };

    testWidgets('hands the URL of an action to the openUrl callback', (
      tester,
    ) async {
      final opened = <Uri>[];
      final SurfaceHarness harness = await pumpComponents(tester, [
        openDocs,
        _label,
      ], catalog: basicCatalog(openUrl: opened.add));

      await tester.tap(find.text('Submit'));
      await tester.pump();

      expect(opened, [Uri.parse('https://example.com/docs')]);
      expect(harness.actions, isEmpty);
      expect(harness.errors, isEmpty);
    });

    testWidgets('on v1.0, runs for a tap but not for a binding', (
      tester,
    ) async {
      final opened = <Uri>[];
      final SurfaceHarness harness = await pumpComponents(
        tester,
        [
          {
            'id': 'root',
            'component': 'Column',
            'children': ['button', 'bound'],
          },
          {
            'id': 'button',
            'component': 'Button',
            'child': 'label',
            'action': {
              'functionCall': {
                '@call': 'openUrl',
                'args': {'url': 'https://example.com/docs'},
              },
            },
          },
          _label,
          {
            'id': 'bound',
            'component': 'Text',
            'text': {
              '@call': 'openUrl',
              'args': {'url': 'https://example.com/bound'},
            },
          },
        ],
        catalog: basicCatalogV1_0(openUrl: opened.add),
        version: A2uiProtocolVersion.v1_0,
      );
      expect(opened, isEmpty);
      expect(harness.errorCodes, ['EXPRESSION_ERROR']);

      await tester.tap(find.text('Submit'));
      await tester.pump();

      expect(opened, [Uri.parse('https://example.com/docs')]);
    });
  });
}
