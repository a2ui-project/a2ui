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

/// Times the composition checks of [MessageProcessor.processMessages] under
/// a validation config that defers the graph checks, as an agent's renderer
/// state configures it.
///
/// The tests are tagged `performance`, which `dart_test.yaml` skips unless
/// the `performance` preset is selected, as in `dart test -P performance`.
@Tags(['performance'])
library;

import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

import 'support/renderer_catalog.dart';
import 'support/timing.dart';

/// A catalog whose `Column` holds only `Text` children.
final Catalog<ComponentApi, FunctionImplementation> _catalog = rendererCatalog(
  {
    'catalogId': 'allowed_children',
    'components': {
      'Column': {
        'type': 'object',
        'allowedChildren': ['Text'],
        'properties': {
          'children': {r'$ref': '#/\$defs/ChildList'},
        },
      },
      'Text': {
        'type': 'object',
        'properties': {
          'text': {'type': 'string'},
        },
      },
    },
  },
  protocolVersion: '1.0',
);

void main() {
  test('checks each child once when children arrive one per message', () {
    // `root` lists every child up front, and the children then arrive one
    // per message. Each child is checked against `root` without reading the
    // other children, so the time grows with the number of children rather
    // than its square.
    const Map<String, Object?> testCase = {
      'payload': [
        '[{"version": "1.0", "createSurface": {"surfaceId": "s1", '
            '"catalogId": "allowed_children"}}, '
            '{"version": "1.0", "updateComponents": {"surfaceId": "s1", '
            '"components": [{"id": "root", "component": "Column", '
            '"children": [',
        {'repeat': '"item_{i}"', 'separator': ', '},
        ']}]}}, ',
        {
          'repeat': '{"version": "1.0", "updateComponents": '
              '{"surfaceId": "s1", "components": [{"id": "item_{i}", '
              '"component": "Text", "text": "Item number {i}"}]}}',
          'separator': ', ',
        },
        ']',
      ],
    };

    /// Processes the payload at [size] on a new processor.
    void Function() process(int size) {
      final Object? messages = jsonDecode(writePayload(testCase, size));
      return () => MessageProcessor<ComponentApi>(
            catalogs: [_catalog],
            validationConfig: ValidationConfig.relaxed,
          ).processMessages(messages);
    }

    expectTimeRatio(
      process(2000),
      process(500),
      8,
      what: 'processMessages at 2000 children against 500',
    );
  });
}
