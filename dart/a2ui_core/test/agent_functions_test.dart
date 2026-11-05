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

/// A v1.0 catalog document with a schema-only function, `verifyProvider`,
/// which renderers leave to the agent, and `formatCurrency`.
CatalogApi _financeCatalog() => Catalog.fromJson({
      'catalogId': 'https://example.com/finance.json',
      'protocolVersion': '1.0.0',
      'components': <String, Object?>{},
      'functions': {
        'verifyProvider': {
          'type': 'object',
          'description': 'Checks that a provider is licensed.',
          'returnType': 'boolean',
          'properties': {
            '@call': {'const': 'verifyProvider'},
            'args': {
              'type': 'object',
              'properties': {
                'providerId': {'type': 'string'},
              },
              'required': ['providerId'],
            },
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

    test('a directly built AgentFunction is rendererOnly', () {
      final fn = AgentFunction(
        name: 'fetchQuote',
        argumentSchema: _quoteSchema(),
        handler: _noopHandler,
      );
      expect(fn.allowedCallers, AllowedCallers.rendererOnly);
      expect(fn.declaredAllowedCallers, isNull);
    });

    test('fromApi keeps rendererOrAgent', () {
      final fn = AgentFunction.fromApi(
        FunctionApi(
          name: 'fetchQuote',
          argumentSchema: _quoteSchema(),
          allowedCallers: AllowedCallers.rendererOrAgent,
        ),
        _noopHandler,
      );
      expect(fn.allowedCallers, AllowedCallers.rendererOrAgent);
      expect(fn.declaredAllowedCallers, AllowedCallers.rendererOrAgent);
    });

    test('fromApi rejects an agentOnly declaration', () {
      expect(
        () => AgentFunction.fromApi(
          FunctionApi(
            name: 'fetchQuote',
            argumentSchema: _quoteSchema(),
            allowedCallers: AllowedCallers.agentOnly,
          ),
          _noopHandler,
        ),
        throwsA(
          isA<A2uiCatalogError>().having(
            (e) => e.message,
            'message',
            contains('agentOnly'),
          ),
        ),
      );
    });

    test('a handler may ignore the context', () async {
      final fn = AgentFunction(
        name: 'echo',
        argumentSchema: Schema.fromMap({'type': 'object'}),
        handler: (args, _) => args['x'],
      );
      expect(
        await fn.handler(
          {'x': 1},
          const AgentFunctionContext(
            catalogId: 'cat',
            surfaceId: 'main',
            functionCallId: 'c1',
          ),
        ),
        1,
      );
    });

    test(
        'fromApi rejects requiresUserActivation unless the function is '
        'rendererOnly', () {
      expect(
        () => AgentFunction.fromApi(
          FunctionApi(
            name: 'approve',
            argumentSchema: _quoteSchema(),
            allowedCallers: AllowedCallers.rendererOrAgent,
            requiresUserActivation: true,
          ),
          _noopHandler,
        ),
        throwsA(
          isA<A2uiCatalogError>()
              .having((e) => e.message, 'message', contains('approve'))
              .having((e) => e.message, 'message', contains('rendererOnly')),
        ),
      );
      for (final AllowedCallers? callers in [
        null,
        AllowedCallers.rendererOnly,
      ]) {
        final fn = AgentFunction.fromApi(
          FunctionApi(
            name: 'approve',
            argumentSchema: _quoteSchema(),
            allowedCallers: callers,
            requiresUserActivation: true,
          ),
          _noopHandler,
        );
        expect(fn.requiresUserActivation, isTrue);
      }
      // A standalone agent function is rendererOnly, so it may require it.
      expect(
        AgentFunction(
          name: 'approve',
          argumentSchema: _quoteSchema(),
          requiresUserActivation: true,
          handler: _noopHandler,
        ).requiresUserActivation,
        isTrue,
      );
    });

    test('withHandler rebinds a standalone function', () async {
      final fn = AgentFunction(
        name: 'fetchQuote',
        description: 'Look up a quote.',
        returnType: A2uiReturnType.object,
        argumentSchema: _quoteSchema(),
        requiresUserActivation: true,
        handler: _noopHandler,
      );
      Object? other(Map<String, dynamic> args, AgentFunctionContext _) =>
          'other';
      final AgentFunction rebound = fn.withHandler(other);
      expect(rebound, isNot(same(fn)));
      expect(rebound.handler, same(other));
      expect(fn.handler, same(_noopHandler));
      expect(rebound.name, fn.name);
      expect(rebound.description, fn.description);
      expect(rebound.returnType, fn.returnType);
      expect(rebound.argumentSchema, same(fn.argumentSchema));
      expect(rebound.declaredRequiresUserActivation, isTrue);
      expect(rebound.allowedCallers, AllowedCallers.rendererOnly);
      expect(rebound.declaration, isNull);
    });

    test('withHandler rebinds a fromApi function to the same declaration', () {
      final CatalogApi catalog = _financeCatalog();
      final FunctionApi declaration = catalog.functions['verifyProvider']!;
      final CatalogApi bound = catalog.copyWith(
        agentFunctions: [AgentFunction.fromApi(declaration, _noopHandler)],
      );
      Object? other(Map<String, dynamic> args, AgentFunctionContext _) => false;
      final AgentFunction rebound =
          bound.agentFunctions['verifyProvider']!.withHandler(other);
      expect(rebound.declaration, same(declaration));
      expect(rebound.handler, same(other));
      expect(rebound.allowedCallers, declaration.allowedCallers);

      final CatalogApi rebinding = bound.copyWith(agentFunctions: [rebound]);
      expect(rebinding.agentFunctions['verifyProvider'], same(rebound));
      expect(rebinding.toJson(), equals(catalog.toJson()));
    });

    test('AgentFunctionContext takes named parameters', () {
      const context = AgentFunctionContext(
        functionCallId: 'c1',
        surfaceId: 'main',
        catalogId: 'cat',
      );
      expect(context.catalogId, 'cat');
      expect(context.surfaceId, 'main');
      expect(context.functionCallId, 'c1');
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
        'an AgentFunction listed in functions appears in functions, '
        'agentFunctions, toJson, and validationSchema', () {
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
        functions: [fn],
      );

      expect(catalog.functions['fetchQuote'], same(fn));
      expect(catalog.agentFunctions['fetchQuote'], same(fn));
      expect(catalog.rendererFunctions, isEmpty);

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

    test('copyWith appends a standalone AgentFunction', () {
      final CatalogApi catalog = _financeCatalog();
      final fn = AgentFunction(
        name: 'fetchRate',
        returnType: A2uiReturnType.number,
        argumentSchema: Schema.fromMap({'type': 'object'}),
        handler: _noopHandler,
      );
      final CatalogApi withFn = catalog.copyWith(agentFunctions: [fn]);
      expect(withFn.functions.keys,
          ['verifyProvider', 'formatCurrency', 'fetchRate']);
      expect(withFn.agentFunctions.keys, ['fetchRate']);
      expect(
        (withFn.toJson()['functions']! as Map<String, Object?>).keys,
        contains('fetchRate'),
      );

      final CatalogApi stripped = withFn.copyWith(agentFunctions: const []);
      expect(stripped.functions.keys, ['verifyProvider', 'formatCurrency']);
      expect(stripped.toJson(), equals(catalog.toJson()));
    });

    test('fromApi replaces matching declaration in Catalog.fromJson', () {
      final CatalogApi catalog = _financeCatalog();

      final bound = AgentFunction.fromApi(
        catalog.functions['verifyProvider']!,
        _noopHandler,
      );
      final CatalogApi withFn = catalog.copyWith(agentFunctions: [bound]);

      expect(withFn.agentFunctions.keys, ['verifyProvider']);
      expect(withFn.agentFunctions['verifyProvider'], same(bound));
      expect(withFn.functions['verifyProvider'], same(bound));
      expect(withFn.functions.keys, ['verifyProvider', 'formatCurrency']);
      expect(
        withFn.functions['formatCurrency'],
        same(catalog.functions['formatCurrency']),
      );
      expect(withFn.toJson(), equals(catalog.toJson()));

      // Stripping agentFunctions restores the original FunctionApi declaration.
      final CatalogApi stripped = withFn.copyWith(agentFunctions: const []);
      expect(stripped.agentFunctions, isEmpty);
      expect(
        stripped.functions['verifyProvider'],
        same(catalog.functions['verifyProvider']),
      );
      expect(stripped.toJson(), equals(catalog.toJson()));
    });

    test('copyWith(agentFunctions:) replaces the previous agent functions', () {
      final CatalogApi catalog = _financeCatalog();
      final first = AgentFunction.fromApi(
        catalog.functions['verifyProvider']!,
        _noopHandler,
      );
      final CatalogApi once = catalog.copyWith(agentFunctions: [first]);

      // Rebinding the same declaration with a new handler works, because the
      // old agent function goes back to its declaration first.
      final second = AgentFunction.fromApi(
        catalog.functions['verifyProvider']!,
        _noopHandler,
      );
      final CatalogApi twice = once.copyWith(agentFunctions: [second]);
      expect(twice.agentFunctions['verifyProvider'], same(second));
      expect(twice.toJson(), equals(catalog.toJson()));
    });

    test(
        'fromApi of a declaration the catalog does not have is a catalog '
        'error', () {
      final CatalogApi catalog = _financeCatalog();
      final foreign = FunctionApi(
        name: 'consultOracle',
        argumentSchema: Schema.fromMap({'type': 'object'}),
      );
      expect(
        () => catalog.copyWith(
          agentFunctions: [AgentFunction.fromApi(foreign, _noopHandler)],
        ),
        throwsA(
          isA<A2uiCatalogError>()
              .having((e) => e.message, 'message', contains('fromApi'))
              .having((e) => e.catalogId, 'catalogId', catalog.id),
        ),
      );
    });

    test(
        'fromApi of the same declaration from another copy of the catalog '
        'has its own message', () {
      final CatalogApi catalog = _financeCatalog();
      final CatalogApi reloaded = _financeCatalog();
      expect(
        () => catalog.copyWith(
          agentFunctions: [
            AgentFunction.fromApi(
              reloaded.functions['verifyProvider']!,
              _noopHandler,
            ),
          ],
        ),
        throwsA(
          isA<A2uiCatalogError>()
              .having(
                (e) => e.message,
                'message',
                contains('different declaration'),
              )
              .having(
                (e) => e.message,
                'message',
                isNot(contains('already declares')),
              )
              .having((e) => e.catalogId, 'catalogId', catalog.id),
        ),
      );
    });

    test('copyWith keeps the agent functions among the functions it is given',
        () {
      final CatalogApi catalog = _financeCatalog();
      final kept = AgentFunction(
        name: 'fetchRate',
        argumentSchema: Schema.fromMap({'type': 'object'}),
        handler: _noopHandler,
      );
      final added = AgentFunction(
        name: 'fetchQuote',
        argumentSchema: _quoteSchema(),
        handler: _noopHandler,
      );
      final CatalogApi copy = catalog.copyWith(
        functions: [...catalog.functions.values, kept],
        agentFunctions: [added],
      );
      expect(copy.agentFunctions.keys, ['fetchRate', 'fetchQuote']);
      expect(copy.agentFunctions['fetchRate'], same(kept));

      // With functions omitted, existing agent functions are replaced.
      final CatalogApi replaced = copy.copyWith(agentFunctions: const []);
      expect(replaced.agentFunctions, isEmpty);
    });

    test('agent function argument names must be UAX #31 identifiers', () {
      for (final Map<String, Object?> schema in [
        {
          'type': 'object',
          'properties': {
            'target-currency': {'type': 'string'},
          },
        },
        {
          'allOf': [
            {
              'type': 'object',
              'properties': {
                'bad name': {'type': 'string'},
              },
            },
          ],
        },
        {
          'type': 'object',
          'properties': {
            '@target': {'type': 'string'},
          },
        },
        {
          'anyOf': [
            {
              'type': 'object',
              'properties': {
                'target-currency': {'type': 'string'},
              },
            },
          ],
        },
        {
          'oneOf': [
            {'type': 'object', 'properties': <String, Object?>{}},
            {
              'type': 'object',
              'properties': {
                'target-currency': {'type': 'string'},
              },
            },
          ],
        },
        {
          'target-currency': {'type': 'string'},
        },
        {
          r'$ref': r'#/$defs/Pair',
          r'$defs': {
            'Pair': {
              'type': 'object',
              'properties': {
                'target-currency': {'type': 'string'},
              },
            },
          },
        },
        {
          'type': 'object',
          'properties': {
            '@call': {'const': 'fetchRate'},
            'args': {
              'type': 'object',
              'properties': {
                'target-currency': {'type': 'string'},
              },
            },
          },
        },
      ]) {
        final fn = AgentFunction(
          name: 'fetchRate',
          argumentSchema: Schema.fromMap(schema),
          handler: _noopHandler,
        );
        expect(
          () => _financeCatalog().copyWith(agentFunctions: [fn]),
          throwsA(
            isA<A2uiCatalogError>()
                .having((e) => e.message, 'message', contains('argument'))
                .having(
                  (e) => e.catalogId,
                  'catalogId',
                  'https://example.com/finance.json',
                ),
          ),
          reason: '$schema',
        );
        expect(
          () => Catalog(
            id: 'cat',
            protocolVersion: A2uiProtocolVersion.v1_0,
            components: const <ComponentApi>[],
            functions: [fn],
          ),
          throwsA(isA<A2uiCatalogError>()),
        );
      }
    });

    test('the same name twice in agentFunctions has its own message', () {
      final CatalogApi catalog = _financeCatalog();
      final fn1 = AgentFunction(
        name: 'fetchRate',
        argumentSchema: Schema.fromMap({'type': 'object'}),
        handler: _noopHandler,
      );
      final fn2 = AgentFunction(
        name: 'fetchRate',
        argumentSchema: Schema.fromMap({'type': 'object'}),
        handler: _noopHandler,
      );
      expect(
        () => catalog.copyWith(agentFunctions: [fn1, fn2]),
        throwsA(
          isA<A2uiCatalogError>()
              .having(
                (e) => e.message,
                'message',
                contains('more than one agent function'),
              )
              .having(
                (e) => e.message,
                'message',
                isNot(contains('fromApi')),
              ),
        ),
      );

      // Two fromApi wrappers of the same declaration are duplicates too.
      final FunctionApi declaration = catalog.functions['verifyProvider']!;
      expect(
        () => catalog.copyWith(
          agentFunctions: [
            AgentFunction.fromApi(declaration, _noopHandler),
            AgentFunction.fromApi(declaration, _noopHandler),
          ],
        ),
        throwsA(
          isA<A2uiCatalogError>().having(
            (e) => e.message,
            'message',
            contains('more than one agent function'),
          ),
        ),
      );
    });

    test('a name taken by a catalog function has its own message', () {
      final CatalogApi catalog = _financeCatalog();
      final fn = AgentFunction(
        name: 'formatCurrency',
        argumentSchema: Schema.fromMap({'type': 'object'}),
        handler: _noopHandler,
      );
      expect(
        () => catalog.copyWith(agentFunctions: [fn]),
        throwsA(
          isA<A2uiCatalogError>()
              .having(
                (e) => e.message,
                'message',
                contains("already declares a function named 'formatCurrency'"),
              )
              .having(
                (e) => e.message,
                'message',
                contains('AgentFunction.fromApi'),
              ),
        ),
      );
    });

    test('copyWith rejects an AgentFunction on a renderer catalog type', () {
      final catalog = Catalog<ComponentApi, FunctionImplementation>(
        id: 'cat',
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: const <ComponentApi>[],
      );
      expect(
        () => catalog.copyWith(
          agentFunctions: [
            AgentFunction(
              name: 'fetchRate',
              argumentSchema: Schema.fromMap({'type': 'object'}),
              handler: _noopHandler,
            ),
          ],
        ),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('rendererFunctions lists the functions that are not agent functions',
        () {
      final CatalogApi catalog = _financeCatalog();
      expect(catalog.rendererFunctions.keys, [
        'verifyProvider',
        'formatCurrency',
      ]);

      final CatalogApi withFn = catalog.copyWith(
        agentFunctions: [
          AgentFunction.fromApi(
            catalog.functions['verifyProvider']!,
            _noopHandler,
          ),
        ],
      );
      expect(withFn.rendererFunctions.keys, ['formatCurrency']);
      expect(
        withFn.rendererFunctions['formatCurrency'],
        same(catalog.functions['formatCurrency']),
      );
      expect(
        () =>
            withFn.rendererFunctions['x'] = withFn.functions['formatCurrency']!,
        throwsUnsupportedError,
      );
    });

    test(
        'agent function argument names reached through the catalog '
        'definitions are checked', () {
      Catalog<ComponentApi, FunctionApi> build(Map<String, Object?> pair) =>
          Catalog(
            id: 'cat',
            protocolVersion: A2uiProtocolVersion.v1_0,
            components: const <ComponentApi>[],
            definitions: {'Pair': pair},
            functions: [
              AgentFunction(
                name: 'fetchRate',
                argumentSchema: Schema.fromMap({
                  r'$ref': r'#/$defs/Pair',
                }),
                handler: _noopHandler,
              ),
            ],
          );
      expect(
        () => build({
          'type': 'object',
          'properties': {
            'target-currency': {'type': 'string'},
          },
        }),
        throwsA(
          isA<A2uiCatalogError>().having(
            (e) => e.message,
            'message',
            contains('target-currency'),
          ),
        ),
      );
      // A reference cycle ends, and valid names pass.
      expect(
        build({
          'type': 'object',
          'properties': {
            'base': {'type': 'string'},
          },
          'anyOf': [
            {r'$ref': r'#/$defs/Pair'},
          ],
        }).agentFunctions.keys,
        ['fetchRate'],
      );
    });

    test('valid agent function argument names pass in every form', () {
      for (final Map<String, Object?> schema in [
        {
          'type': 'object',
          'properties': {
            'base': {'type': 'string'},
          },
        },
        {
          'base': {'type': 'string'},
          'target': true,
        },
        {
          'oneOf': [
            {
              'type': 'object',
              'properties': {
                'base': {'type': 'string'},
              },
            },
          ],
        },
        {
          r'$ref': r'#/$defs/Pair',
          r'$defs': {
            'Pair': {
              'type': 'object',
              'properties': {
                'base': {'type': 'string'},
              },
            },
          },
        },
        {r'$ref': r'common_types.json#/$defs/DynamicString'},
      ]) {
        final fn = AgentFunction(
          name: 'fetchRate',
          argumentSchema: Schema.fromMap(schema),
          handler: _noopHandler,
        );
        expect(
          _financeCatalog().copyWith(agentFunctions: [fn]).agentFunctions.keys,
          ['fetchRate'],
          reason: '$schema',
        );
      }
    });

    test('rendererFunctions keeps the catalog function type', () {
      final catalog = Catalog<ComponentApi, FunctionImplementation>(
        id: 'cat',
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: const <ComponentApi>[],
      );
      final Map<String, FunctionImplementation> functions =
          catalog.rendererFunctions;
      expect(functions, isEmpty);
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
        functions: [fn],
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
        functions: [quote, rate],
      );

      final CatalogApi derived = catalog.derive(
        catalogId: 'https://example.com/sub.json',
        functions: const ['fetchQuote'],
      );
      expect(derived.agentFunctions.keys, ['fetchQuote']);
      expect(derived.agentFunctions['fetchQuote'], same(quote));
    });

    test(
        'merges local agent function \$defs with catalog definitions across '
        'UAX #31 checks, validation, and serialization', () {
      expect(
        () => Catalog(
          id: 'cat',
          protocolVersion: A2uiProtocolVersion.v1_0,
          components: const <ComponentApi>[],
          definitions: {
            'Catalog/Args': {
              'type': 'object',
              'properties': {
                'bad-amount': {'type': 'number'},
              },
            },
          },
          functions: [
            AgentFunction(
              name: 'pay',
              argumentSchema: Schema.fromMap({
                r'$defs': {
                  'MemoArgs': {
                    'type': 'object',
                    'properties': {
                      'memo': {'type': 'string'},
                    },
                  },
                },
                'allOf': [
                  {r'$ref': r'#/$defs/MemoArgs'},
                  {r'$ref': r'#/$defs/Catalog~1Args'},
                ],
              }),
              handler: _noopHandler,
            ),
          ],
        ),
        throwsA(
          isA<A2uiCatalogError>().having(
            (e) => e.message,
            'message',
            contains('bad-amount'),
          ),
        ),
      );

      final pay = AgentFunction(
        name: 'pay',
        returnType: A2uiReturnType.object,
        argumentSchema: Schema.fromMap({
          r'$defs': {
            'MemoArgs': {
              'type': 'object',
              'properties': {
                'memo': {'type': 'string'},
              },
            },
            'Shadowed': {
              'type': 'object',
              'properties': {
                'note': {'type': 'string'},
              },
            },
          },
          'allOf': [
            {r'$ref': r'#/$defs/MemoArgs'},
            {r'$ref': r'#/$defs/Shadowed'},
            {r'$ref': r'#/$defs/MoneyArgs'},
          ],
          'unevaluatedProperties': false,
        }),
        handler: _noopHandler,
      );
      final CatalogApi catalog = Catalog(
        id: 'https://example.com/pay.json',
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
        definitions: {
          'MoneyArgs': {
            'type': 'object',
            'properties': {
              'amount': {'type': 'number', 'exclusiveMinimum': 0},
            },
            'required': ['amount'],
          },
          'Shadowed': {
            'type': 'object',
            'properties': {
              'bad-shadowed': {'type': 'string'},
            },
          },
          'DroppedArgs': {
            'type': 'object',
            'properties': {
              'unused': {'type': 'string'},
            },
          },
        },
        functions: [
          pay,
          AgentFunction(
            name: 'other',
            argumentSchema: Schema.fromMap({r'$ref': r'#/$defs/DroppedArgs'}),
            handler: _noopHandler,
          ),
        ],
      );

      final validator = PayloadValidator<ComponentApi, FunctionApi>(
        catalog: catalog,
        config: ValidationConfig.strict,
      );
      validator.validateFunction('pay', {
        'amount': 25,
        'memo': 'ok',
        'note': 'local',
      });
      expect(
        () => validator.validateFunction('pay', {'memo': 'missing amount'}),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => validator.validateFunction('pay', {'amount': -5}),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => validator.validateComponent({
          'id': 'root',
          'component': 'Text',
          'text': {'@call': 'pay'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );

      final Map<String, Object?> serialized = catalog.toJson();
      final fnOut =
          (serialized['functions']! as Map)['pay']! as Map<String, Object?>;
      expect(fnOut['required'], ['@call', 'args']);
      final argsOut =
          (fnOut['properties']! as Map)['args']! as Map<String, Object?>;
      expect(argsOut.containsKey(r'$defs'), isFalse);

      final CatalogApi derived = catalog.derive(
        catalogId: 'https://example.com/pay-derived.json',
        functions: const ['pay'],
      );
      expect(derived.definitions.containsKey('MoneyArgs'), isTrue);
      expect(derived.definitions.containsKey('DroppedArgs'), isFalse);
    });

    test(
        'rejects duplicate names, @-prefixed names, non-UAX31 names, and '
        'pre-v1.0 catalogs', () {
      final fn1 = AgentFunction(
        name: 'fetchQuote',
        argumentSchema: _quoteSchema(),
        handler: _noopHandler,
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
          functions: [api, fn1],
        ),
        throwsA(isA<A2uiCatalogError>()),
      );

      expect(
        () => Catalog(
          id: 'cat',
          protocolVersion: A2uiProtocolVersion.v1_0,
          components: const <ComponentApi>[],
          functions: [
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
          functions: [
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
          functions: [fn1],
        ),
        throwsA(isA<A2uiCatalogError>()),
      );
    });
  });

  group('A2uiRpcError custom codes', () {
    test('supports custom wire codes and preserves them in withContext', () {
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

    test('a custom code the protocol defines sets rpcCode', () {
      final known = A2uiRpcError.custom('Bad call', 'INVALID_FUNCTION_CALL');
      expect(known.code, 'INVALID_FUNCTION_CALL');
      expect(known.rpcCode, RpcErrorCode.invalidFunctionCall);
    });
  });
}
