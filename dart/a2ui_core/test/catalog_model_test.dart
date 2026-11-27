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

// Deliberately does NOT import `package:json_schema_builder` to verify pure
// canonical Dart catalog authoring and end-to-end runtime execution.
import 'dart:convert';
import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

String _findRepoRoot() {
  Directory dir = Directory.current;
  while (!File('${dir.path}/pubspec.yaml').existsSync() ||
      !Directory('${dir.path}/catalogs').existsSync()) {
    final Directory parent = dir.parent;
    if (parent.path == dir.path) break;
    dir = parent;
  }
  return dir.path;
}

class _IsPositiveFunction extends FunctionImplementation {
  _IsPositiveFunction()
    : super.define(
        name: 'isPositive',
        description: 'Checks whether a number is strictly positive.',
        returnTypeDefinition: const FunctionReturnDefinition.validationResult(),
        parameters: [
          ParameterDefinition.number(
            'value',
            dynamic: true,
            required: true,
            description: 'The numeric value to validate.',
          ),
        ],
      );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    final Object? value = args['value'];
    final bool ok = value is num && value > 0;
    return ValidationResult(
      valid: ok,
      message: ok ? null : 'Value must be greater than zero.',
    );
  }
}

class _InvertFunction extends FunctionImplementation {
  _InvertFunction()
    : super.define(
        name: 'invert',
        description: 'Negates a dynamic boolean (coercing ValidationResult).',
        returnType: A2uiReturnType.boolean,
        parameters: [
          ParameterDefinition.boolean('value', dynamic: true, required: true),
        ],
      );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) => !(args['value'] as bool);
}

class _BoundedFunction extends FunctionImplementation {
  _BoundedFunction()
    : super.define(
        name: 'inBounds',
        returnType: A2uiReturnType.boolean,
        parameters: [
          ParameterDefinition.integer('min', min: 0),
          ParameterDefinition.integer('max', min: 0),
        ],
        atLeastOneOf: const [
          ['min', 'max'],
        ],
      );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) => true;
}

class _OpenLinkFunction extends FunctionImplementation {
  final List<String> opened = [];

  _OpenLinkFunction()
    : super.define(
        name: 'openLink',
        returnType: A2uiReturnType.void_,
        requiresUserActivation: true,
        parameters: [
          ParameterDefinition.string(
            'url',
            dynamic: true,
            format: 'uri',
            required: true,
          ),
        ],
      );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    opened.add(args['url'] as String);
    return null;
  }
}

Catalog<ComponentApi, FunctionImplementation> _buildPureDartCatalog({
  _OpenLinkFunction? openLink,
}) => Catalog<ComponentApi, FunctionImplementation>(
  id: 'urn:a2ui:pure-dart-test:v1',
  protocolVersion: A2uiProtocolVersion.v1_0,
  title: 'Pure Dart Test Catalog',
  description: 'Authored without importing json_schema_builder.',
  instructions: 'Use Panel to group items.',
  metadata: const {
    'extensions': {'a2ui_test': true},
  },
  types: const {'Weight': NumberType(min: 0, description: 'Flex weight')},
  surfaceProperties: SurfacePropertiesDefinition(
    description: 'Surface branding',
    properties: [
      ParameterDefinition.string('primaryColor', pattern: r'^#[0-9a-fA-F]{6}$'),
    ],
    additionalProperties: true,
  ),
  components: [
    ComponentApi.define(
      name: 'Panel',
      description: 'Container panel.',
      allowedParents: const ['Surface', 'Panel'],
      parameters: [
        ParameterDefinition.string('title', dynamic: true, required: true),
        ParameterDefinition.childList('children', required: true),
        ParameterDefinition.ref('weight', ref: 'Weight'),
      ],
    ),
    ComponentApi.define(
      name: 'Badge',
      parameters: [
        ParameterDefinition.string('label', dynamic: true, required: true),
        ParameterDefinition.enumeration(
          'tone',
          values: const ['neutral', 'success', 'danger'],
          defaultValue: 'neutral',
        ),
        ParameterDefinition.action('onTap'),
      ],
    ),
    ComponentApi.define(
      name: 'AmountInput',
      checkable: true,
      parameters: [
        ParameterDefinition.number(
          'value',
          dynamic: true,
          required: true,
          min: -1000,
          max: 1000,
        ),
      ],
    ),
    ComponentApi.define(
      name: 'TabStrip',
      parameters: [
        ParameterDefinition.array(
          'tabs',
          required: true,
          minItems: 1,
          items: ObjectType(
            properties: [
              ParameterDefinition.string(
                'title',
                dynamic: true,
                required: true,
              ),
              ParameterDefinition.child('content', required: true),
            ],
          ),
        ),
      ],
    ),
  ],
  functions: [
    _IsPositiveFunction(),
    _InvertFunction(),
    _BoundedFunction(),
    openLink ?? _OpenLinkFunction(),
  ],
);

