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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

/// A catalog document declaring `quote`, whose `currency` takes its default
/// from a shared definition.
const Map<String, Object?> _document = {
  'catalogId': 'cat',
  'protocolVersion': '1.0',
  'components': <String, Object?>{},
  'functions': {
    'quote': {
      'type': 'object',
      'description': 'Quotes a symbol.',
      'returnType': 'number',
      'properties': {
        '@call': {'const': 'quote'},
        'args': {
          'type': 'object',
          'properties': {
            'symbol': {'type': 'string'},
            'currency': {r'$ref': r'#/$defs/Currency'},
          },
          'required': ['symbol'],
          'additionalProperties': false,
        },
      },
      'required': ['@call', 'args'],
    },
  },
  r'$defs': {
    'Currency': {'type': 'string', 'default': 'USD'},
  },
};

Future<void> _flush() => Future<void>.delayed(Duration.zero);

void main() {
  late List<FunctionCall> agentCalls;
  late List<A2uiRendererError> errors;

  setUp(() {
    agentCalls = [];
    errors = [];
  });

  Future<Object?> callAgent(FunctionCall call) {
    agentCalls.add(call);
    return Completer<Object?>().future;
  }

  Catalog<ComponentApi, FunctionImplementation> rendererCatalog({
    String protocolVersion = '1.0',
  }) {
    final CatalogApi declared = Catalog.fromJson({
      ..._document,
      'protocolVersion': protocolVersion,
    });
    return declared.withFunctions(
      declared.functions.values.map(SchemaOnlyFunction.fromApi),
    );
  }

  DataContext contextFor(
    Catalog<ComponentApi, FunctionImplementation> catalog, {
    String protocolVersion = '1.0',
  }) {
    final surface = SurfaceModel<ComponentApi>(
      'surf',
      defaultCatalog: catalog,
      protocolVersion: protocolVersion,
      callAgentFunction: callAgent,
    );
    surface.onError.subscribe(errors.add);
    addTearDown(surface.dispose);
    return ComponentContext(
      surface,
      ComponentModel('root', 'Text', {}),
    ).dataContext;
  }

  const Map<String, Object?> quoteCall = {
    '@call': 'quote',
    'args': {'symbol': 'GOOG'},
  };

  group('SchemaOnlyFunction', () {
    test('fromApi keeps the signature and definition', () {
      final FunctionApi api = Catalog.fromJson(_document).functions['quote']!;
      final fn = SchemaOnlyFunction.fromApi(api);

      expect(fn.name, 'quote');
      expect(fn.returnType, A2uiReturnType.number);
      expect(fn.description, 'Quotes a symbol.');
      expect(fn.argumentSchema, same(api.argumentSchema));
      expect(fn.definition, same(api.definition));
      expect(rendererCatalog().toJson(), _document);
    });

    test('cannot be executed', () {
      final fn = SchemaOnlyFunction(
        name: 'remote',
        argumentSchema: Schema.object(),
      );
      expect(
        () => fn.execute(const {}, contextFor(rendererCatalog())),
        throwsUnsupportedError,
      );
    });

    test('is not a renderer function', () {
      expect(rendererCatalog().rendererFunctions, isEmpty);
      expect(rendererCatalog().functions.keys, ['quote']);
    });

    test('a binding sends it to the agent with schema defaults', () async {
      final DataContext context = contextFor(rendererCatalog());
      final ReadonlySignal<Object?> binding = context.resolveSignal(quoteCall);
      addTearDown(binding.subscribe((_) {}));

      expect(binding.value, isNull);
      expect(agentCalls.single.toJson(), {
        '@call': 'quote',
        'catalogId': 'cat',
        'args': {'symbol': 'GOOG', 'currency': 'USD'},
      });
      await _flush();
      expect(errors, isEmpty);
    });

    test('an action sends it to the agent with schema defaults', () async {
      final DataContext context = contextFor(rendererCatalog())
          .withUserActivation();
      unawaited(context.evaluateFunctionCall(quoteCall));
      await _flush();

      expect(agentCalls.single.args, {'symbol': 'GOOG', 'currency': 'USD'});
    });

    test('a one-shot read reports it without sending it', () async {
      final DataContext context = contextFor(rendererCatalog());

      expect(context.resolveDynamicValue(quoteCall), isNull);
      await _flush();
      expect(agentCalls, isEmpty);
      expect(errors.single.code, 'EXPRESSION_ERROR');
      expect(
        errors.single.message,
        contains("Function 'quote' in catalog 'cat' is schema-only"),
      );
    });

    test('is not sent before v1.0', () async {
      final DataContext context = contextFor(
        rendererCatalog(protocolVersion: '0.9'),
        protocolVersion: '0.9',
      );
      final ReadonlySignal<Object?> binding = context.resolveSignal({
        'call': 'quote',
        'args': {'symbol': 'GOOG'},
      });
      addTearDown(binding.subscribe((_) {}));

      expect(binding.value, isNull);
      await _flush();
      expect(agentCalls, isEmpty);
      expect(errors.single.message, contains('schema-only'));
    });
  });
}
