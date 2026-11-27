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

class _CheckFlagsFunction extends FunctionImplementation {
  _CheckFlagsFunction()
    : super.define(
        name: 'checkFlags',
        returnType: A2uiReturnType.boolean,
        parameters: [
          ParameterDefinition.array('flags', items: const RefType(ref: 'Flag')),
          ParameterDefinition.ref('a', ref: 'Flag'),
          ParameterDefinition.ref('b', ref: 'Flag'),
          ParameterDefinition.union(
            'mixed',
            variants: const [BooleanType(dynamic: true), StringType()],
          ),
        ],
      );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? signal,
  ]) =>
      args['a'] == true &&
      args['b'] == false &&
      args['mixed'] == true &&
      (args['flags'] as List<dynamic>)[0] == true &&
      (args['flags'] as List<dynamic>)[1] == false;
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

        // Component own properties precede `$ref` mixin properties (`weight`)
        // and `ComponentCommon.accessibility` is not synthesized into params.
        final ComponentDefinition textDef = fromDoc.model.component('Text')!;
        expect(textDef.parameters.first.name, 'text');
        expect(textDef.parameters.last.name, 'weight');
        expect(textDef.parameter('accessibility'), isNull);

        // `toJson()` on a v0.9 canonical catalog emits v0.9 envelope & refs.
        final Map<String, Object?> v09Json = fromDoc.toJson();
        final v09Components = v09Json['components']! as Map<String, Object?>;
        final textJson = v09Components['Text']! as Map<String, Object?>;
        expect(textJson['unevaluatedProperties'], isFalse);
        expect(jsonEncode(textJson), contains('ComponentCommon'));
        expect(
          jsonEncode(v09Components['Card']),
          contains('common_types.json#/\$defs/ComponentId'),
        );
        expect(
          jsonEncode(v09Components['Card']),
          isNot(contains('common_types.json#/\$defs/Child"')),
        );

        final Map<String, Object?> jsonSchema = fromDoc.toJsonSchema();
        final CatalogApi fromSchema = Catalog.fromJson(
          jsonSchema,
          protocolVersion: A2uiProtocolVersion.v0_9,
        );
        expect(fromSchema.components.keys, equals(basic.components.keys));
        expect(fromSchema.functions.keys, equals(basic.functions.keys));
        expect(fromSchema.toDocument(), equals(doc));
      },
    );

    test(
      'v0.9 component declaring custom accessibility retains required id',
      () {
        final v09Custom = Catalog<ComponentApi, FunctionApi>(
          id: 'urn:a2ui:v09-custom-a11y',
          protocolVersion: A2uiProtocolVersion.v0_9,
          components: [
            ComponentApi.define(
              name: 'Reader',
              parameters: [
                ParameterDefinition.string('accessibility', required: true),
              ],
            ),
          ],
        );
        final Map<String, Object?> json = v09Custom.toJson();
        final reader =
            (json['components']! as Map<String, Object?>)['Reader']!
                as Map<String, Object?>;
        expect(reader['required'], contains('id'));
        expect(reader['unevaluatedProperties'], isFalse);
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

  group('Refinement hardening & edge-case regressions', () {
    test('JsonSchemaCodec round-trips ObjectType.atLeastOneOf, non-dynamic '
        'multi-format StringType, v0.9 FunctionCall allOf, allOf '
        'additionalProperties, and all 4 AnyType variants', () {
      final model = CatalogModel(
        catalogId: 'urn:a2ui:codec-roundtrip-edge',
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: [
          ComponentDefinition(
            name: 'Probe',
            parameters: [
              ParameterDefinition.object(
                'range',
                properties: [
                  ParameterDefinition.number('min'),
                  ParameterDefinition.number('max'),
                  ParameterDefinition.number('step'),
                ],
                atLeastOneOf: const [
                  ['min', 'max'],
                ],
              ),
              ParameterDefinition.object(
                'multiRange',
                properties: [
                  ParameterDefinition.number('a'),
                  ParameterDefinition.number('b'),
                  ParameterDefinition.number('c'),
                  ParameterDefinition.number('d'),
                ],
                atLeastOneOf: const [
                  ['a', 'b'],
                  ['c', 'd'],
                ],
              ),
              ParameterDefinition.string(
                'when',
                formats: const ['date', 'time'],
                minLength: 4,
                maxLength: 20,
              ),
              ParameterDefinition.any(
                'anyDynNull',
                dynamic: true,
                nullable: true,
              ),
              ParameterDefinition.any('anyDynNonNull', dynamic: true),
              ParameterDefinition.any('anyStaticNonNull'),
              ParameterDefinition.any('anyStaticNull', nullable: true),
            ],
          ),
        ],
      );
      final Map<String, Object?> schema = JsonSchemaCodec.toJsonSchema(model);
      final CatalogModel back = JsonSchemaCodec.fromJsonSchema(schema);
      final ComponentDefinition probe = back.component('Probe')!;
      expect(probe.parameter('range')!.type, isA<ObjectType>());
      expect(
        (probe.parameter('range')!.type as ObjectType).atLeastOneOf,
        const [
          ['min', 'max'],
        ],
      );
      expect(
        (probe.parameter('multiRange')!.type as ObjectType).atLeastOneOf,
        const [
          ['a', 'b'],
          ['c', 'd'],
        ],
      );
      final whenType = probe.parameter('when')!.type as StringType;
      expect(whenType.dynamic, isFalse);
      expect(whenType.formats, const ['date', 'time']);
      expect(whenType.minLength, 4);
      expect(whenType.maxLength, 20);
      expect(
        probe.parameter('anyDynNull')!.type,
        const AnyType(dynamic: true, nullable: true),
      );
      expect(
        probe.parameter('anyDynNonNull')!.type,
        const AnyType(dynamic: true),
      );
      expect(probe.parameter('anyStaticNonNull')!.type, const AnyType());
      expect(
        probe.parameter('anyStaticNull')!.type,
        const AnyType(nullable: true),
      );

      // v0.9 inline `allOf: [FunctionCall, {returnType}]` collapses into a
      // dynamic scalar.
      final TypeDefinition v09Dyn = JsonSchemaCodec.schemaToTypeDefinition({
        'oneOf': [
          {'type': 'string', 'format': 'uri'},
          {r'$ref': 'common_types.json#/\$defs/DataBinding'},
          {
            'allOf': [
              {r'$ref': 'common_types.json#/\$defs/FunctionCall'},
              {
                'properties': {
                  'returnType': {'const': 'string'},
                },
              },
            ],
          },
        ],
      }, atLeastV1: false);
      expect(v09Dyn, const StringType(dynamic: true, format: 'uri'));

      // `additionalProperties: false` declared inside an `allOf` subschema
      // is preserved when flattening objects.
      final TypeDefinition closedAllOf = JsonSchemaCodec.schemaToTypeDefinition(
        {
          'allOf': [
            {
              'type': 'object',
              'properties': {
                'x': {'type': 'string'},
              },
              'additionalProperties': false,
            },
            {
              'type': 'object',
              'properties': {
                'y': {'type': 'number'},
              },
            },
          ],
        },
      );
      expect(closedAllOf, isA<ObjectType>());
      expect((closedAllOf as ObjectType).additionalProperties, isFalse);
    });

    test('CatalogDocumentCodec rejects structural cycles, explicit null, '
        'heterogeneous enum, out-of-set enum default, inverted bounds, '
        'invalid regex, and missing catalogId even with override', () {
      final invalidDocs = <String, Map<String, Object?>>{
        'structural cycle via ObjectType': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'types': {
            'Node': {
              'type': 'object',
              'properties': [
                {'name': 'next', 'type': 'ref', 'ref': 'Node'},
              ],
            },
          },
        },
        'structural cycle via ArrayType': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'types': {
            'Tree': {
              'type': 'array',
              'items': {'type': 'ref', 'ref': 'Tree'},
            },
          },
        },
        'structural cycle via UnionType': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'types': {
            'Val': {
              'type': 'union',
              'variants': [
                {'type': 'string'},
                {'type': 'ref', 'ref': 'Val'},
              ],
            },
          },
        },
        'structural cycle via additionalProperties': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'types': {
            'Dict': {
              'type': 'object',
              'additionalProperties': {'type': 'ref', 'ref': 'Dict'},
            },
          },
        },
        'explicit null title': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'title': null,
        },
        'explicit null checkable': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'components': [
            {'name': 'Box', 'checkable': null},
          ],
        },
        'explicit null metadata.extensions': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'metadata': {'extensions': null},
        },
        'explicit null enum default': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'components': [
            {
              'name': 'Box',
              'parameters': [
                {
                  'name': 'mode',
                  'type': 'enum',
                  'values': ['a', 'b'],
                  'default': null,
                },
              ],
            },
          ],
        },
        'mixed-type enum values': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'components': [
            {
              'name': 'Box',
              'parameters': [
                {
                  'name': 'mode',
                  'type': 'enum',
                  'values': ['a', 1],
                },
              ],
            },
          ],
        },
        'numeric enum without valueType': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'components': [
            {
              'name': 'Box',
              'parameters': [
                {
                  'name': 'level',
                  'type': 'enum',
                  'values': [1, 2],
                },
              ],
            },
          ],
        },
        'enum default not in values': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'components': [
            {
              'name': 'Box',
              'parameters': [
                {
                  'name': 'mode',
                  'type': 'enum',
                  'values': ['a', 'b'],
                  'default': 'c',
                },
              ],
            },
          ],
        },
        'inverted number bounds': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'components': [
            {
              'name': 'Box',
              'parameters': [
                {'name': 'n', 'type': 'number', 'min': 10, 'max': 5},
              ],
            },
          ],
        },
        'inverted string length bounds': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'components': [
            {
              'name': 'Box',
              'parameters': [
                {
                  'name': 's',
                  'type': 'string',
                  'minLength': 10,
                  'maxLength': 2,
                },
              ],
            },
          ],
        },
        'inverted array item bounds': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'components': [
            {
              'name': 'Box',
              'parameters': [
                {'name': 'xs', 'type': 'array', 'minItems': 5, 'maxItems': 1},
              ],
            },
          ],
        },
        'invalid regex pattern': {
          'formatVersion': '1.0',
          'catalogId': 'urn:test',
          'components': [
            {
              'name': 'Box',
              'parameters': [
                {'name': 's', 'type': 'string', 'pattern': '[unclosed'},
              ],
            },
          ],
        },
      };

      for (final MapEntry<String, Map<String, Object?>> e
          in invalidDocs.entries) {
        expect(
          () => parseCatalogDocument(e.value),
          throwsA(isA<A2uiCatalogError>()),
          reason: 'Expected A2uiCatalogError for: ${e.key}',
        );
        expect(
          validateCatalogDocument(e.value),
          isNotEmpty,
          reason: 'Expected diagnostics for: ${e.key}',
        );
      }

      // Missing `catalogId` is rejected even when caller passes override.
      expect(
        () => parseCatalogDocument(const {
          'formatVersion': '1.0',
        }, catalogId: 'urn:override'),
        throwsA(isA<A2uiCatalogError>()),
      );

      // `Catalog.fromModel` and `serializeCatalogDocument` validate models.
      const badModel = CatalogModel(
        catalogId: 'urn:bad',
        components: [ComponentDefinition(name: 'Surface')],
      );
      expect(
        () => Catalog.fromModel(badModel),
        throwsA(isA<A2uiCatalogError>()),
      );
      expect(
        () => serializeCatalogDocument(badModel),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('CanonicalValidator enforces calendar dates, RFC 3339 time bounds, '
        'Unicode code-point length, whole-number doubles, v0.9 dynamic Object '
        'with path key, shared RefType coercion, and mixed canonical+legacy '
        'catalogs', () {
      final catalog = Catalog<ComponentApi, FunctionImplementation>(
        id: 'urn:a2ui:validator-edge',
        protocolVersion: A2uiProtocolVersion.v1_0,
        types: const {'Flag': BooleanType(dynamic: true)},
        components: [
          ComponentApi.define(
            name: 'Form',
            parameters: [
              ParameterDefinition.string('date', format: 'date'),
              ParameterDefinition.string('time', format: 'time'),
              ParameterDefinition.string('dateTime', format: 'date-time'),
              ParameterDefinition.string('emoji', minLength: 1, maxLength: 1),
              ParameterDefinition.integer('count'),
            ],
          ),
        ],
        functions: [_CheckFlagsFunction()],
      );

      final PayloadValidator<ComponentApi, FunctionImplementation> validator =
          PayloadValidator(catalog: catalog);

      // Valid calendar leap day, lowercase RFC 3339 t/z, single emoji
      // code point (2 UTF-16 code units!), and whole-number double `2.0`.
      expect(
        () => validator.validateComponent({
          'id': 'root',
          'component': 'Form',
          'date': '2024-02-29',
          'time': '23:59:59z',
          'dateTime': '2024-02-29t12:30:00+05:30',
          'emoji': '😀',
          'count': 2.0,
        }),
        returnsNormally,
      );

      // Reject invalid calendar dates, out-of-range times, fractional double
      // for integer, and 2-emoji string for maxLength: 1.
      for (final Map<String, Object?> badProp in const [
        {'date': '2024-02-31'},
        {'date': '2023-02-29'},
        {'time': '99:99:99+99:99'},
        {'dateTime': '2024-01-01T25:00:00Z'},
        {'emoji': '😀😀'},
        {'count': 1.5},
      ]) {
        expect(
          () => validator.validateComponent({
            'id': 'root',
            'component': 'Form',
            ...badProp,
          }),
          throwsA(isA<A2uiValidationError>()),
          reason: 'Expected validation error for $badProp',
        );
      }

      // Repeated RefType in array elements, sibling params, and UnionType
      // all coerce ValidationResult cleanly without shared-Set corruption.
      final dataContext = DataContext(DataModel(), catalog.invoke, '/');
      final Object? coercedResult = catalog.invoke('checkFlags', {
        'flags': const [
          ValidationResult(valid: true),
          ValidationResult(valid: false),
        ],
        'a': const ValidationResult(valid: true),
        'b': const ValidationResult(valid: false),
        'mixed': const ValidationResult(valid: true),
      }, dataContext);
      expect(coercedResult, isTrue);

      // v0.9 dynamic ObjectType with a `path` property accepts a literal map.
      final v09Catalog = Catalog<ComponentApi, FunctionApi>(
        id: 'urn:a2ui:v09-dyn-obj',
        protocolVersion: A2uiProtocolVersion.v0_9,
        components: [
          ComponentApi.define(
            name: 'Link',
            parameters: [
              ParameterDefinition.object(
                'route',
                dynamic: true,
                properties: [
                  ParameterDefinition.string('path', required: true),
                  ParameterDefinition.string('label', required: true),
                ],
              ),
            ],
          ),
        ],
      );
      final PayloadValidator<ComponentApi, FunctionApi> v09Validator =
          PayloadValidator(catalog: v09Catalog);
      expect(
        () => v09Validator.validateComponent({
          'id': 'root',
          'component': 'Link',
          'route': {'path': '/home', 'label': 'Home'},
        }),
        returnsNormally,
      );

      // Mixed canonical component + legacy v0.9 function validates calls to
      // the legacy function without "Unknown function".
      final Catalog<ComponentApi, FunctionImplementation> legacyBasic =
          BasicCatalog.v0_9();
      final mixed = Catalog<ComponentApi, FunctionImplementation>(
        id: 'urn:a2ui:mixed-v09',
        protocolVersion: A2uiProtocolVersion.v0_9,
        components: [
          ComponentApi.define(
            name: 'Banner',
            parameters: [ParameterDefinition.string('text', dynamic: true)],
          ),
        ],
        functions: [legacyBasic.functions['formatString']!],
      );
      final PayloadValidator<ComponentApi, FunctionImplementation>
      mixedValidator = PayloadValidator(catalog: mixed);
      expect(
        () => mixedValidator.validateComponent({
          'id': 'root',
          'component': 'Banner',
          'text': {
            'call': 'formatString',
            'args': {'value': 'Hello'},
          },
        }),
        returnsNormally,
      );

      // Defensive cycle guard: hand-constructed cyclic types terminate cleanly
      // in PayloadValidator without StackOverflowError.
      final cyclicCatalog = Catalog<ComponentApi, FunctionApi>(
        id: 'urn:a2ui:cyclic-runtime',
        protocolVersion: A2uiProtocolVersion.v1_0,
        types: const {
          'Node': ObjectType(
            properties: [
              ParameterDefinition(
                name: 'next',
                type: RefType(ref: 'Node'),
              ),
            ],
          ),
        },
        components: [
          ComponentApi.define(
            name: 'Tree',
            parameters: [ParameterDefinition.ref('root', ref: 'Node')],
          ),
        ],
      );
      final PayloadValidator<ComponentApi, FunctionApi> cyclicValidator =
          PayloadValidator(catalog: cyclicCatalog);
      expect(
        () => cyclicValidator.validateComponent({
          'id': 'root',
          'component': 'Tree',
          'root': {
            'next': {'next': const <String, Object?>{}},
          },
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('Exhaustive TypeDefinition switch, const .fromDefinition, model '
        'equality, A2uiReturnType.fromJson, mutable serialize, and '
        'Catalog.copyWith/derive metadata', () {
      // Exhaustive 19-case switch with zero wildcard/default arm.
      String labelOf(TypeDefinition t) => switch (t) {
        StringType() => 'string',
        NumberType() => 'number',
        IntegerType() => 'integer',
        BooleanType() => 'boolean',
        EnumType() => 'enum',
        ConstType() => 'const',
        AnyType() => 'any',
        ObjectType() => 'object',
        ArrayType() => 'array',
        UnionType() => 'union',
        RefType() => 'ref',
        DataBindingType() => 'dataBinding',
        FunctionCallType() => 'functionCall',
        ChildType() => 'child',
        ChildListType() => 'childList',
        ActionType() => 'action',
        CheckRuleType() => 'checkRule',
        AccessibilityType() => 'accessibility',
        RawJsonSchemaType() => 'raw',
      };
      expect(labelOf(const RawJsonSchemaType({'not': {}})), 'raw');

      // Genuine `const` authoring via `.fromDefinition`.
      const comp = ComponentApi.fromDefinition(
        ComponentDefinition(
          name: 'ConstCard',
          parameters: [ParameterDefinition(name: 'title', type: StringType())],
        ),
      );
      const fn = FunctionApi.fromDefinition(
        FunctionDefinition(name: 'constFn'),
      );
      expect(comp.name, 'ConstCard');
      expect(fn.name, 'constFn');

      // Effective equality on FunctionDefinition and FunctionReturnDefinition.
      expect(
        const FunctionDefinition(name: 'f'),
        equals(
          const FunctionDefinition(
            name: 'f',
            allowedCallers: AllowedCallers.rendererOnly,
            requiresUserActivation: false,
          ),
        ),
      );
      expect(
        const FunctionReturnDefinition.shorthand(
          A2uiReturnType.string,
          description: 'greeting',
        ),
        equals(
          FunctionReturnDefinition.typed(
            const StringType(description: 'greeting'),
          ),
        ),
      );
      expect(A2uiReturnType.fromJson('void_'), A2uiReturnType.any);
      expect(A2uiReturnType.fromJson('void'), A2uiReturnType.void_);

      // `serializeCatalogDocument` emits plain mutable maps and lists.
      final Map<String, Object?> serialized = serializeCatalogDocument(
        const CatalogModel(
          catalogId: 'urn:mutable',
          metadata: {
            'extensions': {
              'custom': {'flag': true},
            },
          },
          components: [
            ComponentDefinition(
              name: 'Card',
              parameters: [
                ParameterDefinition(
                  name: 'data',
                  type: ObjectType(
                    defaultValue: {
                      'k': [1, 2],
                    },
                  ),
                ),
              ],
            ),
          ],
        ),
      );
      ((serialized['metadata']! as Map<String, Object?>)['extensions']!
              as Map<String, Object?>)['extra'] =
          1;
      expect(
        ((serialized['metadata']! as Map<String, Object?>)['extensions']!
            as Map<String, Object?>)['extra'],
        1,
      );

      // `Catalog.derive` preserves metadata & `$schema`; `copyWith` updates
      // `types`.
      final CatalogApi base = Catalog.fromDocument({
        r'$schema': 'https://example.org/catalog.schema.json',
        'formatVersion': '1.0',
        'catalogId': 'urn:base',
        'metadata': {
          'extensions': {'team': 'a2ui'},
        },
        'types': {
          'OldType': {'type': 'string'},
        },
        'components': [
          {'name': 'Box'},
        ],
      });
      final CatalogApi derived = base.derive(catalogId: 'urn:derived');
      expect(
        derived.toDocument()[r'$schema'],
        'https://example.org/catalog.schema.json',
      );
      expect(derived.model.metadata, base.model.metadata);

      final CatalogApi copied = base.copyWith(
        types: const {'NewType': IntegerType()},
      );
      expect(copied.types.keys, ['NewType']);
    });
  });
}
