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
import 'package:json_schema_builder/json_schema_builder.dart'
    hide ValidationResult;
import 'package:test/test.dart';

class _TestCapitalize extends FunctionImplementation {
  _TestCapitalize()
      : super(
          name: 'capitalize',
          returnType: A2uiReturnType.string,
          argumentSchema: Schema.object(
            properties: {
              'value': Schema.fromMap({
                r'$ref': r'common_types.json#/$defs/DynamicString',
              }),
            },
            required: ['value'],
          ),
        );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    final String val = args['value']?.toString() ?? '';
    if (val.isEmpty) return '';
    return val[0].toUpperCase() + val.substring(1);
  }
}

class _TestOpenUrl extends FunctionImplementation {
  final List<String> openedUrls = [];

  _TestOpenUrl()
      : super(
          name: 'openUrl',
          returnType: A2uiReturnType.void_,
          argumentSchema: Schema.object(
            properties: {
              'url': Schema.fromMap({
                r'$ref': r'common_types.json#/$defs/DynamicString',
              }),
            },
            required: ['url'],
          ),
        );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    openedUrls.add(args['url']?.toString() ?? '');
    return null;
  }
}

Map<String, Object?> _atChildSchemaTypes() {
  final Map<String, Object?> doc =
      PayloadValidator.commonTypesFor(A2uiProtocolVersion.v1_0);
  final defs =
      Map<String, Object?>.from(doc[r'$defs']! as Map<Object?, Object?>);
  defs['Child'] = {
    'type': 'object',
    'properties': {
      '@child': {'type': 'string'},
    },
    'required': ['@child'],
    'additionalProperties': false,
  };
  defs['ChildList'] = {
    'oneOf': [
      {
        'type': 'object',
        'properties': {
          '@child': {
            'type': 'array',
            'items': {'type': 'string'},
          },
        },
        'required': ['@child'],
        'additionalProperties': false,
      },
      {
        'type': 'object',
        'properties': {
          '@child': {'type': 'string'},
          '@path': {'type': 'string'},
        },
        'required': ['@child', '@path'],
        'additionalProperties': false,
      },
    ],
  };
  defs['Action'] = {
    'oneOf': [
      {
        'type': 'object',
        'properties': {
          '@action': {
            'type': 'object',
            'properties': {
              'name': {'type': 'string'},
              'userMessage': {r'$ref': r'#/$defs/DynamicString'},
              'context': {'type': 'object'},
            },
            'required': ['name'],
            'additionalProperties': false,
          },
        },
        'required': ['@action'],
        'additionalProperties': false,
      },
      {
        'type': 'object',
        'properties': {
          '@functionCall': {r'$ref': r'#/$defs/FunctionCall'},
        },
        'required': ['@functionCall'],
        'additionalProperties': false,
      },
    ],
  };
  return {...doc, r'$defs': defs};
}

Catalog<ComponentApi, FunctionImplementation> _makeCustomV1Catalog({
  _TestOpenUrl? openUrl,
}) {
  final dynamicStringRef =
      Schema.fromMap({r'$ref': r'common_types.json#/$defs/DynamicString'});
  final childRef = Schema.fromMap({r'$ref': r'common_types.json#/$defs/Child'});
  final childListRef =
      Schema.fromMap({r'$ref': r'common_types.json#/$defs/ChildList'});
  final actionRef =
      Schema.fromMap({r'$ref': r'common_types.json#/$defs/Action'});

  return Catalog<ComponentApi, FunctionImplementation>(
    id: 'https://example.com/custom-v1-catalog.json',
    protocolVersion: A2uiProtocolVersion.v1_0,
    components: [
      ComponentApi(
        name: 'Text',
        schema: Schema.object(
          properties: {'text': dynamicStringRef},
          required: ['text'],
        ),
      ),
      ComponentApi(
        name: 'Card',
        schema: Schema.object(
          properties: {'child': childRef},
          required: ['child'],
        ),
      ),
      ComponentApi(
        name: 'Column',
        schema: Schema.object(
          properties: {'children': childListRef},
          required: ['children'],
        ),
      ),
      ComponentApi(
        name: 'Tabs',
        schema: Schema.object(
          properties: {
            'tabs': Schema.list(
              items: Schema.object(
                properties: {
                  'title': dynamicStringRef,
                  'child': childRef,
                },
                required: ['title', 'child'],
              ),
            ),
          },
          required: ['tabs'],
        ),
      ),
      ComponentApi(
        name: 'Button',
        schema: Schema.combined(
          allOf: [
            CommonSchemas.checkable,
            Schema.object(
              properties: {
                'child': childRef,
                'action': actionRef,
              },
              required: ['child', 'action'],
            ),
          ],
        ),
      ),
      ComponentApi(
        name: 'OpenShell',
        schema: Schema.object(),
      ),
      ComponentApi(
        name: 'RestrictedParent',
        schema: Schema.object(),
        allowedChildren: ['Text'],
      ),
      ComponentApi(
        name: 'RestrictedChild',
        schema: Schema.object(),
        allowedParents: ['RestrictedParent'],
      ),
    ],
    functions: [
      _TestCapitalize(),
      openUrl ?? _TestOpenUrl(),
    ],
  );
}

