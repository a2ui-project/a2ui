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

import 'package:a2ui_flutter/src/catalog/basic_functions.dart';
import 'package:a2ui_flutter/src/model/client_function.dart';
import 'package:a2ui_flutter/src/model/data_model.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('BasicFunctions', () {
    late DataContext context;
    late DataModel dataModel;

    setUp(() {
      dataModel = InMemoryDataModel();
      context = DataContext(dataModel, DataPath.root);
    });

    Future<T> run<T>(ClientFunction func, Map<String, Object?> args) async {
      final Stream<Object?> result = func.execute(args, context);
      return (await result.first) as T;
    }

    test('required', () async {
      final RequiredFunction func = BasicFunctions.requiredFunction;
      expect(await run<bool>(func, {'value': 'foo'}), isTrue);
      expect(await run<bool>(func, {'value': ''}), isFalse);
      expect(await run<bool>(func, {'value': null}), isFalse);
      expect(await run<bool>(func, {'value': []}), isFalse);
      expect(
        await run<bool>(func, {
          'value': ['a'],
        }),
        isTrue,
      );
    });

    test('regex', () async {
      final RegexFunction func = BasicFunctions.regexFunction;
      expect(
        await run<bool>(func, {'value': 'hello', 'pattern': '^h.*o\$'}),
        isTrue,
      );
      expect(
        await run<bool>(func, {'value': 'hello', 'pattern': '^w.*d\$'}),
        isFalse,
      );
      expect(
        await run<bool>(func, {'value': null, 'pattern': '.*'}),
        isFalse, // null value doesn't match
      );
    });

    test('length', () async {
      final LengthFunction func = BasicFunctions.lengthFunction;
      expect(await run<int>(func, {'value': 'hello'}), 5);
      expect(
        await run<int>(func, {
          'value': [1, 2, 3],
        }),
        3,
      );
      expect(
        await run<int>(func, {
          'value': {'a': 1, 'b': 2},
        }),
        2,
      );
      expect(await run<int>(func, {'value': null}), 0);
    });

    test('and', () async {
      final AndFunction func = BasicFunctions.andFunction;
      expect(
        await run<bool>(func, {
          'values': [true, true],
        }),
        isTrue,
      );
      expect(
        await run<bool>(func, {
          'values': [true, false],
        }),
        isFalse,
      );
    });

    test('or', () async {
      final OrFunction func = BasicFunctions.orFunction;
      expect(
        await run<bool>(func, {
          'values': [false, false],
        }),
        isFalse,
      );
      expect(
        await run<bool>(func, {
          'values': [false, true],
        }),
        isTrue,
      );
    });

    test('not', () async {
      final NotFunction func = BasicFunctions.notFunction;
      expect(await run<bool>(func, {'value': true}), isFalse);
      expect(await run<bool>(func, {'value': false}), isTrue);
    });

    test('pluralize', () async {
      final PluralizeFunction func = BasicFunctions.pluralizeFunction;

      // Test with 'value'
      expect(
        await run<String>(func, {
          'value': 0,
          'zero': 'zero items',
          'other': 'other items',
        }),
        'zero items',
      );

      expect(
        await run<String>(func, {
          'value': 1,
          'one': 'one item',
          'other': 'other items',
        }),
        'one item',
      );

      expect(
        await run<String>(func, {'value': 2, 'other': 'other items'}),
        'other items',
      );

      // Test fallback to 'count'
      expect(
        await run<String>(func, {
          'count': 1,
          'one': 'one item',
          'other': 'other items',
        }),
        'one item',
      );

      // Test missing optional categories fall back to 'other'
      expect(
        await run<String>(func, {'value': 0, 'other': 'fallback'}),
        'fallback',
      );

      // Test return empty string if count is not a number
      expect(await run<String>(func, {'value': 'not a number'}), '');
    });
  });
}
