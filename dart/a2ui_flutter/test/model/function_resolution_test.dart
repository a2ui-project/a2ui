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

import 'package:a2ui_flutter/src/catalog/basic_functions.dart';
import 'package:a2ui_flutter/src/model/data_model.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('DataContext Function Resolution', () {
    late DataModel dataModel;
    late DataContext context;

    setUp(() {
      dataModel = InMemoryDataModel();
      context = DataContext(
        dataModel,
        DataPath.root,
        functions: BasicFunctions.all,
      );
    });

    test('resolves simple function call', () async {
      final Map<String, Object> input = {
        'call': 'formatNumber',
        'args': {'value': 1234.56, 'decimalPlaces': 1},
      };
      final String result = await eval<String>(input, context);
      expect(result, isA<String>());
    });

    test('resolves required function returning boolean', () async {
      final Map<String, Object> input = {
        'call': 'required',
        'args': {'value': 'some value'},
      };
      expect(await eval<bool>(input, context), isTrue);
    });

    test('resolves nested function calls', () async {
      final Map<String, Object> input = {
        'call': 'not',
        'args': {
          'value': {
            'call': 'and',
            'args': {
              'values': [true, false],
            },
          },
        },
      };
      // and([true, false]) -> false
      // not(false) -> true
      expect(await eval<bool>(input, context), isTrue);
    });

    test('resolves nested async function calls with asStream', () async {
      final Map<String, Object> input = {
        'call': 'required',
        'args': {
          'value': {
            'call': 'formatString',
            'args': {'value': ''},
          },
        },
      };
      // formatString('') -> Stream('')
      // required(Stream('')) -> Stream(false)
      final Stream<Object?> stream = context.resolve(input);
      expect(await stream.first, isFalse);
    });

    test('resolves arguments with expressions', () async {
      dataModel.update(DataPath('/name'), 'World');
      final Map<String, Object> input = {
        'call': 'formatString',
        'args': {'value': r'Hello ${/name}'},
      };
      expect(await eval<String>(input, context), 'Hello World');
    });

    test('returns original object if not a function call', () async {
      final input = {'other': 'value'};
      final Stream<Object?> stream = context.resolve(input);
      expect(await stream.first, input);
    });
  });
}

Future<T> eval<T>(Object? input, DataContext context) async {
  final Object result = context.resolve(input);
  if (result is Stream) {
    return (await result.first) as T;
  }
  return result as T;
}