void main() {
  final String v1JsonVersion = A2uiProtocolVersion.v1_0.jsonValue;

  group('v1.0 @child, @action, and @functionCall validation', () {
    late Catalog<ComponentApi, FunctionImplementation> basicV1;
    late PayloadValidator<ComponentApi, FunctionImplementation> validator;
    late Catalog<ComponentApi, FunctionImplementation> atSchemaCatalog;
    late PayloadValidator<ComponentApi, FunctionImplementation>
        atSchemaValidator;

    setUp(() {
      basicV1 = BasicCatalog.v1_0();
      validator = PayloadValidator(catalog: basicV1);
      atSchemaCatalog = _makeCustomV1Catalog();
      atSchemaValidator = PayloadValidator(
        catalog: atSchemaCatalog,
        commonTypesSchema: _atChildSchemaTypes(),
      );
    });

    test('validates @child, @action, and @functionCall against bare schemas',
        () {
      expect(
        () => validator.validateComponent({
          'id': 'card1',
          'component': 'Card',
          'child': {'@child': 'txt1'},
        }),
        returnsNormally,
      );
      expect(
        () => validator.validateComponent({
          'id': 'col1',
          'component': 'Column',
          'children': {
            '@child': ['a', 'b'],
          },
        }),
        returnsNormally,
      );
      expect(
        () => validator.validateComponent({
          'id': 'list1',
          'component': 'List',
          'children': {'@child': 'tpl', '@path': '/items'},
        }),
        returnsNormally,
      );
      expect(
        () => validator.validateComponent({
          'id': 'tabs1',
          'component': 'Tabs',
          'tabs': [
            {
              'title': 'Tab 1',
              'child': {'@child': 'pane1'},
            },
          ],
        }),
        returnsNormally,
      );
      expect(
        () => validator.validateComponent({
          'id': 'btn1',
          'component': 'Button',
          'child': {'@child': 'lbl1'},
          'action': {
            '@action': {
              'name': 'submit',
              'userMessage': {
                '@call': 'formatString',
                'args': {'value': r'${/name}'},
              },
              'context': {
                'id': {'@path': '/id'},
                'literalAt': {'@@child': 'ok', '@@action': 'ok'},
              },
            },
          },
        }),
        returnsNormally,
      );
      expect(
        () => validator.validateComponent({
          'id': 'btn2',
          'component': 'Button',
          'child': {'@child': 'lbl1'},
          'action': {
            '@functionCall': {
              '@call': 'openUrl',
              'args': {'url': 'https://a2ui.org'},
            },
          },
        }),
        returnsNormally,
      );
    });

    test('dual-reads @ and legacy bare shapes when schema declares @ shapes',
        () {
      for (final Map<String, Object?> card in [
        {
          'id': 'card1',
          'component': 'Card',
          'child': {'@child': 'txt1'},
        },
        {'id': 'card2', 'component': 'Card', 'child': 'txt1'},
      ]) {
        expect(
            () => atSchemaValidator.validateComponent(card), returnsNormally);
      }

      for (final Map<String, Object?> col in [
        {
          'id': 'col1',
          'component': 'Column',
          'children': {
            '@child': ['a', 'b'],
          },
        },
        {
          'id': 'col2',
          'component': 'Column',
          'children': ['a', 'b'],
        },
        {
          'id': 'col3',
          'component': 'Column',
          'children': {'@child': 'tpl', '@path': '/items'},
        },
        {
          'id': 'col4',
          'component': 'Column',
          'children': {'componentId': 'tpl', 'path': '/items'},
        },
      ]) {
        expect(() => atSchemaValidator.validateComponent(col), returnsNormally);
      }

      for (final Map<String, Object?> tabs in [
        {
          'id': 'tabs1',
          'component': 'Tabs',
          'tabs': [
            {
              'title': 'One',
              'child': {'@child': 'p1'},
            },
          ],
        },
        {
          'id': 'tabs2',
          'component': 'Tabs',
          'tabs': [
            {'title': 'One', 'child': 'p1'},
          ],
        },
      ]) {
        expect(
            () => atSchemaValidator.validateComponent(tabs), returnsNormally);
      }

      for (final Map<String, Object?> btn in [
        {
          'id': 'b1',
          'component': 'Button',
          'child': {'@child': 'lbl'},
          'action': {
            '@action': {'name': 'tap'},
          },
        },
        {
          'id': 'b2',
          'component': 'Button',
          'child': 'lbl',
          'action': {
            'event': {'name': 'tap'},
          },
        },
        {
          'id': 'b3',
          'component': 'Button',
          'child': {'@child': 'lbl'},
          'action': {
            '@functionCall': {
              '@call': 'openUrl',
              'args': {'url': 'https://a2ui.org'},
            },
          },
        },
        {
          'id': 'b4',
          'component': 'Button',
          'child': 'lbl',
          'action': {
            'functionCall': {
              '@call': 'openUrl',
              'args': {'url': 'https://a2ui.org'},
            },
          },
        },
      ]) {
        expect(() => atSchemaValidator.validateComponent(btn), returnsNormally);
      }
    });

    test('rejects malformed @child with exact JSON Pointer paths', () {
      void expectInvalid(Map<String, Object?> component, String expectedPath) {
        expect(
          () => validator.validateComponent(component),
          throwsA(
            isA<A2uiValidationError>()
                .having((e) => e.path, 'path', expectedPath),
          ),
        );
      }

      expectInvalid(
        {
          'id': 'c1',
          'component': 'Card',
          'child': {'@child': ''},
        },
        '/child/@child',
      );
      expectInvalid(
        {
          'id': 'c2',
          'component': 'Card',
          'child': {'@child': 42},
        },
        '/child/@child',
      );
      expectInvalid(
        {
          'id': 'c3',
          'component': 'Column',
          'children': {
            '@child': ['ok', ''],
          },
        },
        '/children/@child/1',
      );
      expectInvalid(
        {
          'id': 'c4',
          'component': 'List',
          'children': {
            '@child': ['a'],
            '@path': '/items',
          },
        },
        '/children/@child',
      );
      expectInvalid(
        {
          'id': 'c5',
          'component': 'List',
          'children': {'@child': 'tpl', '@path': ''},
        },
        '/children/@path',
      );
      expectInvalid(
        {
          'id': 'c6',
          'component': 'Card',
          'child': {'@child': 'a', 'extra': true},
        },
        '/child/extra',
      );
    });

    test('rejects malformed @action and @functionCall with exact paths', () {
      void expectInvalid(Map<String, Object?> component, String expectedPath) {
        expect(
          () => validator.validateComponent(component),
          throwsA(
            isA<A2uiValidationError>()
                .having((e) => e.path, 'path', expectedPath),
          ),
        );
      }

      expectInvalid(
        {
          'id': 'b1',
          'component': 'Button',
          'child': {'@child': 'lbl'},
          'action': {'@action': 'bad'},
        },
        '/action/@action',
      );
      expectInvalid(
        {
          'id': 'b2',
          'component': 'Button',
          'child': {'@child': 'lbl'},
          'action': {
            '@action': {'name': 'ok'},
            'extra': 1,
          },
        },
        '/action/extra',
      );
      expectInvalid(
        {
          'id': 'b3',
          'component': 'Button',
          'child': {'@child': 'lbl'},
          'action': {'@action': <String, Object?>{}},
        },
        '/action/@action/name',
      );
      expectInvalid(
        {
          'id': 'b4',
          'component': 'Button',
          'child': {'@child': 'lbl'},
          'action': {
            '@action': {'name': ''},
          },
        },
        '/action/@action/name',
      );
      expectInvalid(
        {
          'id': 'b5',
          'component': 'Button',
          'child': {'@child': 'lbl'},
          'action': {
            '@action': {'name': 'ok', 'bogus': 1},
          },
        },
        '/action/@action/bogus',
      );
      expectInvalid(
        {
          'id': 'b6',
          'component': 'Button',
          'child': {'@child': 'lbl'},
          'action': {
            '@action': {'name': 'ok', 'userMessage': 99},
          },
        },
        '/action/@action/userMessage',
      );
      expectInvalid(
        {
          'id': 'b7',
          'component': 'Button',
          'child': {'@child': 'lbl'},
          'action': {
            '@action': {'name': 'ok', 'context': 'notObject'},
          },
        },
        '/action/@action/context',
      );
      expectInvalid(
        {
          'id': 'b8',
          'component': 'Button',
          'child': {'@child': 'lbl'},
          'action': {'@functionCall': 'bad'},
        },
        '/action/@functionCall',
      );
      expectInvalid(
        {
          'id': 'b9',
          'component': 'Button',
          'child': {'@child': 'lbl'},
          'action': {
            '@functionCall': {'@call': 'openUrl'},
            'extra': 1,
          },
        },
        '/action/extra',
      );
      expectInvalid(
        {
          'id': 'b10',
          'component': 'Button',
          'child': {'@child': 'lbl'},
          'action': {'@functionCall': <String, Object?>{}},
        },
        '/action/@functionCall/@call',
      );
      expectInvalid(
        {
          'id': 'b11',
          'component': 'Button',
          'child': {'@child': 'lbl'},
          'action': {
            '@functionCall': {'@call': 'openUrl', 'catalogId': null},
          },
        },
        '/action/@functionCall/catalogId',
      );
      expectInvalid(
        {
          'id': 'b12',
          'component': 'Button',
          'child': {'@child': 'lbl'},
          'action': {
            '@functionCall': {'@call': 'openUrl', 'args': null},
          },
        },
        '/action/@functionCall/args',
      );
      expectInvalid(
        {
          'id': 'b13',
          'component': 'Button',
          'child': {'@child': 'lbl'},
          'action': {
            '@functionCall': {'@call': 'openUrl', 'unknownField': 1},
          },
        },
        '/action/@functionCall/unknownField',
      );
    });

    test('rejects @child/@action/@functionCall inside DynamicValue positions',
        () {
      void expectReservedKey(
        Map<String, Object?> component,
        String expectedPath,
      ) {
        expect(
          () => validator.validateComponent(component),
          throwsA(
            isA<A2uiValidationError>()
                .having((e) => e.code, 'code', 'INVALID_RESERVED_KEY')
                .having((e) => e.path, 'path', expectedPath),
          ),
        );
      }

      for (final directive in ['@child', '@action', '@functionCall']) {
        expectReservedKey(
          {
            'id': 't1',
            'component': 'Text',
            'text': {directive: 'val'},
          },
          '/text/$directive',
        );
        expectReservedKey(
          {
            'id': 'tabs1',
            'component': 'Tabs',
            'tabs': [
              {
                'title': {directive: 'val'},
                'child': {'@child': 'p1'},
              },
            ],
          },
          '/tabs/0/title/$directive',
        );
        expectReservedKey(
          {
            'id': 't2',
            'component': 'Text',
            'text': {
              '@call': 'formatString',
              'args': {
                'value': {directive: 'val'},
              },
            },
          },
          '/text/args/value/$directive',
        );
        expectReservedKey(
          {
            'id': 'b1',
            'component': 'Button',
            'child': {'@child': 'lbl'},
            'action': {
              '@action': {
                'name': 'tap',
                'context': {
                  'x': {directive: 'val'},
                },
              },
            },
          },
          '/action/@action/context/x/$directive',
        );
        expectReservedKey(
          {
            'id': 'b2',
            'component': 'Button',
            'child': {'@child': 'lbl'},
            'action': {
              '@action': {
                'name': 'tap',
                'userMessage': {directive: 'val'},
              },
            },
          },
          '/action/@action/userMessage/$directive',
        );
        expectReservedKey(
          {
            'id': 'b3',
            'component': 'Button',
            'child': {'@child': 'lbl'},
            'action': {
              '@action': {'name': 'tap'},
            },
            '@checks': [
              {
                'condition': {directive: 'val'},
                'message': 'msg',
              },
            ],
          },
          '/@checks/0/condition/$directive',
        );
      }

      // Escaped @@ forms pass DynamicValue validation.
      expect(
        () => validator.validateComponent({
          'id': 'bOk',
          'component': 'Button',
          'child': {'@child': 'lbl'},
          'action': {
            '@action': {
              'name': 'tap',
              'context': {
                'k': {'@@child': 'c', '@@action': 'a', '@@functionCall': 'f'},
              },
            },
          },
        }),
        returnsNormally,
      );
    });

    test('rejects @child, @action, and @functionCall on pre-1.0 surfaces', () {
      final PayloadValidator<ComponentApi, FunctionImplementation>
          v09Validator = PayloadValidator(catalog: BasicCatalog.v0_9());
      final PayloadValidator<ComponentApi, FunctionImplementation>
          openV09Validator = PayloadValidator(
        catalog: BasicCatalog.v0_9(),
        config: const ValidationConfig(allowUnknownElements: true),
      );
      for (final directive in ['@child', '@action', '@functionCall']) {
        expect(
          () => v09Validator.validateComponent({
            'id': 'c1',
            'component': 'Card',
            'child': {directive: 'x'},
          }),
          throwsA(isA<A2uiValidationError>()),
        );
        expect(
          () => openV09Validator.validateComponent({
            'id': 'u1',
            'component': 'UnknownWidget',
            'slot': {directive: 'x'},
          }),
          throwsA(isA<A2uiValidationError>()),
        );
        expect(
          () => v09Validator.validateFunction('formatString', {
            'value': {directive: 'x'},
          }),
          throwsA(isA<A2uiValidationError>()),
        );
      }

      // Root-level undeclared @child/@action/@functionCall on open/unknown
      // pre-1.0 components are rejected too.
      for (final directive in ['@child', '@action', '@functionCall']) {
        expect(
          () => openV09Validator.validateComponent({
            'id': 'uRoot',
            'component': 'UnknownWidget',
            directive: 'x',
          }),
          throwsA(isA<A2uiValidationError>()),
        );
      }
    });

    test(
        'allows pre-1.0 schema-declared @child, @action, and @functionCall '
        'while still rejecting undeclared ones', () {
      final v09Custom = Catalog<ComponentApi, FunctionImplementation>(
        id: 'https://example.com/custom-v09-at-props.json',
        protocolVersion: A2uiProtocolVersion.v0_9,
        components: [
          ComponentApi(
            name: 'TopAtWidget',
            schema: Schema.object(
              properties: {
                '@child': Schema.string(),
                '@action': Schema.object(
                  properties: {'name': Schema.string()},
                ),
                '@functionCall': Schema.object(
                  properties: {'label': Schema.string()},
                ),
                'slot': Schema.object(
                  properties: {
                    '@child': Schema.string(),
                    '@action': Schema.object(
                      properties: {'name': Schema.string()},
                    ),
                    '@functionCall': Schema.object(
                      properties: {'label': Schema.string()},
                    ),
                  },
                ),
                'open': Schema.object(),
              },
            ),
          ),
        ],
      );
      final PayloadValidator<ComponentApi, FunctionImplementation>
          v09CustomValidator = PayloadValidator(catalog: v09Custom);

      expect(
        () => v09CustomValidator.validateComponent({
          'id': 'root',
          'component': 'TopAtWidget',
          '@child': 'literalString',
          '@action': {'name': 'custom'},
          '@functionCall': {'label': 'noop'},
          'slot': {
            '@child': 'nestedLiteral',
            '@action': {'name': 'nested'},
            '@functionCall': {'label': 'nestedNoop'},
          },
        }),
        returnsNormally,
      );

      // Undeclared @child inside open sibling still fails on pre-1.0.
      expect(
        () => v09CustomValidator.validateComponent({
          'id': 'root',
          'component': 'TopAtWidget',
          'open': {'@child': 'unexpected'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test(
        'does not apply Action/Child heuristics to custom v1.0 event objects '
        'or plain string child properties', () {
      final customCatalog = Catalog<ComponentApi, FunctionImplementation>(
        id: 'https://example.com/custom-v1-heuristics.json',
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: [
          ComponentApi(
            name: 'CustomEventContainer',
            schema: Schema.object(
              properties: {
                'payload': Schema.object(
                  properties: {
                    'event': Schema.object(
                      properties: {
                        'name': Schema.string(),
                        'context': Schema.object(),
                      },
                      additionalProperties: true,
                    ),
                  },
                  additionalProperties: true,
                ),
                'open': Schema.object(),
              },
            ),
          ),
          ComponentApi(
            name: 'PlainChildString',
            schema: Schema.object(
              properties: {'child': Schema.string()},
              required: ['child'],
              additionalProperties: false,
            ),
          ),
        ],
      );
      final PayloadValidator<ComponentApi, FunctionImplementation>
          customValidator = PayloadValidator(catalog: customCatalog);

      // Custom `event` object (not an Action schema) allows nested `@child`
      // inside `context` instead of forcing `DynamicValue`.
      expect(
        () => customValidator.validateComponent({
          'id': 'c1',
          'component': 'CustomEventContainer',
          'payload': {
            'event': {
              'name': 'custom',
              'context': {
                'slot': {'@child': 'hdr'},
              },
            },
          },
          'open': {
            'event': {
              'name': 'customOpen',
              'context': {
                'slot': {'@child': 'hdr'},
              },
            },
          },
        }),
        returnsNormally,
      );

      // Plain `{child: {type: string}}` without `$ref` must NOT unwrap
      // `@child`.
      expect(
        () => customValidator.validateComponent({
          'id': 'p1',
          'component': 'PlainChildString',
          'child': {'@child': 'txt1'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });
  });

  group('DataContext directive enforcement and @@ unescaping', () {
    test('rejects @child/@action/@functionCall even alongside @path or @call',
        () {
      final surface = SurfaceModel<ComponentApi>(
        's1',
        defaultCatalog: _makeCustomV1Catalog(),
        protocolVersion: v1JsonVersion,
      );
      addTearDown(surface.dispose);
      surface.dataModel.set('/items', ['one']);
      surface.dataModel.set('/x', 'hello');
      final DataContext ctx =
          ComponentContext(surface, ComponentModel('root', 'OpenShell', {}))
              .dataContext;

      for (final Map<String, Object?> bad in [
        {'@child': 'tpl', '@path': '/items'},
        {'@child': 'c1'},
        {
          '@action': {'name': 'go'},
        },
        {
          '@functionCall': {
            '@call': 'capitalize',
            'args': {'value': 'hi'},
          },
        },
        {
          '@call': 'capitalize',
          'args': {'value': 'hi'},
          '@child': 'tpl',
        },
      ]) {
        expect(ctx.isDataBinding(bad), isFalse);
        expect(
          () => ctx.resolveDynamicValue(bad),
          throwsA(isA<A2uiValidationError>()),
        );
        expect(
          () => ctx.resolveSignal(bad),
          throwsA(isA<A2uiValidationError>()),
        );
      }

      // Escaped @@ keys are unescaped in resolved DynamicValue maps & context.
      expect(
        ctx.resolveDynamicValue({
          '@@child': 'lit',
          '@@action': 'lit2',
          '@@functionCall': {'@path': '/x'},
        }),
        {'@child': 'lit', '@action': 'lit2', '@functionCall': 'hello'},
      );
      expect(
        ctx.resolveAction({
          '@action': {
            'name': 'save',
            'context': {
              '@@child': 'top',
              'nested': {
                '@@action': 'inner',
                '@@functionCall': {'@path': '/x'},
              },
            },
          },
        }),
        {
          '@action': {
            'name': 'save',
            'context': {
              '@child': 'top',
              'nested': {'@action': 'inner', '@functionCall': 'hello'},
            },
          },
        },
      );
    });
  });

  group('Schema-less graph checks and composition constraints', () {
    test('detects dangling refs, cycles, and composition violations on @child',
        () {
      final Catalog<ComponentApi, FunctionImplementation> catalog =
          _makeCustomV1Catalog();

      MessageProcessor<ComponentApi> makeProcessor(
              {bool allowUnknown = false}) =>
          MessageProcessor<ComponentApi>(
            catalogs: [catalog],
            validationConfig:
                ValidationConfig(allowUnknownElements: allowUnknown),
          );

      // Dangling reference inside nested open component slots.
      final MessageProcessor<ComponentApi> p1 = makeProcessor();
      addTearDown(p1.model.dispose);
      expect(
        () => p1.processMessages(
          AgentToRendererMessage.parseAll(
            [
              {
                'version': v1JsonVersion,
                'createSurface': {'surfaceId': 's1', 'catalogId': catalog.id},
              },
              {
                'version': v1JsonVersion,
                'updateComponents': {
                  'surfaceId': 's1',
                  'components': [
                    {
                      'id': 'root',
                      'component': 'OpenShell',
                      'sections': [
                        {
                          'body': {'@child': 'missingChild'},
                        },
                      ],
                    },
                  ],
                },
              },
            ],
            protocolVersion: A2uiProtocolVersion.v1_0,
          ),
        ),
        throwsA(isA<A2uiValidationError>()),
      );

      // Dangling reference on unknown element when allowUnknownElements: true.
      final MessageProcessor<ComponentApi> pUnknown =
          makeProcessor(allowUnknown: true);
      addTearDown(pUnknown.model.dispose);
      expect(
        () => pUnknown.processMessages(
          AgentToRendererMessage.parseAll(
            [
              {
                'version': v1JsonVersion,
                'createSurface': {'surfaceId': 's1', 'catalogId': catalog.id},
              },
              {
                'version': v1JsonVersion,
                'updateComponents': {
                  'surfaceId': 's1',
                  'components': [
                    {
                      'id': 'root',
                      'component': 'UnknownWidget',
                      'header': {'@child': 'missingHeader'},
                    },
                  ],
                },
              },
            ],
            protocolVersion: A2uiProtocolVersion.v1_0,
          ),
        ),
        throwsA(isA<A2uiValidationError>()),
      );

      // Escaped @@child and @action/@functionCall strings are NOT child refs.
      final MessageProcessor<ComponentApi> pEscaped = makeProcessor();
      addTearDown(pEscaped.model.dispose);
      expect(
        () => pEscaped.processMessages(
          AgentToRendererMessage.parseAll(
            [
              {
                'version': v1JsonVersion,
                'createSurface': {'surfaceId': 's1', 'catalogId': catalog.id},
              },
              {
                'version': v1JsonVersion,
                'updateComponents': {
                  'surfaceId': 's1',
                  'components': [
                    {
                      'id': 'root',
                      'component': 'OpenShell',
                      'meta': {'@@child': 'not_a_component_id'},
                      'act': {
                        '@action': {'name': 'not_a_component_id'},
                      },
                    },
                  ],
                },
              },
            ],
            protocolVersion: A2uiProtocolVersion.v1_0,
          ),
        ),
        returnsNormally,
      );

      // UNALLOWED_CHILD reports slot path without trailing /@child, even nested.
      final MessageProcessor<ComponentApi> pComp = makeProcessor();
      addTearDown(pComp.model.dispose);
      expect(
        () => pComp.processMessages(
          AgentToRendererMessage.parseAll(
            [
              {
                'version': v1JsonVersion,
                'createSurface': {'surfaceId': 's1', 'catalogId': catalog.id},
              },
              {
                'version': v1JsonVersion,
                'updateComponents': {
                  'surfaceId': 's1',
                  'components': [
                    {
                      'id': 'root',
                      'component': 'RestrictedParent',
                      'sections': [
                        {
                          'body': {'@child': 'badChild'},
                        },
                      ],
                    },
                    {
                      'id': 'badChild',
                      'component': 'OpenShell',
                    },
                  ],
                },
              },
            ],
            protocolVersion: A2uiProtocolVersion.v1_0,
          ),
        ),
        throwsA(
          isA<A2uiValidationError>()
              .having((e) => e.code, 'code', 'UNALLOWED_CHILD')
              .having((e) => e.path, 'path', '/components/0/sections/0/body'),
        ),
      );

      // UNALLOWED_PARENT enforces allowedParents through nested @child slots.
      final MessageProcessor<ComponentApi> pParent = makeProcessor();
      addTearDown(pParent.model.dispose);
      expect(
        () => pParent.processMessages(
          AgentToRendererMessage.parseAll(
            [
              {
                'version': v1JsonVersion,
                'createSurface': {'surfaceId': 's1', 'catalogId': catalog.id},
              },
              {
                'version': v1JsonVersion,
                'updateComponents': {
                  'surfaceId': 's1',
                  'components': [
                    {
                      'id': 'root',
                      'component': 'OpenShell',
                      'sections': [
                        {
                          'body': {'@child': 'restricted'},
                        },
                      ],
                    },
                    {
                      'id': 'restricted',
                      'component': 'RestrictedChild',
                    },
                  ],
                },
              },
            ],
            protocolVersion: A2uiProtocolVersion.v1_0,
          ),
        ),
        throwsA(
          isA<A2uiValidationError>()
              .having((e) => e.code, 'code', 'UNALLOWED_PARENT')
              .having((e) => e.path, 'path', '/components/1')
              .having(
                (e) => e.message,
                'message',
                allOf(contains('RestrictedChild'), contains('OpenShell')),
              ),
        ),
      );

      // Cycle detection through schema-less @child slot.
      final MessageProcessor<ComponentApi> pCycle = makeProcessor();
      addTearDown(pCycle.model.dispose);
      expect(
        () => pCycle.processMessages(
          AgentToRendererMessage.parseAll(
            [
              {
                'version': v1JsonVersion,
                'createSurface': {'surfaceId': 's1', 'catalogId': catalog.id},
              },
              {
                'version': v1JsonVersion,
                'updateComponents': {
                  'surfaceId': 's1',
                  'components': [
                    {
                      'id': 'root',
                      'component': 'OpenShell',
                      'header': {'@child': 'root'},
                    },
                  ],
                },
              },
            ],
            protocolVersion: A2uiProtocolVersion.v1_0,
          ),
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });
  });

  group('NodeResolver dual-read and schema-less resolution', () {
    test(
        'resolves schema-less @child, @action, @functionCall, @path, @call, '
        'and @@ escapes on open components', () async {
      final openUrl = _TestOpenUrl();
      final Catalog<ComponentApi, FunctionImplementation> catalog =
          _makeCustomV1Catalog(openUrl: openUrl);
      final processor = MessageProcessor<ComponentApi>(catalogs: [catalog]);
      addTearDown(processor.model.dispose);

      processor.processMessages(
        AgentToRendererMessage.parseAll(
          [
            {
              'version': v1JsonVersion,
              'createSurface': {'surfaceId': 's1', 'catalogId': catalog.id},
            },
            {
              'version': v1JsonVersion,
              'updateDataModel': {
                'surfaceId': 's1',
                'path': '/',
                'value': {
                  'title': 'hello',
                  'url': 'https://a2ui.org',
                  'rows': [
                    {'name': 'Alpha'},
                    {'name': 'Beta'},
                  ],
                },
              },
            },
            {
              'version': v1JsonVersion,
              'updateComponents': {
                'surfaceId': 's1',
                'components': [
                  {
                    'id': 'root',
                    'component': 'OpenShell',
                    'title': {'@path': '/title'},
                    'formatted': {
                      '@call': 'capitalize',
                      'args': {
                        'value': {'@path': '/title'},
                      },
                    },
                    'header': {'@child': 'hdr'},
                    'items': {
                      '@child': ['a', 'b'],
                    },
                    'sections': [
                      {
                        'body': {'@child': 'secBody'},
                      },
                    ],
                    'rows': {'@child': 'rowTpl', '@path': '/rows'},
                    'onTap': {
                      '@action': {
                        'name': 'save',
                        'userMessage': {
                          '@call': 'capitalize',
                          'args': {
                            'value': {'@path': '/title'},
                          },
                        },
                        'context': {
                          'title': {'@path': '/title'},
                          '@@child': 'ctxLit',
                        },
                      },
                    },
                    'onLink': {
                      '@functionCall': {
                        '@call': 'openUrl',
                        'args': {
                          'url': {'@path': '/url'},
                        },
                      },
                    },
                    'escaped': {
                      '@@child': 'notAChild',
                      '@@action': {'name': 'notAnAction'},
                      '@@functionCall': {'@@call': 'notRun'},
                      '@@path': '/notBound',
                    },
                    '@@topEscaped': 'escapedVal',
                  },
                  {
                    'id': 'hdr',
                    'component': 'Text',
                    'text': 'Header',
                  },
                  {
                    'id': 'a',
                    'component': 'Text',
                    'text': 'A',
                  },
                  {
                    'id': 'b',
                    'component': 'Text',
                    'text': 'B',
                  },
                  {
                    'id': 'secBody',
                    'component': 'Text',
                    'text': 'Section',
                  },
                  {
                    'id': 'rowTpl',
                    'component': 'Text',
                    'text': {'@path': 'name'},
                  },
                ],
              },
            },
          ],
          protocolVersion: A2uiProtocolVersion.v1_0,
        ),
      );

      final SurfaceModel<ComponentApi> surface =
          processor.model.getSurface('s1')!;
      final NodeResolver<ComponentApi> resolver = NodeResolver(surface);
      addTearDown(resolver.dispose);

      final actions = <A2uiRendererAction>[];
      final Subscription sub = surface.onAction.subscribe(actions.add);
      addTearDown(sub.unsubscribe);

      final ComponentNode<ComponentApi> root = resolver.rootNode.peek()!;
      final Map<String, Object?> props = root.props.peek();

      // Deferred closures must not fire or run openUrl at bind time.
      expect(openUrl.openedUrls, isEmpty);
      expect(actions, isEmpty);

      // Unschematized @path and @call wrap into WritableBinding/ResolvedBinding.
      final titleBinding = props['title']! as WritableBinding<Object?>;
      expect(titleBinding.value, 'hello');
      final formattedBinding = props['formatted']! as ResolvedBinding<Object?>;
      expect(formattedBinding, isNot(isA<WritableBinding<Object?>>()));
      expect(formattedBinding.value, 'Hello');

      titleBinding.set('world');
      expect(
        (root.props.peek()['formatted']! as ResolvedBinding<Object?>).value,
        'World',
      );

      // Single, list, nested object/array, and template @child materialize.
      final headerNode = props['header']! as ComponentNode<ComponentApi>;
      expect(headerNode.componentId, 'hdr');
      final List<ComponentNode<ComponentApi>> itemNodes =
          (props['items']! as List).cast<ComponentNode<ComponentApi>>();
      expect(itemNodes.map((n) => n.componentId), ['a', 'b']);
      final sections = props['sections']! as List<Object?>;
      final secBody =
          ((sections[0]! as Map)['body']!) as ComponentNode<ComponentApi>;
      expect(secBody.componentId, 'secBody');

      final List<ComponentNode<ComponentApi>> rowNodes =
          (root.props.peek()['rows']! as List)
              .cast<ComponentNode<ComponentApi>>();
      expect(rowNodes.map((n) => n.dataPath), ['/rows/0', '/rows/1']);
      expect(
        (rowNodes[0].props.peek()['text']! as ResolvedBinding<Object?>).value,
        'Alpha',
      );

      // Reactive template update adds a row node.
      surface.dataModel.set('/rows', [
        {'name': 'Alpha'},
        {'name': 'Beta'},
        {'name': 'Gamma'},
      ]);
      final List<ComponentNode<ComponentApi>> updatedRows =
          (root.props.peek()['rows']! as List)
              .cast<ComponentNode<ComponentApi>>();
      expect(updatedRows.map((n) => n.dataPath), [
        '/rows/0',
        '/rows/1',
        '/rows/2',
      ]);

      // Escaped @@ keys unescape without mounting nodes, closures, or bindings.
      expect(props['escaped'], {
        '@child': 'notAChild',
        '@action': {'name': 'notAnAction'},
        '@functionCall': {'@call': 'notRun'},
        '@path': '/notBound',
      });
      expect(props['@topEscaped'], 'escapedVal');

      // Deferred @action and @functionCall execute on invoke.
      final onTap = props['onTap']! as NodeAction;
      await onTap();
      expect(actions, hasLength(1));
      expect(actions.single.name, 'save');
      expect(actions.single.userMessage, 'World');
      expect(actions.single.context, {'title': 'world', '@child': 'ctxLit'});

      final onLink = props['onLink']! as NodeAction;
      await onLink();
      expect(openUrl.openedUrls, ['https://a2ui.org']);
    });

    test('dual-reads @child and legacy shapes on BasicCatalog.v1_0', () async {
      final opened = <String>[];
      final Catalog<ComponentApi, FunctionImplementation> catalog =
          BasicCatalog.v1_0(
        openUrl: (url) => opened.add(url.toString()),
      );
      final processor = MessageProcessor<ComponentApi>(catalogs: [catalog]);
      addTearDown(processor.model.dispose);

      processor.processMessages(
        AgentToRendererMessage.parseAll(
          [
            {
              'version': v1JsonVersion,
              'createSurface': {'surfaceId': 's1', 'catalogId': catalog.id},
            },
            {
              'version': v1JsonVersion,
              'updateComponents': {
                'surfaceId': 's1',
                'components': [
                  {
                    'id': 'root',
                    'component': 'Column',
                    'children': {
                      '@child': ['card1', 'btn1'],
                    },
                  },
                  {
                    'id': 'card1',
                    'component': 'Card',
                    'child': 'lbl1',
                  },
                  {
                    'id': 'lbl1',
                    'component': 'Text',
                    'text': 'Inside Card',
                  },
                  {
                    'id': 'btn1',
                    'component': 'Button',
                    'child': {'@child': 'btnLbl'},
                    'action': {
                      '@action': {'name': 'clicked'},
                    },
                  },
                  {
                    'id': 'btnLbl',
                    'component': 'Text',
                    'text': 'Go',
                  },
                ],
              },
            },
          ],
          protocolVersion: A2uiProtocolVersion.v1_0,
        ),
      );

      final SurfaceModel<ComponentApi> surface =
          processor.model.getSurface('s1')!;
      final NodeResolver<ComponentApi> resolver = NodeResolver(surface);
      addTearDown(resolver.dispose);
      final actions = <A2uiRendererAction>[];
      final Subscription sub = surface.onAction.subscribe(actions.add);
      addTearDown(sub.unsubscribe);

      final ComponentNode<ComponentApi> root = resolver.rootNode.peek()!;
      final List<ComponentNode<ComponentApi>> children =
          (root.props.peek()['children']! as List)
              .cast<ComponentNode<ComponentApi>>();
      expect(children.map((n) => n.componentId), ['card1', 'btn1']);
      expect(
        (children[0].props.peek()['child']! as ComponentNode).componentId,
        'lbl1',
      );
      expect(
        (children[1].props.peek()['child']! as ComponentNode).componentId,
        'btnLbl',
      );

      final action = children[1].props.peek()['action']! as NodeAction;
      await action();
      expect(actions.map((a) => a.name), ['clicked']);
    });

    test(
        'pre-1.0 schema-declared @child, @action, and @functionCall stay '
        'literal at runtime and unversioned graph checks stay pre-1.0',
        () async {
      final v09AtCatalog = Catalog<ComponentApi, FunctionImplementation>(
        id: 'https://example.com/runtime-v09-at-props.json',
        protocolVersion: A2uiProtocolVersion.v0_9,
        components: [
          ComponentApi(
            name: 'PreV1AtHost',
            schema: Schema.object(
              properties: {
                'slot': Schema.object(
                  properties: {'@child': Schema.string()},
                ),
                'customAction': Schema.object(
                  properties: {
                    '@action': Schema.object(
                      properties: {'name': Schema.string()},
                    ),
                    '@functionCall': Schema.object(
                      properties: {'call': Schema.string()},
                    ),
                  },
                ),
                'eventSlot': Schema.object(
                  properties: {
                    'event': Schema.object(
                      properties: {'name': Schema.string()},
                    ),
                  },
                ),
              },
            ),
          ),
        ],
      );
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [v09AtCatalog],
        defaultVersion: A2uiProtocolVersion.v0_9,
      );
      addTearDown(processor.model.dispose);

      processor.processMessages(
        AgentToRendererMessage.parseAll(
          [
            {
              'version': A2uiProtocolVersion.v0_9.jsonValue,
              'createSurface': {
                'surfaceId': 's09',
                'catalogId': v09AtCatalog.id,
              },
            },
            {
              'version': A2uiProtocolVersion.v0_9.jsonValue,
              'updateComponents': {
                'surfaceId': 's09',
                'components': [
                  {
                    'id': 'root',
                    'component': 'PreV1AtHost',
                    'slot': {'@child': 'not_a_component_id'},
                    'customAction': {
                      '@action': {'name': 'shouldNotDispatch'},
                      '@functionCall': {'call': 'shouldNotRun'},
                    },
                  },
                ],
              },
            },
          ],
          protocolVersion: A2uiProtocolVersion.v0_9,
        ),
      );

      final SurfaceModel<ComponentApi> surface =
          processor.model.getSurface('s09')!;
      final NodeResolver<ComponentApi> resolver = NodeResolver(surface);
      addTearDown(resolver.dispose);

      final ComponentNode<ComponentApi> root = resolver.rootNode.peek()!;
      expect(root.props.peek()['slot'], {'@child': 'not_a_component_id'});
      expect(root.props.peek()['customAction'], {
        '@action': {'name': 'shouldNotDispatch'},
        '@functionCall': {'call': 'shouldNotRun'},
      });

      final errors = <A2uiRendererError>[];
      final Subscription errSub = surface.onError.subscribe(errors.add);
      addTearDown(errSub.unsubscribe);
      await surface.dispatchAction({
        '@action': {'name': 'ignoredOnPreV1'},
      }, 'root');
      await Future<void>.delayed(Duration.zero);
      expect(errors.map((e) => e.code), ['INVALID_ACTION']);

      // Unversioned/pre-1.0 SurfaceComponentsModel does not extract @child.
      final unversionedModel = SurfaceComponentsModel();
      addTearDown(unversionedModel.dispose);
      expect(
        () => unversionedModel.validateComponentsUpdate([
          {
            'id': 'root',
            'component': 'RestrictedParent',
            'slot': {'@child': 'missing'},
          },
        ]),
        returnsNormally,
      );
      unversionedModel.addComponent(
        ComponentModel('root', 'RestrictedParent', {
          'slot': {'@child': 'missing'},
        }),
      );
      expect(unversionedModel.getChildIds('root'), isEmpty);
    });
  });
}