void main() {
  group('Pure-Dart canonical catalog authoring & runtime', () {
    test('runs end-to-end through MessageProcessor, PayloadValidator, '
        'ComponentRefMap, NodeResolver, and GenericBinder', () async {
      final openLink = _OpenLinkFunction();
      final Catalog<ComponentApi, FunctionImplementation> catalog =
          _buildPureDartCatalog(openLink: openLink);

      // Direct canonical ComponentRefMap classification.
      expect(catalog.refMap.fieldsFor('Panel')['children'], isA<ListRef>());
      final RefKind? tabsRef = catalog.refMap.fieldsFor('TabStrip')['tabs'];
      expect(tabsRef, isA<NestedRef>());
      expect((tabsRef! as NestedRef).fields['content'], isA<SingleRef>());

      final dispatchedActions = <A2uiRendererAction>[];
      final MessageProcessor<ComponentApi> processor = MessageProcessor(
        catalogs: [catalog],
        onAction: dispatchedActions.add,
      );

      processor.processMessages([
        {
          'version': '1.0',
          'createSurface': {'surfaceId': 's1', 'catalogId': catalog.id},
        },
        {
          'version': '1.0',
          'updateDataModel': {
            'surfaceId': 's1',
            'path': '/',
            'value': {
              'heading': 'Initial Heading',
              'amount': -5,
              'items': ['First', 'Second'],
            },
          },
        },
        {
          'version': '1.0',
          'updateComponents': {
            'surfaceId': 's1',
            'components': [
              {
                'id': 'root',
                'component': 'Panel',
                'title': {'@path': '/heading'},
                'children': ['badge1', 'amount1'],
                '@metadata': {
                  'extensions': {'αβ_custom': 'ok'},
                },
              },
              {
                'id': 'badge1',
                'component': 'Badge',
                'label': 'Click me',
                'tone': 'success',
                'onTap': {
                  'functionCall': {
                    '@call': 'openLink',
                    'args': {'url': 'https://example.com/docs'},
                  },
                },
              },
              {
                'id': 'amount1',
                'component': 'AmountInput',
                'value': {'@path': '/amount'},
                '@checks': [
                  {
                    'condition': {
                      '@call': 'isPositive',
                      'args': {
                        'value': {'@path': '/amount'},
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      ]);

      final SurfaceModel<ComponentApi> surface = processor.model.getSurface(
        's1',
      )!;
      final resolver = NodeResolver<ComponentApi>(surface);
      addTearDown(resolver.dispose);

      final ComponentNode<ComponentApi> root = resolver.rootNode.peek()!;
      expect(root.type, 'Panel');
      final titleBinding =
          root.props.peek()['title']! as WritableBinding<Object?>;
      expect(titleBinding.value, 'Initial Heading');

      // Reactive write-back through WritableBinding updates data model & props.
      titleBinding.set('Updated Heading');
      expect(
        (root.props.peek()['title']! as ResolvedBinding<Object?>).value,
        'Updated Heading',
      );

      // Mounted children resolved via canonical ComponentRefMap.
      final List<ComponentNode<ComponentApi>> children =
          (root.props.peek()['children']! as List<Object?>)
              .cast<ComponentNode<ComponentApi>>();
      expect(children.map((c) => c.componentId), ['badge1', 'amount1']);

      // Checkable validation evaluated reactively via canonical function.
      final ComponentNode<ComponentApi> amountNode = children[1];
      expect(amountNode.props.peek()['isValid'], isFalse);
      expect(amountNode.props.peek()['validationErrors'], [
        'Value must be greater than zero.',
      ]);

      // Updating data model flips isValid to true.
      processor.processMessages([
        {
          'version': '1.0',
          'updateDataModel': {
            'surfaceId': 's1',
            'path': '/amount',
            'value': 42,
          },
        },
      ]);
      expect(amountNode.props.peek()['isValid'], isTrue);
      expect(amountNode.props.peek()['validationErrors'], isEmpty);

      // Invoking action executes requiresUserActivation function.
      final ComponentNode<ComponentApi> badgeNode = children[0];
      final onTap = badgeNode.props.peek()['onTap']! as Future<void> Function();
      await onTap();
      expect(openLink.opened, ['https://example.com/docs']);
      expect(dispatchedActions, isEmpty);

      // DynamicBoolean ValidationResult coercion in Catalog.invoke.
      final dataCtx = DataContext(surface.dataModel, catalog.invoke, '/');
      final Object? inverted = catalog.invoke('invert', {
        'value': const ValidationResult(valid: false, message: 'nope'),
      }, dataCtx);
      expect(inverted, isTrue);
    });

    test('CanonicalValidator enforces bounds, strict URI, atLeastOneOf, '
        'checkable, and Unicode UAX #31 metadata extensions', () {
      final Catalog<ComponentApi, FunctionImplementation> catalog =
          _buildPureDartCatalog();
      final PayloadValidator<ComponentApi, FunctionImplementation> validator =
          PayloadValidator(catalog: catalog);

      // Rejects missing required parameter.
      expect(
        () => validator.validateComponent({'id': 'b1', 'component': 'Badge'}),
        throwsA(isA<A2uiValidationError>()),
      );

      // Rejects invalid enum value.
      expect(
        () => validator.validateComponent({
          'id': 'b1',
          'component': 'Badge',
          'label': 'Hi',
          'tone': 'invalid',
        }),
        throwsA(isA<A2uiValidationError>()),
      );

      // Rejects out-of-range number on RefType('Weight') (min: 0).
      expect(
        () => validator.validateComponent({
          'id': 'p1',
          'component': 'Panel',
          'title': 'Hi',
          'children': const <String>[],
          'weight': -1,
        }),
        throwsA(isA<A2uiValidationError>()),
      );

      // Rejects @checks on non-checkable component.
      expect(
        () => validator.validateComponent({
          'id': 'b1',
          'component': 'Badge',
          'label': 'Hi',
          '@checks': const <Object?>[],
        }),
        throwsA(isA<A2uiValidationError>()),
      );

      // Rejects URI without scheme or with whitespace.
      expect(
        () => validator.validateFunction('openLink', {'url': 'not-a-uri'}),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => validator.validateFunction('openLink', {
          'url': 'https://example.com/has space',
        }),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => validator.validateFunction('openLink', {
          'url': 'https://example.com/ok',
        }),
        returnsNormally,
      );

      // Enforces atLeastOneOf on functions.
      expect(
        () => validator.validateFunction('inBounds', const {}),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => validator.validateFunction('inBounds', {'min': 1}),
        returnsNormally,
      );

      // SurfaceProperties validation (regex pattern).
      expect(
        () => validator.validateTheme({'primaryColor': '#00BFFF'}),
        returnsNormally,
      );
      expect(
        () => validator.validateTheme({'primaryColor': 'blue'}),
        throwsA(isA<A2uiValidationError>()),
      );
    });
  });

  group('CatalogDocumentCodec & Catalog.fromJson auto-detection', () {
    test(
      'round-trips Catalog.toDocument() -> Catalog.fromJson() -> toDocument()',
      () {
        final Catalog<ComponentApi, FunctionImplementation> original =
            _buildPureDartCatalog();
        final Map<String, Object?> doc = original.toDocument();

        expect(isCatalogDocument(doc), isTrue);
        expect(doc['formatVersion'], catalogDocumentFormatVersion);
        expect(doc['catalogId'], original.id);
        expect(doc['components'], isA<List<Object?>>());
        expect(doc['functions'], isA<List<Object?>>());

        final CatalogApi reparsed = Catalog.fromJson(doc);
        expect(reparsed.id, original.id);
        expect(reparsed.protocolVersion, A2uiProtocolVersion.v1_0);
        expect(reparsed.toDocument(), equals(doc));
        expect(reparsed.model, equals(original.model));
      },
    );

    test('accepts Unicode UAX #31 identifiers', () {
      final doc = <String, Object?>{
        'formatVersion': '1.0',
        'catalogId': 'urn:a2ui:unicode',
        'metadata': {
          'extensions': {'αβ_ext': true},
        },
        'components': [
          {
            'name': 'Κάρτα',
            'parameters': [
              {'name': 'τίτλος', 'type': 'string', 'dynamic': true},
            ],
          },
        ],
      };
      final CatalogApi catalog = Catalog.fromJson(doc);
      expect(catalog.protocolVersion, A2uiProtocolVersion.v1_0);
      expect(catalog.components.keys, ['Κάρτα']);
      expect(catalog.toDocument(), equals({...doc, 'protocolVersion': '1.0'}));
    });

    test('rejects invalid Catalog Documents with A2uiCatalogError', () {
      final invalidCases = <String, Map<String, Object?>>{
        'unsupported formatVersion': {
          'formatVersion': '2.0',
          'catalogId': 'urn:test',
        },
        'missing catalogId': {'formatVersion': '1.0'},
        'unknown root property': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          r'$defs': const <String, Object?>{},
        },
        'reserved component Surface': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'components': [
            {'name': 'Surface'},
          ],
        },
        'reserved @ function name': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'functions': [
            {'name': '@index', 'returnType': 'number'},
          ],
        },
        'invalid UAX #31 component name': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'components': [
            {'name': '123Bad'},
          ],
        },
        'duplicate component name': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'components': [
            {'name': 'Box'},
            {'name': 'Box'},
          ],
        },
        'requiresUserActivation with rendererOrAgent': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'functions': [
            {
              'name': 'openIt',
              'returnType': 'void',
              'requiresUserActivation': true,
              'allowedCallers': 'rendererOrAgent',
            },
          ],
        },
        'validationResult on v0.9': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'protocolVersion': '0.9',
          'functions': [
            {'name': 'check', 'returnType': 'validationResult'},
          ],
        },
        'component-only type in function parameters': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'functions': [
            {
              'name': 'fn',
              'returnType': 'void',
              'parameters': [
                {'name': 'slot', 'type': 'child'},
              ],
            },
          ],
        },
        'component-only type in surfaceProperties': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'surfaceProperties': {
            'properties': [
              {'name': 'kids', 'type': 'childList'},
            ],
          },
        },
        'unresolved local ref': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'components': [
            {
              'name': 'Box',
              'parameters': [
                {'name': 'w', 'type': 'ref', 'ref': 'Missing'},
              ],
            },
          ],
        },
        'cyclic local ref': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'types': {
            'A': {'type': 'ref', 'ref': 'B'},
            'B': {'type': 'ref', 'ref': 'A'},
          },
        },
        'atLeastOneOf references unknown param': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'functions': [
            {
              'name': 'fn',
              'returnType': 'boolean',
              'parameters': [
                {'name': 'a', 'type': 'number'},
              ],
              'atLeastOneOf': [
                ['a', 'missing'],
              ],
            },
          ],
        },
        'union with fewer than 2 variants': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'components': [
            {
              'name': 'Box',
              'parameters': [
                {
                  'name': 'x',
                  'type': 'union',
                  'variants': [
                    {'type': 'string'},
                  ],
                },
              ],
            },
          ],
        },
        'float default on integer': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'components': [
            {
              'name': 'Slider',
              'parameters': [
                {'name': 'steps', 'type': 'integer', 'default': 1.5},
              ],
            },
          ],
        },
        'spurious name on array items': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'components': [
            {
              'name': 'Box',
              'parameters': [
                {
                  'name': 'tags',
                  'type': 'array',
                  'items': {'name': 'bad', 'type': 'string'},
                },
              ],
            },
          ],
        },
        'unknown property on StringType': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'components': [
            {
              'name': 'Text',
              'parameters': [
                {'name': 'label', 'type': 'string', 'min': 3},
              ],
            },
          ],
        },
        'missing returnType on function': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'functions': [
            {'name': 'fn'},
          ],
        },
      };

      for (final MapEntry<String, Map<String, Object?>> entry
          in invalidCases.entries) {
        expect(
          () => Catalog.fromJson(entry.value),
          throwsA(isA<A2uiCatalogError>()),
          reason: 'Expected A2uiCatalogError for: ${entry.key}',
        );
      }
    });
  });

  group('Lossless bidirectional round-trip of published catalogs', () {
    final String repoRoot = _findRepoRoot();

    test(
      'BasicCatalog.v1_0() round-trips through toDocument -> fromDocument -> '
      'toJsonSchema',
      () {
        final Catalog<ComponentApi, FunctionImplementation> basic =
            BasicCatalog.v1_0();
        final Map<String, Object?> doc = basic.toDocument();
        expect(doc['formatVersion'], '1.0');
        expect((doc['types']! as Map).containsKey('Weight'), isTrue);

        final CatalogApi fromDoc = Catalog.fromDocument(doc);
        expect(fromDoc.toDocument(), equals(doc));
        expect(fromDoc.components.length, basic.components.length);
        expect(fromDoc.functions.length, basic.functions.length);

        // Verify specific complex translations survived losslessly.
        final ComponentDefinition dt = fromDoc.model.component(
          'DateTimeInput',
        )!;
        expect(dt.checkable, isTrue);
        final minType = dt.parameter('min')!.type as StringType;
        expect(minType.dynamic, isTrue);
        expect(minType.formats, ['date', 'time', 'date-time']);

        final FunctionDefinition openUrl = fromDoc.model.function('openUrl')!;
        expect(openUrl.requiresUserActivation, isTrue);
        final urlType = openUrl.parameter('url')!.type as StringType;
        expect(urlType.dynamic, isTrue);
        expect(urlType.format, 'uri');

        final FunctionDefinition lengthFn = fromDoc.model.function('length')!;
        expect(lengthFn.atLeastOneOf, [
          ['min', 'max'],
        ]);

        // Emit back to JSON Schema and verify Catalog.fromJson accepts it.
        final Map<String, Object?> jsonSchema = fromDoc.toJsonSchema();
        final CatalogApi fromSchema = Catalog.fromJson(jsonSchema);
        expect(fromSchema.components.keys, equals(basic.components.keys));
        expect(fromSchema.functions.keys, equals(basic.functions.keys));
        expect(fromSchema.toDocument(), equals(doc));
      },
    );

    test(
      'BasicCatalog.v0_9() round-trips through toDocument -> fromDocument -> '
      'toJsonSchema',
      () {
        final Catalog<ComponentApi, FunctionImplementation> basic =
            BasicCatalog.v0_9();
        final Map<String, Object?> doc = basic.toDocument();
        expect(doc['surfaceProperties'], isA<Map<String, Object?>>());

        final CatalogApi fromDoc = Catalog.fromDocument(
          doc,
          protocolVersion: A2uiProtocolVersion.v0_9,
        );
        expect(fromDoc.components.length, basic.components.length);
        expect(fromDoc.functions.length, basic.functions.length);
        expect(fromDoc.model.surfaceProperties, isNotNull);

        final Map<String, Object?> jsonSchema = fromDoc.toJsonSchema();
        final CatalogApi fromSchema = Catalog.fromJson(
          jsonSchema,
          protocolVersion: A2uiProtocolVersion.v0_9,
        );
        expect(fromSchema.components.keys, equals(basic.components.keys));
        expect(fromSchema.functions.keys, equals(basic.functions.keys));
      },
    );

    for (final relPath in const [
      'catalogs/mcp/v1/catalog.json',
      'catalogs/vegachart/v1/catalog.json',
    ]) {
      test('$relPath round-trips through toDocument -> fromDocument -> '
          'toJsonSchema', () {
        final raw = jsonDecode(
          File('$repoRoot/$relPath').readAsStringSync(),
        ) as Map<String, Object?>;
        final CatalogApi original = Catalog.fromJson(raw);
        final Map<String, Object?> doc = original.toDocument();
        final CatalogApi reparsed = Catalog.fromDocument(doc);

        expect(reparsed.toDocument(), equals(doc));
        expect(reparsed.components.keys, equals(original.components.keys));
        expect(reparsed.functions.keys, equals(original.functions.keys));

        final Map<String, Object?> roundTrippedSchema = reparsed.toJsonSchema();
        final CatalogApi viaSchema = Catalog.fromJson(roundTrippedSchema);
        expect(viaSchema.toDocument(), equals(doc));
      });
    }
  });
}
