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

import 'dart:convert';
import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

/// [MessageProcessor.forAgent], which an agent checks its own payloads with,
/// over the schema-only catalog it negotiated.
void main() {
  final CatalogApi catalog = Catalog.fromJson(
    jsonDecode(
      File(
        '../../conformance/test_data/catalogs/simplified_catalog_v1_0.json',
      ).readAsStringSync(),
    ) as Map<String, Object?>,
  );

  MessageProcessor<ComponentApi> forAgent({
    ValidationConfig? validationConfig = ValidationConfig.strict,
  }) {
    final MessageProcessor<ComponentApi> processor = MessageProcessor.forAgent(
      catalogs: [catalog],
      validationConfig: validationConfig,
    );
    addTearDown(processor.model.dispose);
    return processor;
  }

  Map<String, Object?> createSurface(List<Map<String, Object?>> components) => {
        'version': 'v1.0',
        'createSurface': {
          'surfaceId': 's',
          'catalogId': catalog.id,
          'components': components,
        },
      };

  Map<String, Object?> callRendererFunction(Map<String, Object?> call) => {
        'version': 'v1.0',
        'callRendererFunction': {
          'functionCallId': 'call_1',
          'callFunction': {'catalogId': catalog.id, ...call},
        },
      };

  test('holds every function of the catalog as its signature', () {
    final MessageProcessor<ComponentApi> processor = forAgent();
    final Catalog<ComponentApi, FunctionImplementation> held =
        processor.catalogs.single;
    expect(held.id, catalog.id);
    expect(held.functions.keys, catalog.functions.keys);
    expect(
      held.functions['openUrl']!.requiresUserActivation,
      catalog.functions['openUrl']!.requiresUserActivation,
    );
  });

  test('applies a payload the catalog accepts', () {
    final MessageProcessor<ComponentApi> processor = forAgent();
    processor.processMessages([
      createSurface([
        {'id': 'root', 'component': 'Text', 'text': 'Hello'},
      ]),
    ]);
    expect(
      processor.model.getSurface('s')!.componentsModel.all.single.type,
      'Text',
    );
  });

  test('rejects a component the catalog does not declare', () {
    expect(
      () => forAgent().processMessages([
        createSurface([
          {'id': 'root', 'component': 'Marquee', 'text': 'Hello'},
        ]),
      ]),
      throwsA(isA<A2uiValidationError>()),
    );
  });

  test('checks the graph strictly by default', () {
    expect(
      () => forAgent().processMessages([
        createSurface([
          {'id': 'title', 'component': 'Text', 'text': 'Hello'},
        ]),
      ]),
      throwsA(isA<A2uiError>()),
    );
  });

  test('ignores a response to a call the renderer made', () {
    forAgent().processMessages([
      {
        'version': 'v1.0',
        'agentFunctionResponse': {'functionCallId': 'call_1', 'value': 42},
      },
    ]);
  });

  group('callRendererFunction', () {
    const notImplemented =
        'Checking a callRendererFunction is not implemented yet.';

    test(
      'accepts a call to a function the catalog declares',
      skip: notImplemented,
      () {
        forAgent().processMessages([
          callRendererFunction({
            '@call': 'formatString',
            'args': {'value': 'Hello'},
          }),
        ]);
      },
    );

    test(
      'rejects a call to a function the catalog does not declare',
      skip: notImplemented,
      () {
        expect(
          () => forAgent().processMessages([
            callRendererFunction({'@call': 'vibrate', 'args': {}}),
          ]),
          throwsA(isA<A2uiValidationError>()),
        );
      },
    );

    test(
      'rejects arguments that do not match the signature',
      skip: notImplemented,
      () {
        expect(
          () => forAgent().processMessages([
            callRendererFunction({
              '@call': 'formatString',
              'args': {'text': 'Hello'},
            }),
          ]),
          throwsA(isA<A2uiValidationError>()),
        );
      },
    );

    test(
      'rejects a call naming a catalog it does not hold',
      skip: notImplemented,
      () {
        expect(
          () => forAgent().processMessages([
            callRendererFunction({
              'catalogId': 'elsewhere',
              '@call': 'formatString',
              'args': {'value': 'Hello'},
            }),
          ]),
          throwsA(isA<A2uiCatalogError>()),
        );
      },
    );

    test('throws until it is implemented', () {
      expect(
        () => forAgent().processMessages([
          callRendererFunction({
            '@call': 'formatString',
            'args': {'value': 'Hello'},
          }),
        ]),
        throwsA(isA<UnimplementedError>()),
      );
    });
  });
}
