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
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

class _TestFn extends FunctionImplementation {
  _TestFn(
    String name,
    this.body, {
    Schema? argumentSchema,
  }) : super(name: name, argumentSchema: argumentSchema ?? Schema.object());

  final Object? Function(Map<String, dynamic> args, DataContext context) body;

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) =>
      body(args, context);
}

void main() {
  group('FormatStringFunction', () {
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
          protocolVersion: A2uiProtocolVersion.v1_0,
        );

        final Object? syncResult = ctx.resolveDynamicValue({
          '@call': 'formatString',
          'args': {'value': r'Hello ${/user/name} (${role})!'},
        });
        expect(syncResult, 'Hello Alice (admin)!');

        final ReadonlySignal<Object?> listenable = ctx.resolveSignal({
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
        protocolVersion: A2uiProtocolVersion.v1_0,
      );

      final ReadonlySignal<Object?> listenable = ctx.resolveSignal({
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
        protocolVersion: A2uiProtocolVersion.v0_9,
      );

      expect(
        ctx.resolveDynamicValue({
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
          protocolVersion: A2uiProtocolVersion.v1_0,
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

    test(
      'inherits formatString catalogId for v1.0 template calls '
      'while keeping @index catalogless',
      () {
        final Catalog<ComponentApi, FunctionImplementation> basic =
            BasicCatalog.v1_0();
        final surface = SurfaceModel<ComponentApi>(
          's-no-default',
          protocolVersion: '1.0',
          availableCatalogs: [basic],
        );
        addTearDown(surface.dispose);
        final errors = <A2uiRendererError>[];
        surface.onError.subscribe(errors.add);
        final root = ComponentModel('root', 'Text', {});
        final DataContext rootCtx = ComponentContext(
          surface,
          root,
          basePath: '/items/2',
          index: 2,
        ).dataContext;

        const template = r'Row ${@index()}: '
            r"${pluralize(value: 2, one: 'drop', other: 'drops')} "
            r'(${not(value: not(value: true))})';
        final Map<String, Object?> callExpr = {
          '@call': 'formatString',
          'catalogId': basic.id,
          'args': {'value': template},
        };
        expect(rootCtx.resolveDynamicValue(callExpr), 'Row 2: drops (true)');
        expect(rootCtx.resolveSignal(callExpr).value, 'Row 2: drops (true)');
        expect(errors, isEmpty);
      },
    );

    test(
      'resolves v1.0 template calls in formatString catalog even when '
      'surface defaultCatalog differs, and via standalone Catalog.invoke',
      () {
        final Catalog<ComponentApi, FunctionImplementation> basic =
            BasicCatalog.v1_0();
        final custom = Catalog<ComponentApi, FunctionImplementation>(
          id: 'conformance/custom',
          components: const [],
          functions: const [],
          protocolVersion: A2uiProtocolVersion.v1_0,
        );
        final surface = SurfaceModel<ComponentApi>(
          's-custom-default',
          protocolVersion: '1.0',
          defaultCatalog: custom,
          availableCatalogs: [custom, basic],
        );
        addTearDown(surface.dispose);
        final errors = <A2uiRendererError>[];
        surface.onError.subscribe(errors.add);
        final root = ComponentModel('root', 'Text', {});
        final DataContext rootCtx = ComponentContext(
          surface,
          root,
        ).dataContext;

        final Map<String, Object?> callExpr = {
          '@call': 'formatString',
          'catalogId': basic.id,
          'args': {
            'value':
                r"Count: ${pluralize(value: 2, one: 'drop', other: 'drops')}",
          },
        };
        expect(rootCtx.resolveDynamicValue(callExpr), 'Count: drops');
        expect(rootCtx.resolveSignal(callExpr).value, 'Count: drops');
        expect(errors, isEmpty);

        // Standalone DataContext without invokerForCatalog using basic.invoke:
        final standaloneCtx = DataContext(
          DataModel(),
          basic.invoke,
          '/',
          protocolVersion: A2uiProtocolVersion.v1_0,
        );
        final Object? standaloneRes = basic.invoke(
          'formatString',
          {
            'value': r'Standalone: '
                r"${pluralize(value: 1, one: 'item', other: 'items')}",
          },
          standaloneCtx,
        );
        expect(
          standaloneRes is ReadonlySignal ? standaloneRes.value : standaloneRes,
          'Standalone: item',
        );

        // Direct `extCat.invoke(...)` over a surface DataContext where
        // `extCat` is not in `surface.availableCatalogs`:
        final FunctionImplementation formatString =
            basic.functions['formatString']!;
        final extCat = Catalog<ComponentApi, FunctionImplementation>(
          id: 'https://example.com/ext-direct/catalog.json',
          components: const [],
          protocolVersion: A2uiProtocolVersion.v1_0,
          functions: [
            formatString,
            _TestFn('extOnly', (args, ctx) => 'from-ext'),
          ],
        );
        final Object? extRes = extCat.invoke(
          'formatString',
          {'value': r'Got ${extOnly()}'},
          rootCtx,
        );
        expect(
          extRes is ReadonlySignal ? extRes.value : extRes,
          'Got from-ext',
        );
        expect(errors, isEmpty);

        // Same-ID catalog invoker replacement: an outer catalog without
        // `pluralize` invokes an executable catalog sharing the same ID.
        final fullSameId = Catalog<ComponentApi, FunctionImplementation>(
          id: basic.id,
          components: const [],
          protocolVersion: A2uiProtocolVersion.v1_0,
          functions: [formatString, basic.functions['pluralize']!],
        );
        final partialSameId = Catalog<ComponentApi, FunctionImplementation>(
          id: basic.id,
          components: const [],
          protocolVersion: A2uiProtocolVersion.v1_0,
          functions: [
            _TestFn(
              'delegateFormat',
              (args, ctx) => fullSameId.invoke('formatString', args, ctx),
              argumentSchema: Schema.object(
                properties: {'value': Schema.string()},
              ),
            ),
          ],
        );
        final Object? delegatedRes = partialSameId.invoke(
          'delegateFormat',
          {
            'value':
                r"SameId: ${pluralize(value: 2, one: 'drop', other: 'drops')}",
          },
          standaloneCtx,
        );
        expect(
          delegatedRes is ReadonlySignal ? delegatedRes.value : delegatedRes,
          'SameId: drops',
        );

        // Pre-adapted `@call` AST parts keep their catalogless shape while
        // parser `{call, ...}` nodes inherit the active catalog.
        var checkedPreAdapted = false;
        final inspectCat = Catalog<ComponentApi, FunctionImplementation>(
          id: 'https://example.com/inspect/catalog.json',
          components: const [],
          protocolVersion: A2uiProtocolVersion.v1_0,
          functions: [
            _TestFn('inspectAdapt', (args, ctx) {
              final Object? preAdapted = ctx.adaptExpressionPart({
                '@call': 'otherFn',
                'args': {
                  'inner': {'call': 'nestedFn', 'args': <String, Object?>{}},
                },
              });
              expect(
                preAdapted,
                {
                  '@call': 'otherFn',
                  'args': {
                    'inner': {
                      '@call': 'nestedFn',
                      'catalogId': 'https://example.com/inspect/catalog.json',
                      'args': <String, Object?>{},
                      'returnType': 'any',
                    },
                  },
                },
              );
              checkedPreAdapted = true;
              return 'ok';
            }),
          ],
        );
        expect(
          inspectCat.invoke('inspectAdapt', {}, standaloneCtx),
          'ok',
        );
        expect(checkedPreAdapted, isTrue);
      },
    );
  });
}
