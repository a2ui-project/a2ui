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

class _SchemaFn extends FunctionImplementation {
  _SchemaFn(String name, Schema argumentSchema)
      : super(name: name, argumentSchema: argumentSchema);

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) =>
      args;
}

class _AgentOnlyFn extends FunctionImplementation {
  _AgentOnlyFn()
      : super(
          name: 'agentOnlyFn',
          argumentSchema: Schema.object(),
          allowedCallers: AllowedCallers.agentOnly,
        );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) =>
      'ok';
}

Map<String, Object?> _document(Map<String, Object?> function) => {
      'catalogId': 'cat',
      'protocolVersion': 'v1.0',
      'components': <String, Object?>{},
      'functions': {'fn': function},
    };

void main() {
  group('AllowedCallers', () {
    test('parses and serializes every value', () {
      for (final AllowedCallers value in AllowedCallers.values) {
        expect(AllowedCallers.fromJson(value.jsonValue), value);
      }
      expect(AllowedCallers.rendererOrAgent.jsonValue, 'rendererOrAgent');
      expect(
        () => AllowedCallers.fromJson('everyone'),
        throwsA(isA<A2uiCatalogError>()),
      );
    });
  });

  group('FunctionApi caller metadata', () {
    test('defaults to rendererOnly and no user activation', () {
      final CatalogApi catalog = Catalog.fromJson(_document({
        'type': 'object',
        'returnType': 'string',
        'properties': {
          '@call': {'const': 'fn'},
        },
      }));
      final FunctionApi fn = catalog.functions['fn']!;
      expect(fn.allowedCallers, AllowedCallers.rendererOnly);
      expect(fn.requiresUserActivation, isFalse);
      final functions = catalog.validationSchema['functions']! as Map;
      final serialized = functions['fn']! as Map;
      expect(serialized.containsKey('allowedCallers'), isFalse);
      expect(serialized.containsKey('requiresUserActivation'), isFalse);
    });

    test('parses both fields from a document and round-trips them', () {
      final CatalogApi catalog = Catalog.fromJson(_document({
        'type': 'object',
        'returnType': 'void',
        'allowedCallers': 'rendererOrAgent',
        'requiresUserActivation': true,
        'properties': {
          '@call': {'const': 'fn'},
        },
      }));
      final FunctionApi fn = catalog.functions['fn']!;
      expect(fn.allowedCallers, AllowedCallers.rendererOrAgent);
      expect(fn.requiresUserActivation, isTrue);

      final CatalogApi again = Catalog.fromJson(catalog.validationSchema);
      expect(again.functions['fn']!.allowedCallers,
          AllowedCallers.rendererOrAgent);
      expect(again.functions['fn']!.requiresUserActivation, isTrue);
    });

    test('parses both fields from the inline list form', () {
      final CatalogApi catalog = Catalog.fromJson({
        'catalogId': 'cat',
        'protocolVersion': 'v1.0',
        'components': <String, Object?>{},
        'functions': [
          {
            'name': 'fn',
            'returnType': 'any',
            'allowedCallers': 'agentOnly',
            'requiresUserActivation': true,
          },
        ],
      });
      expect(catalog.functions['fn']!.allowedCallers, AllowedCallers.agentOnly);
      expect(catalog.functions['fn']!.requiresUserActivation, isTrue);
    });

    test('rejects wrong types', () {
      expect(
        () => Catalog.fromJson(_document({
          'type': 'object',
          'returnType': 'any',
          'allowedCallers': 3,
        })),
        throwsA(isA<A2uiCatalogError>()),
      );
      expect(
        () => Catalog.fromJson(_document({
          'type': 'object',
          'returnType': 'any',
          'requiresUserActivation': 'yes',
        })),
        throwsA(isA<A2uiCatalogError>()),
      );
      expect(
        () => Catalog.fromJson(_document({
          'type': 'object',
          'returnType': 'any',
          'allowedCallers': 'nobody',
        })),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('copyWith keeps the fields', () {
      final CatalogApi catalog = Catalog.fromJson(_document({
        'type': 'object',
        'returnType': 'void',
        'allowedCallers': 'agentOnly',
        'requiresUserActivation': true,
      }));
      final CatalogApi copy = catalog.copyWith();
      expect(copy.functions['fn']!.allowedCallers, AllowedCallers.agentOnly);
      expect(copy.functions['fn']!.requiresUserActivation, isTrue);
    });
  });

  group('BasicCatalog', () {
    test('openUrl requires user activation in v1.0', () {
      expect(
        BasicCatalog.v1_0().functions['openUrl']!.requiresUserActivation,
        isTrue,
      );
      expect(
        BasicCatalog.v1_0().functions['formatDate']!.requiresUserActivation,
        isFalse,
      );
    });

    test('Catalog.invoke rejects agentOnly functions', () {
      final catalog = Catalog<ComponentApi, FunctionImplementation>(
        id: 'cat',
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: const [],
        functions: [_AgentOnlyFn()],
      );
      final context = DataContext(
        DataModel(),
        catalog.invoke,
        '/',
        protocolVersion: 'v1.0',
      );
      expect(
        () => catalog.invoke('agentOnlyFn', <String, dynamic>{}, context),
        throwsA(isA<A2uiExpressionError>()),
      );
    });

    test('Catalog.invoke resolves argument schema against commonTypesSchema',
        () {
      final fn = _SchemaFn(
        'takeBinding',
        Schema.object(
          properties: {
            'binding': Schema.fromMap(
              {r'$ref': r'common_types.json#/$defs/DataBinding'},
            ),
          },
          required: ['binding'],
        ),
      );
      final catalog = Catalog<ComponentApi, FunctionImplementation>(
        id: 'cat',
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: const [],
        functions: [fn],
      );
      final context = DataContext(
        DataModel(),
        catalog.invoke,
        '/',
        protocolVersion: 'v1.0',
      );
      expect(
        () => catalog.invoke(
            'takeBinding',
            {
              'binding': {'@path': '/user/name'},
            },
            context),
        returnsNormally,
      );
      expect(
        () => catalog.invoke(
            'takeBinding',
            {
              'binding': {'path': '/user/name'},
            },
            context),
        throwsA(isA<A2uiExpressionError>()),
      );
    });
  });
}
