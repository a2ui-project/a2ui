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

import 'conformance/conformance_harness.dart';
import 'support/renderer_catalog.dart';

/// How a v1.0 [PayloadValidator] checks function calls nested in a component,
/// depending on whether the component names a `catalogId`, and how
/// [MessageProcessor] checks the calls the validator leaves unjudged.
void main() {
  final Map<String, Object?> basicDocument = readConformanceJson(
    'catalogs/basic/v1/catalog.json',
  );
  final Map<String, Object?> commonTypes = readConformanceJson(
    'specification/v1_0/json/common_types.json',
  );
  final CatalogApi basic = Catalog.fromJson(basicDocument);

  PayloadValidator<ComponentApi, FunctionApi> validator() =>
      PayloadValidator<ComponentApi, FunctionApi>(
        catalog: basic,
        protocolVersion: A2uiProtocolVersion.v1_0,
        commonTypesSchema: commonTypes,
      );

  Map<String, Object?> textCalling(Map<String, Object?> call) => {
        'id': 't',
        'component': 'Text',
        'text': call,
      };

  final Matcher rejected = throwsA(isA<A2uiValidationError>());

  group(
    'PayloadValidator v1.0 nested calls, component naming no catalogId',
    () {
      test('accepts a call to a function of this catalog', () {
        expect(
          () => validator().validateComponent(
            textCalling({
              '@call': 'formatString',
              'args': {'value': 'hi'},
            }),
          ),
          returnsNormally,
        );
      });

      test('rejects a call object with no @call', () {
        for (final Map<String, Object?> call in [
          {'catalogId': 'https://example.com/other_catalog.json'},
          {'args': <String, Object?>{}},
        ]) {
          expect(
            () => validator().validateComponent(textCalling(call)),
            rejected,
            reason: '$call',
          );
        }
      });

      test('accepts a call naming this catalog explicitly', () {
        expect(
          () => validator().validateComponent(
            textCalling({
              '@call': 'formatString',
              'catalogId': basic.id,
              'args': {'value': 'hi'},
            }),
          ),
          returnsNormally,
        );
      });

      test('rejects an unknown function that names no catalogId', () {
        expect(
          () => validator().validateComponent(
            textCalling({'@call': 'notAFunction', 'args': <String, Object?>{}}),
          ),
          rejected,
        );
      });

      test('rejects an unknown function naming this catalog', () {
        expect(
          () => validator().validateComponent(
            textCalling({
              '@call': 'notAFunction',
              'catalogId': basic.id,
              'args': <String, Object?>{},
            }),
          ),
          rejected,
        );
      });

      test('rejects arguments that do not match the function', () {
        expect(
          () => validator().validateComponent(
            textCalling({
              '@call': 'formatString',
              'args': {'value': 'hi', 'extra': 1},
            }),
          ),
          rejected,
        );
        expect(
          () => validator().validateComponent(
            textCalling({'@call': 'formatString', 'args': <String, Object?>{}}),
          ),
          rejected,
        );
      });

      test('rejects an unknown function nested in arguments', () {
        expect(
          () => validator().validateComponent(
            textCalling({
              '@call': 'formatString',
              'args': {
                'value': {'@call': 'notAFunction', 'args': <String, Object?>{}},
              },
            }),
          ),
          rejected,
        );
        expect(
          () => validator().validateFunction('formatString', {
            'value': {'@call': 'notAFunction', 'args': <String, Object?>{}},
          }),
          rejected,
        );
      });

      test("rejects an unknown function nested in @index's arguments", () {
        expect(
          () => validator().validateComponent(
            textCalling({
              '@call': '@index',
              'args': {
                'offset': {
                  '@call': 'notAFunction',
                  'args': <String, Object?>{},
                },
              },
            }),
          ),
          rejected,
        );
      });

      test('accepts any call naming another catalog', () {
        expect(
          () => validator().validateComponent(
            textCalling({
              '@call': 'notAFunction',
              'catalogId': 'other-catalog',
              'args': {'anything': 1},
            }),
          ),
          returnsNormally,
        );
      });

      test('still checks the names of a call naming another catalog', () {
        expect(
          () => validator().validateComponent(
            textCalling({
              '@call': 'not-a-function',
              'catalogId': 'other-catalog',
            }),
          ),
          rejected,
        );
        expect(
          () => validator().validateComponent(
            textCalling({'@call': '@foo', 'catalogId': 'other-catalog'}),
          ),
          rejected,
        );
      });

      test(
        'checks a call naming no catalogId nested in the arguments of a call '
        'naming another catalog',
        () {
          expect(
            () => validator().validateComponent(
              textCalling({
                '@call': 'shout',
                'catalogId': 'other-catalog',
                'args': {
                  'value': {
                    '@call': 'notAFunction',
                    'args': <String, Object?>{},
                  },
                },
              }),
            ),
            throwsA(
              isA<A2uiValidationError>().having(
                (e) => e.message,
                'message',
                contains("declares no function named 'notAFunction'"),
              ),
            ),
          );
          expect(
            () => validator().validateComponent(
              textCalling({
                '@call': 'shout',
                'catalogId': 'other-catalog',
                'args': {
                  'value': {
                    '@call': 'formatString',
                    'args': {'value': 'hi'},
                  },
                },
              }),
            ),
            returnsNormally,
          );
        },
      );

      test('names the failing function and argument', () {
        expect(
          () => validator().validateComponent(
            textCalling({'@call': 'notAFunction', 'args': <String, Object?>{}}),
          ),
          throwsA(
            isA<A2uiValidationError>().having(
              (e) => e.message,
              'message',
              allOf(
                contains("component 't'"),
                contains("declares no function named 'notAFunction'"),
              ),
            ),
          ),
        );
        expect(
          () => validator().validateComponent(
            textCalling({
              '@call': 'formatString',
              'args': {'value': 3},
            }),
          ),
          throwsA(
            isA<A2uiValidationError>().having(
              (e) => e.message,
              'message',
              allOf(contains("Call to 'formatString'"), contains('value')),
            ),
          ),
        );
      });

      test('reads an empty catalogId as naming another catalog', () {
        // An empty string is a catalog name like any other; no catalog has
        // it, so the message processor rejects the call. This catalog cannot
        // judge it, so it checks only the names.
        expect(
          () => validator().validateComponent(
            textCalling({'@call': 'notAFunction', 'catalogId': ''}),
          ),
          returnsNormally,
        );
      });

      test(
        'fails validation, rather than crashing, on untyped map literals',
        () {
          expect(
            () => validator().validateComponent(<String, Object?>{
              'id': 't',
              'component': 'Text',
              'text': <dynamic, dynamic>{
                '@call': 'formatString',
                'args': <dynamic, dynamic>{},
              },
            }),
            rejected,
          );
          expect(
            () => validator().validateComponent(<String, Object?>{
              'id': 't',
              'component': 'Text',
              'text': <dynamic, dynamic>{
                '@call': 'formatString',
                'args': <dynamic, dynamic>{'value': 'hi'},
              },
            }),
            returnsNormally,
          );
        },
      );

      test('accepts a call omitting args when every argument is optional', () {
        final optional = Catalog<ComponentApi, FunctionApi>(
          id: 'optional',
          components: [ComponentApi(name: 'Box', schema: Schema.object())],
          functions: [
            FunctionApi(
              name: 'now',
              argumentSchema: Schema.object(
                properties: {'tz': Schema.string()},
              ),
              returnType: A2uiReturnType.string,
            ),
          ],
        );
        final v = PayloadValidator<ComponentApi, FunctionApi>(
          catalog: optional,
          protocolVersion: A2uiProtocolVersion.v1_0,
          commonTypesSchema: commonTypes,
        );
        expect(
          () => v.validateComponent({
            'id': 'b',
            'component': 'Box',
            'v': {'@call': 'now'},
          }),
          returnsNormally,
        );
        expect(
          () => v.validateComponent({
            'id': 'b',
            'component': 'Box',
            'v': {
              '@call': 'now',
              'args': {'tz': 3},
            },
          }),
          rejected,
        );
      });
    },
  );

  group('PayloadValidator v1.0 component envelope keys', () {
    PayloadValidator<ComponentApi, FunctionApi> closed(
      Map<String, Object?> properties, {
      List<String> required = const [],
    }) =>
        PayloadValidator<ComponentApi, FunctionApi>(
          catalog: Catalog<ComponentApi, FunctionApi>(
            id: 'closed',
            components: [
              ComponentApi(
                name: 'Tag',
                schema: Schema.fromMap({
                  'type': 'object',
                  'properties': properties,
                  'required': required,
                  'additionalProperties': false,
                }),
              ),
            ],
            functions: const [],
          ),
          protocolVersion: A2uiProtocolVersion.v1_0,
          commonTypesSchema: commonTypes,
        );

    final Map<String, PayloadValidator<ComponentApi, FunctionApi>> validators =
        {
      'declaring no envelope key': closed({
        'label': {'type': 'string'},
      }),
      // Each envelope key is judged on its own: declaring `component` does
      // not keep `id`, `catalogId` or `metadata` in the schema's view.
      'declaring only component': closed(
        {
          'component': {'const': 'Tag'},
          'label': {'type': 'string'},
        },
        required: ['component'],
      ),
    };

    validators.forEach((description, v) {
      group('a closed schema $description', () {
        test('accepts catalogId and metadata', () {
          expect(
            () => v.validateComponent({
              'id': 'r',
              'component': 'Tag',
              'catalogId': 'closed',
              'metadata': <String, Object?>{},
              'label': 'Hello',
            }),
            returnsNormally,
          );
        });

        test('rejects a non-string catalogId', () {
          expect(
            () => v.validateComponent({
              'id': 'r',
              'component': 'Tag',
              'catalogId': 5,
            }),
            throwsA(
              isA<A2uiValidationError>().having(
                (e) => e.message,
                'message',
                contains("non-string 'catalogId'"),
              ),
            ),
          );
        });

        test('still rejects a property it does not declare', () {
          expect(
            () => v.validateComponent({
              'id': 'r',
              'component': 'Tag',
              'extra': 1,
            }),
            rejected,
          );
        });
      });
    });

    test('lets a schema that declares catalogId check it', () {
      final PayloadValidator<ComponentApi, FunctionApi> v = closed({
        'catalogId': {'const': 'closed'},
      });
      expect(
        () => v.validateComponent({
          'id': 'r',
          'component': 'Tag',
          'catalogId': 'other',
        }),
        rejected,
      );
    });
  });

  group('PayloadValidator v1.0 empty call names', () {
    final Matcher notIdentifier = throwsA(
      isA<A2uiValidationError>().having(
        (e) => e.message,
        'message',
        contains('valid UAX #31 identifier'),
      ),
    );

    test('rejects an empty @call name in a component', () {
      for (final Map<String, Object?> call in [
        {'@call': ''},
        {'@call': '', 'catalogId': 'other-catalog'},
        {
          '@call': 'formatString',
          'args': {
            'value': {'@call': ''},
          },
        },
      ]) {
        expect(
          () => validator().validateComponent(textCalling(call)),
          notIdentifier,
          reason: '$call',
        );
      }
    });

    test('rejects an empty function name in validateFunction', () {
      expect(() => validator().validateFunction('', {}), notIdentifier);
    });
  });

  group('PayloadValidator v1.0 call envelopes', () {
    // Box's schema constrains nothing, so only the envelope checks in code
    // can catch these.
    final permissive = PayloadValidator<ComponentApi, FunctionApi>(
      catalog: Catalog<ComponentApi, FunctionImplementation>(
        id: 'box',
        components: [ComponentApi(name: 'Box', schema: Schema.object())],
        functions: [_ShoutFunction()],
      ),
      protocolVersion: A2uiProtocolVersion.v1_0,
      commonTypesSchema: commonTypes,
    );
    Map<String, Object?> boxCalling(Map<String, Object?> call) => {
          'id': 'b',
          'component': 'Box',
          'value': call,
        };
    Matcher rejectedWith(String message) => throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains(message),
          ),
        );

    test('rejects @index naming a catalogId', () {
      expect(
        () => permissive.validateComponent(
          boxCalling({'@call': '@index', 'catalogId': 'box'}),
        ),
        rejectedWith('belongs to no catalog'),
      );
    });

    test('rejects @index arguments other than offset', () {
      expect(
        () => permissive.validateComponent(
          boxCalling({
            '@call': '@index',
            'args': {'step': 2},
          }),
        ),
        rejectedWith("takes only 'offset'"),
      );
      expect(
        () => permissive.validateComponent(
          boxCalling({
            '@call': '@index',
            'args': {'offset': 1},
          }),
        ),
        returnsNormally,
      );
    });

    test('rejects non-object args whatever catalog the call runs in', () {
      for (final Map<String, Object?> call in [
        {'@call': 'shout', 'args': 123},
        {'@call': 'fn', 'catalogId': 'other', 'args': 123},
        {
          '@call': 'fn',
          'catalogId': 'other',
          'args': ['x'],
        },
        {'@call': '@index', 'args': 123},
      ]) {
        expect(
          () => permissive.validateComponent(boxCalling(call)),
          rejectedWith("non-object 'args'"),
          reason: '$call',
        );
      }
    });

    test('checks the envelope in validateFunction args', () {
      expect(
        () => permissive.validateFunction('shout', {
          'value': {'@call': '@index', 'catalogId': 'box'},
        }),
        rejectedWith('belongs to no catalog'),
      );
    });

    test('reports the @index rule before the component schema', () {
      // Text.text's schema admits only well-formed calls, so a schema check
      // would fail with a generic mismatch; the envelope check names the
      // rule instead.
      expect(
        () => validator().validateComponent(
          textCalling({'@call': '@index', 'catalogId': basic.id}),
        ),
        rejectedWith('belongs to no catalog'),
      );
      expect(
        () => validator().validateComponent(
          textCalling({
            '@call': '@index',
            'args': {'step': 2},
          }),
        ),
        rejectedWith("takes only 'offset'"),
      );
    });
  });

  group('PayloadValidator v1.0 validateFunction', () {
    test('checks the names of calls in its arguments', () {
      final Matcher namesRejected = throwsA(
        isA<A2uiValidationError>().having(
          (e) => e.message,
          'message',
          anyOf(contains('UAX #31'), contains('unknown system function')),
        ),
      );
      for (final Map<String, Object?> nested in [
        {'@call': 'bad-name', 'catalogId': 'o'},
        {'@call': '@foo', 'catalogId': 'o'},
        {
          '@call': 'fn',
          'catalogId': 'o',
          'args': {'bad-arg': 1},
        },
      ]) {
        expect(
          () => validator().validateFunction('formatString', {'value': nested}),
          namesRejected,
          reason: '$nested',
        );
      }
      expect(
        () => validator().validateFunction('formatString', {
          'value': 'hi',
          'bad-arg': 'x',
        }),
        namesRejected,
      );
    });

    test('judges calls in its arguments as in a component naming none', () {
      expect(
        () => validator().validateFunction('formatString', {
          'value': {
            '@call': 'formatString',
            'args': {'value': 'hi'},
          },
        }),
        returnsNormally,
      );
      expect(
        () => validator().validateFunction('formatString', {
          'value': {'@call': 'notAFunction', 'catalogId': 'other-catalog'},
        }),
        returnsNormally,
      );
    });
  });

  group('PayloadValidator v1.0 nested calls, component naming a catalogId', () {
    // A call that names no catalogId runs in the surface default, which a
    // component naming a catalogId need not belong to, so only the call's
    // names are checked.
    Map<String, Object?> textIn(Object? catalogId, Map<String, Object?> call) =>
        {...textCalling(call), 'catalogId': catalogId};

    test('accepts an unknown function that names no catalogId', () {
      expect(
        () => validator().validateComponent(
          textIn(basic.id, {
            '@call': 'notAFunction',
            'args': {'x': 1},
          }),
        ),
        returnsNormally,
      );
      expect(
        () => validator().validateComponent(
          textIn(basic.id, {
            '@call': 'formatString',
            'args': {'value': 3},
          }),
        ),
        returnsNormally,
      );
    });

    test('reads an empty component catalogId as naming a catalog', () {
      expect(
        () => validator().validateComponent(
          textIn('', {'@call': 'notAFunction'}),
        ),
        returnsNormally,
      );
    });

    test('leaves catalogless calls nested in arguments unjudged', () {
      expect(
        () => validator().validateComponent(
          textIn(basic.id, {
            '@call': 'shout',
            'catalogId': 'other-catalog',
            'args': {
              'value': {'@call': 'notAFunction', 'args': <String, Object?>{}},
            },
          }),
        ),
        returnsNormally,
      );
    });

    test("still checks a call naming this validator's catalog", () {
      expect(
        () => validator().validateComponent(
          textIn(basic.id, {'@call': 'notAFunction', 'catalogId': basic.id}),
        ),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            allOf(
              contains("component 't'"),
              contains("declares no function named 'notAFunction'"),
            ),
          ),
        ),
      );
      expect(
        () => validator().validateComponent(
          textIn('other-catalog', {
            '@call': 'formatString',
            'catalogId': basic.id,
            'args': {'value': 3},
          }),
        ),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            allOf(contains("Call to 'formatString'"), contains('value')),
          ),
        ),
      );
    });

    test('rejects a non-string catalogId on a call', () {
      expect(
        () => validator().validateComponent(
          textIn(basic.id, {'@call': 'formatString', 'catalogId': 3}),
        ),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains("non-string 'catalogId'"),
          ),
        ),
      );
    });

    test('still checks system functions', () {
      expect(
        () =>
            validator().validateComponent(textIn(basic.id, {'@call': '@foo'})),
        rejected,
      );
      expect(
        () => validator().validateComponent(
          textIn(basic.id, {'@call': '@index', 'catalogId': basic.id}),
        ),
        rejected,
      );
    });

    test('rejects names that are not identifiers', () {
      expect(
        () => validator().validateComponent(
          textIn(basic.id, {'@call': 'not-a-function'}),
        ),
        rejected,
      );
      expect(
        () => validator().validateComponent(
          textIn(basic.id, {
            '@call': 'formatString',
            'args': {'bad-arg': 'x'},
          }),
        ),
        rejected,
      );
      expect(
        () => validator().validateComponent(
          textIn(basic.id, {
            '@call': '@index',
            'args': {
              'offset': {
                '@call': 'f',
                'args': {'bad-arg': 1},
              },
            },
          }),
        ),
        rejected,
      );
    });
  });

  group('MessageProcessor v1.0 nested calls', () {
    late MessageProcessor<ComponentApi> processor;

    setUp(() {
      processor = MessageProcessor<ComponentApi>(
        catalogs: [
          rendererCatalog(basicDocument),
          Catalog<ComponentApi, FunctionImplementation>(
            id: 'extra',
            protocolVersion: A2uiProtocolVersion.v1_0,
            components: [
              ComponentApi(name: 'Box', schema: Schema.object()),
              ComponentApi(name: 'Text', schema: Schema.object()),
            ],
            functions: [_ShoutFunction()],
          ),
        ],
        defaultVersion: A2uiProtocolVersion.v1_0,
        commonTypesSchema: commonTypes,
        validationConfig: ValidationConfig.relaxed,
      );
    });
    tearDown(() => processor.groupModel.dispose());

    void process(String defaultCatalog, Map<String, Object?> component) =>
        processor.processMessages(
          AgentToRendererMessagePayload([
            CreateSurfaceMessage(
              version: 'v1.0',
              surfaceId: 's',
              catalogId: defaultCatalog,
            ),
            UpdateComponentsMessage(
              version: 'v1.0',
              surfaceId: 's',
              components: [component],
            ),
          ]),
        );

    test(
        "checks a call against the surface default, not the component's "
        'catalog', () {
      // The Text belongs to the basic catalog, but its call names no
      // catalogId, so it runs in the surface default, `extra`.
      expect(
        () => process('extra', {
          'id': 'root',
          'component': 'Text',
          'catalogId': basic.id,
          'text': {
            '@call': 'shout',
            'args': {'value': 'hi'},
          },
        }),
        returnsNormally,
      );
    });

    test(
        'accepts a catalogless call to a function only the surface default '
        'declares, in a component of another catalog', () {
      // `formatString` is a basic function, which `extra` lacks.
      expect(
        () => process(basic.id, {
          'id': 'root',
          'component': 'Text',
          'catalogId': 'extra',
          'text': {
            '@call': 'formatString',
            'args': {'value': 'hi'},
          },
        }),
        returnsNormally,
      );
    });

    test(
        'checks a catalogless call in a component of another catalog against '
        'the surface default', () {
      expect(
        () => process(basic.id, {
          'id': 'root',
          'component': 'Text',
          'catalogId': 'extra',
          'text': {
            '@call': 'shout',
            'args': {'value': 'hi'},
          },
        }),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            allOf(
              contains("component 'root'"),
              contains(
                "Catalog '${basic.id}' declares no function named "
                "'shout'",
              ),
            ),
          ),
        ),
      );
    });

    // ValidationConfig.relaxed allows unknown component types, but the calls
    // in their properties still run, so they are checked.
    Map<String, Object?> widgetCalling(Map<String, Object?> call) => {
          'id': 'root',
          'component': 'Widget',
          'text': call,
        };

    test('accepts a valid call in a component type its catalog lacks', () {
      expect(
        () => process(
          basic.id,
          widgetCalling({
            '@call': 'formatString',
            'args': {'value': 'hi'},
          }),
        ),
        returnsNormally,
      );
    });

    for (final Map<String, Object?> call in [
      {'@call': 'formatString', 'args': <String, Object?>{}},
      {'@call': '@index', 'catalogId': 'https://a2ui.org/x'},
    ]) {
      test('checks $call in a component type its catalog lacks', () {
        expect(() => process(basic.id, widgetCalling(call)), rejected);
      });
    }

    test('rejects an unknown function in the catalog the call resolves to', () {
      expect(
        () => process(basic.id, {
          'id': 'root',
          'component': 'Text',
          'text': {'@call': 'notAFunction', 'args': <String, Object?>{}},
        }),
        rejected,
      );
    });

    test(
        'checks catalogless calls once in a component naming the surface '
        'default', () {
      // A component that names the surface default catalog is in the
      // catalog its catalogless calls run in, so component validation
      // checks them, and the processor's pass doesn't report them again.
      expect(
        () => process(basic.id, {
          'id': 'root',
          'component': 'Text',
          'catalogId': basic.id,
          'text': {'@call': 'noSuchFn'},
        }),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => "declares no function named 'noSuchFn'"
                .allMatches(e.message)
                .length,
            'reports of noSuchFn',
            1,
          ),
        ),
      );
    });

    test('rejects a component with a non-string catalogId', () {
      expect(
        () => process(basic.id, {
          'id': 'root',
          'component': 'Text',
          'catalogId': 3,
          'text': 'hi',
        }),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains("non-string 'catalogId'"),
          ),
        ),
      );
    });

    test('reads an empty catalogId as a catalog the surface lacks', () {
      expect(
        () => process(basic.id, {
          'id': 'root',
          'component': 'Text',
          'text': {
            '@call': 'formatString',
            'catalogId': '',
            'args': {'value': 'hi'},
          },
        }),
        throwsA(
          isA<A2uiCatalogError>().having(
            (e) => e.message,
            'message',
            contains('Catalog not found'),
          ),
        ),
      );
    });

    test('rejects @index naming a catalogId even where no schema does', () {
      // Box's schema constrains nothing, so only the code check catches it.
      expect(
        () => process('extra', {
          'id': 'root',
          'component': 'Box',
          'value': {'@call': '@index', 'catalogId': 'extra'},
        }),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains('belongs to no catalog'),
          ),
        ),
      );
    });

    test('rejects an empty @call name even with relaxed validation', () {
      expect(
        () => process(basic.id, {
          'id': 'root',
          'component': 'Text',
          'text': {'@call': '', 'catalogId': 'extra'},
        }),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains('valid UAX #31 identifier'),
          ),
        ),
      );
    });

    group('updates', () {
      void update(List<Map<String, Object?>> components) =>
          processor.processMessages(
            AgentToRendererMessagePayload([
              UpdateComponentsMessage(
                version: 'v1.0',
                surfaceId: 's',
                components: components,
              ),
            ]),
          );

      setUp(
        () => process(basic.id, {
          'id': 'root',
          'component': 'Text',
          'text': 'hi',
        }),
      );

      ComponentModel? root() =>
          processor.groupModel.getSurface('s')!.componentsModel.get('root');

      test('rejects an update that names no component type', () {
        final ComponentModel? before = root();
        expect(
          () => update([
            {'id': 'root', 'text': 'bye'},
          ]),
          throwsA(
            isA<A2uiValidationError>().having(
              (e) => e.message,
              'message',
              contains("names no 'component' type"),
            ),
          ),
        );
        expect(root(), same(before));
        expect(root()!.properties['text'], 'hi');
      });

      test('recreates the model when an update changes its catalog', () {
        final ComponentModel? before = root();
        update([
          {'id': 'root', 'component': 'Text', 'catalogId': 'extra'},
        ]);
        expect(root(), isNot(same(before)));
        expect(root()!.catalog, 'extra');
      });

      test('updates the model in place when the catalog is unchanged', () {
        final ComponentModel? before = root();
        update([
          {
            'id': 'root',
            'component': 'Text',
            'catalogId': basic.id,
            'text': 'x',
          },
        ]);
        expect(root(), same(before));
        expect(root()!.properties['text'], 'x');
      });
    });
  });
}

/// Returns its `value` argument.
class _ShoutFunction extends FunctionImplementation {
  _ShoutFunction()
      : super(
          name: 'shout',
          argumentSchema: Schema.object(
            properties: {'value': Schema.string()},
            required: ['value'],
          ),
          returnType: A2uiReturnType.string,
        );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) =>
      args['value'];
}
