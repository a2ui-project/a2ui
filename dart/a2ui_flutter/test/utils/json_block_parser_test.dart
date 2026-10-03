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

import 'package:a2ui_flutter/src/utils/json_block_parser.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('JsonBlockParser', () {
    test('parses simple JSON block', () {
      const text = 'Here is some JSON:\n```json\n{"foo": "bar"}\n```';
      final Object? result = JsonBlockParser.parseFirstJsonBlock(text);
      expect(result, equals({'foo': 'bar'}));
    });

    test('parses multi-line JSON block', () {
      const text = '''
Here is some JSON:
```json
{
  "foo": "bar",
  "baz": [
    1,
    2,
    3
  ]
}
```
''';
      final Object? result = JsonBlockParser.parseFirstJsonBlock(text);
      expect(
        result,
        equals({
          'foo': 'bar',
          'baz': [1, 2, 3],
        }),
      );
    });

    test('parses JSON block without language tag', () {
      const text = '```\n{"foo": "bar"}\n```';
      final Object? result = JsonBlockParser.parseFirstJsonBlock(text);
      expect(result, equals({'foo': 'bar'}));
    });

    test('parses raw JSON in text', () {
      const text = 'Some text {"foo": "bar"} more text';
      final Object? result = JsonBlockParser.parseFirstJsonBlock(text);
      expect(result, equals({'foo': 'bar'}));
    });

    test('parses raw JSON with newlines', () {
      const text = 'Some text {\n"foo": "bar"\n} more text';
      final Object? result = JsonBlockParser.parseFirstJsonBlock(text);
      expect(result, equals({'foo': 'bar'}));
    });

    test('parses raw JSON array', () {
      const text = 'Some text ["foo", "bar"] more text';
      final Object? result = JsonBlockParser.parseFirstJsonBlock(text);
      expect(result, equals(['foo', 'bar']));
    });

    test('parses JSON block containing string with brackets and braces', () {
      const text = 'Some text {"foo": "[{test}]"} more text';
      final Object? result = JsonBlockParser.parseFirstJsonBlock(text);
      expect(result, equals({'foo': '[{test}]'}));
    });
  });
}
