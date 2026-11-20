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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

/// A catalog function that counts its runs.
class _Counted extends FunctionImplementation {
  _Counted(FunctionApi api)
    : super(
        name: api.name,
        argumentSchema: api.argumentSchema,
        returnType: api.returnType,
        allowedCallers: api.declaredAllowedCallers,
        definition: api.definition,
      );

  int runs = 0;

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    runs++;
    return 'pong';
  }
}

void main() {
  final CatalogApi basic = BasicCatalog.v0_9();
  final Catalog<ComponentApi, FunctionImplementation> rendererBasic = basic
      .withFunctions(const <FunctionImplementation>[]);
  final create = CreateSurfaceMessage(
    version: 'v0.9',
    surfaceId: 's',
    catalogId: basic.id,
  );

  UpdateComponentsMessage update(List<Map<String, Object?>> components) =>
      UpdateComponentsMessage(
        version: 'v0.9',
        surfaceId: 's',
        components: components,
      );

  group('RendererState.of', () {
    test("applies the messages it accepts to the processor's model", () {
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [rendererBasic],
      );
      final state = RendererState.of(processor);

      state.checkTopology(
        state.apply([
          create,
          update([
            {
              'id': 'root',
              'component': 'Column',
              'children': ['t'],
            },
            {'id': 't', 'component': 'Text', 'text': 'Hi'},
          ]),
        ]),
      );

      expect(state.catalogs.map((c) => c.id), [basic.id]);
      expect(state.getSurface('s'), same(processor.model.getSurface('s')));
      expect(processor.model.getSurface('s')!.componentsModel.size, 2);
    });

    test("checks messages by its own rules, whatever the processor's", () {
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [rendererBasic],
        validationConfig: ValidationConfig.strict,
      );
      final state = RendererState.of(processor)..apply([create]);

      expect(
        () => state.apply([
          update([
            {'id': 'root', 'component': 'Bogus'},
          ]),
        ]),
        throwsA(isA<A2uiValidationError>()),
      );
      // A component may name a child a later message adds, which the
      // processor's strict rules alone would reject.
      state.apply([
        update([
          {
            'id': 'root',
            'component': 'Column',
            'children': ['later'],
          },
        ]),
      ]);
      expect(processor.model.getSurface('s')!.componentsModel.size, 1);
    });

    test("takes a rolled-back message back out of the processor's model", () {
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [rendererBasic],
      );
      final state = RendererState.of(processor);

      expect(
        () => state.transaction(() {
          state
            ..apply([create])
            ..apply([
              update([
                {'id': 'root', 'component': 'Bogus'},
              ]),
            ]);
        }),
        throwsA(isA<A2uiValidationError>()),
      );

      expect(processor.model.getSurface('s'), isNull);
    });

    test("leaves the processor's surfaces to it when disposed", () {
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [rendererBasic],
      );
      RendererState.of(processor)
        ..apply([create])
        ..dispose();

      expect(processor.model.getSurface('s'), isNotNull);
    });

    test("rejects a processor whose catalogs can't make a state", () {
      expect(
        () => RendererState.of(MessageProcessor<ComponentApi>(catalogs: [])),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    group('function calls', () {
      late _Counted ping;
      late MessageProcessor<ComponentApi> processor;
      late RendererState state;
      const fnCatalogId = 'https://example.com/fn';
      final CatalogApi fnCatalog = Catalog.fromJson({
        'catalogId': fnCatalogId,
        'protocolVersion': '1.0',
        'components': <String, Object?>{},
        'functions': {
          'ping': {
            'type': 'object',
            'properties': {
              '@call': {'const': 'ping'},
              'args': {'type': 'object'},
            },
            'required': ['@call'],
            'returnType': 'string',
            'allowedCallers': 'rendererOrAgent',
          },
        },
      });
      final call = CallRendererFunctionMessage(
        version: '1.0',
        functionCallId: 'c1',
        callFunction: {
          '@call': 'ping',
          'catalogId': fnCatalogId,
          'args': <String, Object?>{},
        },
      );

      setUp(() {
        ping = _Counted(fnCatalog.functions['ping']!);
        processor = MessageProcessor<ComponentApi>(
          catalogs: [
            fnCatalog.withFunctions([ping]),
          ],
        );
        state = RendererState.of(processor);
      });

      test('runs once the outermost transaction succeeds', () async {
        state.transaction(() {
          state.apply([call]);
          expect(ping.runs, 0);
        });
        await pumpEventQueue();

        expect(ping.runs, 1);
      });

      test('never runs one that a failed transaction applied', () async {
        expect(
          () => state.transaction(() {
            state.apply([call]);
            throw StateError('rolled back');
          }),
          throwsStateError,
        );
        state.apply(const []);
        await pumpEventQueue();

        expect(ping.runs, 0);
      });

      test('runs one that a failed inner transaction did not apply', () async {
        state.transaction(() {
          state.apply([call]);
          expect(
            () => state.transaction(() {
              state.apply([call]);
              throw StateError('inner');
            }),
            throwsStateError,
          );
        });
        await pumpEventQueue();

        expect(ping.runs, 1);
      });

      test('rejects a call to a function the catalogs lack', () {
        expect(
          () => state.apply([
            CallRendererFunctionMessage(
              version: '1.0',
              functionCallId: 'c2',
              callFunction: {
                '@call': 'nope',
                'catalogId': fnCatalogId,
                'args': <String, Object?>{},
              },
            ),
          ]),
          throwsA(isA<A2uiValidationError>()),
        );
      });

      test('rejects a call with a malformed path when it is applied', () async {
        final badPath = CallRendererFunctionMessage(
          version: '1.0',
          functionCallId: 'c4',
          callFunction: {
            '@call': 'ping',
            'catalogId': fnCatalogId,
            'args': {
              'value': {'@path': '/invalid~path'},
            },
          },
        );

        state.transaction(() {
          expect(
            () => state.apply([badPath]),
            throwsA(isA<A2uiValidationError>()),
          );
        });
        await pumpEventQueue();

        expect(ping.runs, 0);
      });

      test('rejects a call that names a surface the state lacks', () {
        expect(
          () => state.apply([
            CallRendererFunctionMessage(
              version: '1.0',
              surfaceId: 'missing',
              functionCallId: 'c3',
              callFunction: {
                '@call': 'ping',
                'catalogId': fnCatalogId,
                'args': <String, Object?>{},
              },
            ),
          ]),
          throwsA(isA<A2uiValidationError>()),
        );
      });
    });
  });
}
