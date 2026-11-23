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

import 'package:a2ui_core/src/resolution/schema_defaults.dart';
import 'package:test/test.dart';

void main() {
  group('withSchemaDefaults', () {
    test('fills in absent and null properties', () {
      expect(
        withSchemaDefaults(
          {'a': 1, 'b': null},
          {
            'properties': {
              'a': {'default': 0},
              'b': {'default': 'b'},
              'c': {'default': null},
              'd': {'type': 'string'},
            },
          },
        ),
        {'a': 1, 'b': 'b', 'c': null},
      );
    });

    test('fills in nested objects present in the arguments only', () {
      const Map<String, Object?> schema = {
        'properties': {
          'options': {
            'type': 'object',
            'properties': {
              'extended': {'default': false},
            },
          },
          'absent': {
            'type': 'object',
            'properties': {
              'flag': {'default': true},
            },
          },
        },
      };
      expect(withSchemaDefaults({'options': <String, Object?>{}}, schema), {
        'options': {'extended': false},
      });
    });

    test(r'reads defaults through allOf and $defs references', () {
      const Map<String, Object?> schema = {
        r'$defs': {
          'Currency': {'type': 'string', 'default': 'USD'},
          'Base': {
            'properties': {
              'base': {'default': 1},
            },
          },
        },
        'allOf': [
          {r'$ref': r'#/$defs/Base'},
          {
            'properties': {
              'currency': {r'$ref': r'#/$defs/Currency'},
            },
          },
        ],
      };
      expect(withSchemaDefaults({}, schema), {'base': 1, 'currency': 'USD'});
    });

    test('copies the arguments and the defaults', () {
      final defaultList = [1];
      final nested = <String, Object?>{'x': 1};
      final Map<String, Object?> result = withSchemaDefaults(
        {'nested': nested},
        {
          'properties': {
            'list': {'default': defaultList},
            'nested': {
              'properties': {
                'y': {'default': 2},
              },
            },
          },
        },
      );
      (result['list']! as List<Object?>).add(2);

      expect(defaultList, [1]);
      expect(nested, {'x': 1});
      expect(result['nested'], {'x': 1, 'y': 2});
    });

    test(r'stops at a recursive $ref', () {
      const Map<String, Object?> schema = {
        r'$defs': {
          'Loop': {r'$ref': r'#/$defs/Loop'},
        },
        r'$ref': r'#/$defs/Loop',
      };
      expect(withSchemaDefaults({'a': 1}, schema), {'a': 1});
    });
  });
}
