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

Schema _quoteSchema() => Schema.fromMap({
      'type': 'object',
      'properties': {
        'symbol': {'type': 'string'},
        'quantity': {'type': 'integer', 'default': 1},
      },
      'required': ['symbol'],
    });

Object? _noopHandler(
  Map<String, dynamic> args,
  AgentFunctionContext context,
) =>
    {
      'symbol': args['symbol'],
      'quantity': args['quantity'],
      'callId': context.functionCallId,
    };

void main() {
  group('AgentFunction', () {
    test('subclasses FunctionApi and not FunctionImplementation', () {
      final fn = AgentFunction(
        name: 'fetchQuote',
        description: 'Look up a quote.',
        returnType: A2uiReturnType.object,
        argumentSchema: _quoteSchema(),
        handler: _noopHandler,
      );

      expect(fn, isA<FunctionApi>());
      expect(fn, isNot(isA<FunctionImplementation>()));
      expect(fn.name, 'fetchQuote');
      expect(fn.returnType, A2uiReturnType.object);
      expect(fn.description, 'Look up a quote.');
      expect(fn.handler, same(_noopHandler));
      expect(fn.declaration, isNull);
    });

    test('fromApi copies declaration fields and attaches handler', () {
      final api = FunctionApi(
        name: 'fetchQuote',
        description: 'Look up a quote.',
        returnType: A2uiReturnType.object,
        argumentSchema: _quoteSchema(),
        allowedCallers: AllowedCallers.rendererOnly,
        requiresUserActivation: true,
        definition: const {
          'type': 'object',
          'returnType': 'object',
          'properties': {
            '@call': {'const': 'fetchQuote'},
          },
        },
      );

      final fn = AgentFunction.fromApi(api, _noopHandler);
      expect(fn.name, api.name);
      expect(fn.description, api.description);
      expect(fn.returnType, api.returnType);
      expect(fn.argumentSchema, same(api.argumentSchema));
      expect(fn.declaredAllowedCallers, AllowedCallers.rendererOnly);
      expect(fn.declaredRequiresUserActivation, isTrue);
      expect(fn.definition, same(api.definition));
      expect(fn.handler, same(_noopHandler));
      expect(fn.declaration, same(api));
    });

    test('fromApi rejects an existing AgentFunction', () {
      final fn = AgentFunction(
        name: 'fetchQuote',
        argumentSchema: _quoteSchema(),
        handler: _noopHandler,
      );
      expect(
        () => AgentFunction.fromApi(fn, _noopHandler),
        throwsArgumentError,
      );
    });
  });

  group('Catalog.agentFunctions', () {
    test(
        'standalone AgentFunction appears in functions, agentFunctions, '
        'toJson, and validationSchema', () {
      final fn = AgentFunction(
        name: 'fetchQuote',
        description: 'Look up a quote.',
        returnType: A2uiReturnType.object,
        argumentSchema: _quoteSchema(),
        handler: _noopHandler,
      );
      final CatalogApi catalog = Catalog(
        id: 'https://example.com/finance.json',
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: const <ComponentApi>[],
        agentFunctions: [fn],
      );

      expect(catalog.functions['fetchQuote'], same(fn));
      expect(catalog.agentFunctions['fetchQuote'], same(fn));

      final Map<String, Object?> doc = catalog.toJson();
      final docFunctions = doc['functions']! as Map<String, Object?>;
      expect(docFunctions['fetchQuote'], {
        'type': 'object',
        'description': 'Look up a quote.',
        'returnType': 'object',
        'properties': {
          '@call': {'const': 'fetchQuote'},
          'args': _quoteSchema().value,
        },
        'required': ['@call', 'args'],
      });

      final valFunctions =
          catalog.validationSchema['functions']! as Map<String, Object?>;
      expect(valFunctions, contains('fetchQuote'));
    });

    test('fromApi replaces matching declaration in Catalog.fromJson', () {
      final CatalogApi catalog = Catalog.fromJson({
        'catalogId': 'https://example.com/finance.json',
        'protocolVersion': '1.0.0',
        'components': <String, Object?>{},
        'functions': {
          'fetchQuote': {
            'type': 'object',
            'description': 'Look up a quote.',
            'returnType': 'object',
            'properties': {
              '@call': {'const': 'fetchQuote'},
              'args': _quoteSchema().value,
            },
            'required': ['@call', 'args'],
          },
          'formatCurrency': {
            'type': 'object',
            'returnType': 'string',
            'properties': {
              '@call': {'const': 'formatCurrency'},
              'args': {
                'type': 'object',
                'properties': {
                  'value': {'type': 'number'},
                },
                'required': ['value'],
              },
            },
            'required': ['@call', 'args'],
          },
        },
      });

      final bound = AgentFunction.fromApi(
        catalog.functions['fetchQuote']!,
        _noopHandler,
      );
      final CatalogApi withFn = catalog.copyWith(agentFunctions: [bound]);

      expect(withFn.agentFunctions.keys, ['fetchQuote']);
      expect(withFn.agentFunctions['fetchQuote'], same(bound));
      expect(withFn.functions['fetchQuote'], same(bound));
      expect(
        withFn.functions['formatCurrency'],
        same(catalog.functions['formatCurrency']),
      );
      expect(withFn.toJson(), equals(catalog.toJson()));

      // Stripping agentFunctions restores the original FunctionApi declaration.
      final CatalogApi stripped = withFn.copyWith(agentFunctions: const []);
      expect(stripped.agentFunctions, isEmpty);
      expect(
        stripped.functions['fetchQuote'],
        same(catalog.functions['fetchQuote']),
      );
      expect(stripped.toJson(), equals(catalog.toJson()));
    });

    test('validates payload calling an AgentFunction via PayloadValidator', () {
      final fn = AgentFunction(
        name: 'fetchQuote',
        returnType: A2uiReturnType.object,
        argumentSchema: _quoteSchema(),
        handler: _noopHandler,
      );
      final CatalogApi catalog = Catalog(
        id: 'https://example.com/finance.json',
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: [
          ComponentApi(
            name: 'Text',
            schema: Schema.fromMap({
              'type': 'object',
              'properties': {
                'text': {r'$ref': r'common_types.json#/$defs/DynamicString'},
              },
              'required': ['text'],
            }),
          ),
        ],
        agentFunctions: [fn],
      );

      final validator = PayloadValidator<ComponentApi, FunctionApi>(
        catalog: catalog,
        config: ValidationConfig.strict,
      );
      validator.validateComponent({
        'id': 'root',
        'component': 'Text',
        'text': {
          '@call': 'fetchQuote',
          'args': {'symbol': 'GOOG'},
        },
      });

      expect(
        () => validator.validateComponent({
          'id': 'root',
          'component': 'Text',
          'text': {
            '@call': 'fetchQuote',
            'args': <String, Object?>{},
          },
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('derive preserves kept AgentFunction entries', () {
      final quote = AgentFunction(
        name: 'fetchQuote',
        returnType: A2uiReturnType.object,
        argumentSchema: _quoteSchema(),
        handler: _noopHandler,
      );
      final rate = AgentFunction(
        name: 'fetchRate',
        returnType: A2uiReturnType.number,
        argumentSchema: Schema.fromMap({'type': 'object'}),
        handler: _noopHandler,
      );
      final CatalogApi catalog = Catalog(
        id: 'https://example.com/finance.json',
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: const <ComponentApi>[],
        agentFunctions: [quote, rate],
      );

      final CatalogApi derived = catalog.derive(
        catalogId: 'https://example.com/sub.json',
        functions: const ['fetchQuote'],
      );
      expect(derived.agentFunctions.keys, ['fetchQuote']);
      expect(derived.agentFunctions['fetchQuote'], same(quote));
    });

    test(
        'rejects duplicate names, collisions, @-prefixed names, '
        'non-UAX31 names, and pre-v1.0 catalogs', () {
      final fn1 = AgentFunction(
        name: 'fetchQuote',
        argumentSchema: _quoteSchema(),
        handler: _noopHandler,
      );
      final fn2 = AgentFunction(
        name: 'fetchQuote',
        argumentSchema: _quoteSchema(),
        handler: _noopHandler,
      );

      expect(
        () => Catalog(
          id: 'cat',
          protocolVersion: A2uiProtocolVersion.v1_0,
          components: const <ComponentApi>[],
          agentFunctions: [fn1, fn2],
        ),
        throwsA(isA<A2uiCatalogError>()),
      );

      final api = FunctionApi(
        name: 'fetchQuote',
        argumentSchema: _quoteSchema(),
      );
      expect(
        () => Catalog(
          id: 'cat',
          protocolVersion: A2uiProtocolVersion.v1_0,
          components: const <ComponentApi>[],
          functions: [api],
          agentFunctions: [fn1],
        ),
        throwsA(isA<A2uiCatalogError>()),
      );

      expect(
        () => Catalog(
          id: 'cat',
          protocolVersion: A2uiProtocolVersion.v1_0,
          components: const <ComponentApi>[],
          agentFunctions: [
            AgentFunction(
              name: '@reserved',
              argumentSchema: _quoteSchema(),
              handler: _noopHandler,
            ),
          ],
        ),
        throwsA(isA<A2uiCatalogError>()),
      );

      expect(
        () => Catalog(
          id: 'cat',
          protocolVersion: A2uiProtocolVersion.v1_0,
          components: const <ComponentApi>[],
          agentFunctions: [
            AgentFunction(
              name: 'bad-name',
              argumentSchema: _quoteSchema(),
              handler: _noopHandler,
            ),
          ],
        ),
        throwsA(isA<A2uiCatalogError>()),
      );

      expect(
        () => Catalog(
          id: 'cat',
          protocolVersion: A2uiProtocolVersion.v0_9,
          components: const <ComponentApi>[],
          agentFunctions: [fn1],
        ),
        throwsA(isA<A2uiCatalogError>()),
      );
    });
  });

  group('A2uiRpcError custom codes and RpcErrorCode.tooManyPending', () {
    test('supports custom wire codes and preserves them in withContext', () {
      expect(RpcErrorCode.tooManyPending.wireValue, 'TOO_MANY_PENDING');
      expect(
        RpcErrorCode.tryParse('TOO_MANY_PENDING'),
        RpcErrorCode.tooManyPending,
      );

      final custom = A2uiRpcError.custom(
        'Symbol Delisted',
        'SYMBOL_DELISTED',
      );
      expect(custom.code, 'SYMBOL_DELISTED');
      expect(custom.rpcCode, RpcErrorCode.unknownError);

      final A2uiRpcError contextualized = custom.withContext(
        surfaceId: 'main',
        functionCallId: 'call-1',
      );
      expect(contextualized.code, 'SYMBOL_DELISTED');
      expect(contextualized.surfaceId, 'main');
      expect(contextualized.functionCallId, 'call-1');
    });
  });
}
