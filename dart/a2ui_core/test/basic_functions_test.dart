// Copyright 2026 Google LLC
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
import 'package:test/test.dart';

void main() {
  group('FormatStringFunction (#69)', () {
    late DataModel dataModel;
    late FormatStringFunction formatString;

    Object? invokeFunction(
      String name,
      Map<String, dynamic> args,
      DataContext context,
    ) {
      if (name == 'formatString') {
        return formatString.execute(args, context);
      }
      if (name == 'upper') {
        return (args['value']?.toString() ?? '').toUpperCase();
      }
      if (name == 'joinPair') {
        return '${args['a']}:${args['b']}';
      }
      throw ArgumentError('Unknown function: $name');
    }

    setUp(() {
      dataModel = DataModel();
      dataModel.set('/user/name', 'Alice');
      dataModel.set('/user/role', 'admin');
      dataModel.set('/items', ['one', 'two']);
      dataModel.set('/meta', {'k': 'v'});
      formatString = FormatStringFunction();
      addTearDown(dataModel.dispose);
    });

    test(
      'interpolates path bindings in v1.0 mode instead of JSON-encoding AST',
      () {
        final ctx = DataContext(
          dataModel,
          invokeFunction,
          '/user',
          protocolVersion: 'v1.0',
        );

        final Object? syncResult = ctx.resolveSync({
          '@call': 'formatString',
          'args': {'value': r'Hello ${/user/name} (${role})!'},
        });
        expect(syncResult, 'Hello Alice (admin)!');

        final ReadonlySignal<Object?> listenable = ctx.resolveListenable({
          '@call': 'formatString',
          'args': {'value': r'Hello ${/user/name} (${role})!'},
        });
        expect(listenable.value, 'Hello Alice (admin)!');

        dataModel.set('/user/name', 'Bob');
        expect(listenable.value, 'Hello Bob (admin)!');
      },
    );

    test('recursively adapts nested function calls and args in v1.0 mode', () {
      final ctx = DataContext(
        dataModel,
        invokeFunction,
        '/user',
        protocolVersion: 'v1.0',
      );

      final ReadonlySignal<Object?> listenable = ctx.resolveListenable({
        '@call': 'formatString',
        'args': {
          'value':
              r'User: ${joinPair(a: upper(value: ${/user/name}), b: ${role})}',
        },
      });
      expect(listenable.value, 'User: ALICE:admin');

      dataModel.set('/user/role', 'editor');
      expect(listenable.value, 'User: ALICE:editor');
    });

    test('interpolates path bindings, maps, lists, and nulls in v0.9 mode', () {
      final ctx = DataContext(
        dataModel,
        invokeFunction,
        '/',
        protocolVersion: 'v0.9',
      );

      expect(
        ctx.resolveSync({
          'call': 'formatString',
          'args': {
            'value': r'${/user/name} - ${/missing} - ${/items} - ${/meta}',
          },
        }),
        'Alice -  - ["one","two"] - {"k":"v"}',
      );
    });

    test(
      'returns static string without reactive computed when no dynamic parts',
      () {
        final ctx = DataContext(
          dataModel,
          invokeFunction,
          '/',
          protocolVersion: 'v1.0',
        );

        expect(formatString.execute({'value': ''}, ctx), '');
        expect(
          formatString.execute({'value': 'plain text'}, ctx),
          'plain text',
        );
        expect(
          formatString.execute({'value': r'escaped \${/user/name}'}, ctx),
          r'escaped ${/user/name}',
        );
      },
    );
  });
}
