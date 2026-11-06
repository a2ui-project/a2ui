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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

/// A function a renderer's catalog implements, which a test never runs.
class _Stub extends FunctionImplementation {
  _Stub(FunctionApi api)
    : super(
        name: api.name,
        argumentSchema: api.argumentSchema,
        returnType: api.returnType,
        allowedCallers: api.declaredAllowedCallers,
        definition: api.definition,
      );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) => throw StateError('A test never runs a function.');
}

/// How [validatePayload] and [RendererState] check a v1.0
/// `callRendererFunction`, without running it, and the `agentOnly`
/// functions a component may not call.
void main() {
  Map<String, Object?> function(String name, String allowedCallers) => {
    'type': 'object',
    'allowedCallers': allowedCallers,
    'returnType': 'string',
    'properties': {
      '@call': {'const': name},
      'args': {
        'type': 'object',
        'properties': {
          'value': {r'$ref': r'common_types.json#/$defs/DynamicString'},
        },
        'additionalProperties': false,
      },
    },
    'required': ['@call'],
  };

  CatalogApi catalog(String id) => Catalog.fromJson({
    'catalogId': id,
    'protocolVersion': '1.0',
    'components': {
      'Label': {
        'type': 'object',
        'properties': {
          'component': {'const': 'Label'},
          'text': {r'$ref': r'common_types.json#/$defs/DynamicString'},
        },
        'required': ['component', 'text'],
      },
      'Trigger': {
        'type': 'object',
        'properties': {
          'component': {'const': 'Trigger'},
          'action': {r'$ref': r'common_types.json#/$defs/Action'},
        },
        'required': ['component', 'action'],
      },
    },
    'functions': {
      'secret': function('secret', 'agentOnly'),
      'shared': function('shared', 'rendererOrAgent'),
      'local': function('local', 'rendererOnly'),
    },
  });

  final CatalogApi arcana = catalog('arcana');
  final CatalogApi other = catalog('other');
  final catalogs = [arcana, other];

  AgentToRendererMessage message(Map<String, Object?> json) =>
      AgentToRendererMessage.fromJson({'version': '1.0', ...json});

  AgentToRendererMessage createSurface(
    String surfaceId, [
    List<Map<String, Object?>>? components,
  ]) => message({
    'createSurface': {
      'surfaceId': surfaceId,
      'catalogId': arcana.id,
      'components': ?components,
    },
  });

  AgentToRendererMessage deleteSurface(String surfaceId) => message({
    'deleteSurface': {'surfaceId': surfaceId},
  });

  AgentToRendererMessage call(
    String name, {
    Map<String, Object?> args = const {},
    String? surfaceId,
  }) => message({
    'callRendererFunction': {
      'surfaceId': ?surfaceId,
      'functionCallId': 'f1',
      'callFunction': {'catalogId': arcana.id, '@call': name, 'args': args},
    },
  });

  Matcher refused(String text) => throwsA(
    isA<A2uiValidationError>().having((e) => e.message, 'message', text),
  );

  const agentOnly =
      "Function 'secret' cannot be called by renderer (allowedCallers is "
      'agentOnly).';

  group('validatePayload, a component', () {
    test('may not bind an agentOnly function', () {
      expect(
        () => validatePayload(catalogs, [
          createSurface('s', [
            {
              'id': 'root',
              'component': 'Label',
              'text': {'@call': 'secret'},
            },
          ]),
        ]),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains(agentOnly),
          ),
        ),
      );
    });

    test('may not run an agentOnly function of another catalog in an '
        'action', () {
      expect(
        () => validatePayload(catalogs, [
          createSurface('s', [
            {
              'id': 'root',
              'component': 'Trigger',
              'action': {
                'functionCall': {'@call': 'secret', 'catalogId': other.id},
              },
            },
          ]),
        ]),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains(agentOnly),
          ),
        ),
      );
    });

    test('may bind a rendererOrAgent function', () {
      validatePayload(catalogs, [
        createSurface('s', [
          {
            'id': 'root',
            'component': 'Label',
            'text': {'@call': 'shared'},
          },
        ]),
      ]);
    });
  });

  group('validatePayload, a callRendererFunction', () {
    test('is accepted for an agentOnly or rendererOrAgent function', () {
      validatePayload(catalogs, [call('secret')]);
      validatePayload(catalogs, [call('shared')]);
    });

    test('is refused for a rendererOnly function', () {
      expect(
        () => validatePayload(catalogs, [call('local')]),
        refused(
          "Function call 'f1' names 'local', which only the renderer may "
          'call (allowedCallers is rendererOnly).',
        ),
      );
    });

    test('is refused for a function the catalog does not declare', () {
      expect(
        () => validatePayload(catalogs, [call('missing')]),
        refused(
          "Function call 'f1' names 'missing', which catalog 'arcana' "
          'does not declare.',
        ),
      );
    });

    test('is refused when an agentOnly function is nested in its '
        'arguments', () {
      expect(
        () => validatePayload(catalogs, [
          call(
            'shared',
            args: {
              'value': {'@call': 'secret'},
            },
          ),
        ]),
        refused(
          "Function call 'secret' in function call 'f1' is a call the "
          "renderer can't make: $agentOnly",
        ),
      );
    });

    test('accepts a rendererOrAgent or rendererOnly function nested in its '
        'arguments', () {
      for (final name in ['shared', 'local']) {
        validatePayload(catalogs, [
          call(
            'secret',
            args: {
              'value': {'@call': name},
            },
          ),
        ]);
      }
    });

    test('assumes a surface the payload never named', () {
      validatePayload(catalogs, [call('secret', surfaceId: 'elsewhere')]);
    });

    test('accepts a surface the payload created earlier', () {
      validatePayload(catalogs, [
        createSurface('s', [
          {'id': 'root', 'component': 'Label', 'text': 'Hi'},
        ]),
        call('secret', surfaceId: 's'),
      ]);
    });

    test('refuses a surface the payload deleted earlier', () {
      expect(
        () => validatePayload(catalogs, [
          deleteSurface('s'),
          call('secret', surfaceId: 's'),
        ]),
        refused("Function call 'f1' names surface 's', which does not exist."),
      );
    });

    test('refuses a surface the payload creates only later', () {
      expect(
        () => validatePayload(catalogs, [
          call('secret', surfaceId: 's'),
          createSurface('s', [
            {'id': 'root', 'component': 'Label', 'text': 'Hi'},
          ]),
        ]),
        refused("Function call 'f1' names surface 's', which does not exist."),
      );
    });
  });

  group('direct JSON parseResponse, a component', () {
    List<ResponsePart> compile(Map<String, Object?> text) =>
        const DirectJsonFormatFactory()
            .createFormat(catalogs)
            .createParser()
            .parseResponse(
              '<a2ui-json>${jsonEncode([
                {
                  'version': '1.0',
                  'createSurface': {
                    'surfaceId': 's',
                    'catalogId': arcana.id,
                    'components': [
                      {'id': 'root', 'component': 'Label', 'text': text},
                    ],
                  },
                },
              ])}</a2ui-json>',
            );

    test('may not bind an agentOnly function of its own catalog or '
        'another', () {
      for (final Map<String, Object?> text in [
        {'@call': 'secret'},
        {'@call': 'secret', 'catalogId': other.id},
      ]) {
        expect(
          () => compile(text),
          throwsA(
            isA<A2uiValidationError>().having(
              (e) => e.message,
              'message',
              contains(agentOnly),
            ),
          ),
          reason: '$text',
        );
      }
    });

    test('may bind a rendererOrAgent function of another catalog', () {
      compile({'@call': 'shared', 'catalogId': other.id});
    });
  });

  group('RendererState, a callRendererFunction', () {
    test('requires the surface it names to exist', () {
      final state = RendererState(catalogs);
      addTearDown(state.dispose);
      expect(
        () => state.apply([call('secret', surfaceId: 'elsewhere')]),
        refused(
          "Function call 'f1' names surface 'elsewhere', which does not "
          'exist.',
        ),
      );
    });
  });

  group('a call nested in the arguments of a callRendererFunction', () {
    // `greeter` declares `greet`, which `arcana` does not, and `tap`, which
    // requires a user activation; `echo` takes any object.
    final CatalogApi greeter = Catalog.fromJson({
      'catalogId': 'greeter',
      'protocolVersion': '1.0',
      'components': {
        'Label': {
          'type': 'object',
          'properties': {
            'component': {'const': 'Label'},
            'text': {r'$ref': r'common_types.json#/$defs/DynamicString'},
          },
          'required': ['component', 'text'],
        },
      },
      'functions': {
        'greet': function('greet', 'rendererOrAgent'),
        'tap': {
          ...function('tap', 'rendererOnly'),
          'requiresUserActivation': true,
        },
        'echo': {
          'type': 'object',
          'allowedCallers': 'rendererOrAgent',
          'returnType': 'any',
          'properties': {
            '@call': {'const': 'echo'},
            'args': {'type': 'object'},
          },
          'required': ['@call'],
        },
      },
    });
    final all = [arcana, greeter];

    AgentToRendererMessage surface(String surfaceId, {String? catalogId}) =>
        message({
          'createSurface': {'surfaceId': surfaceId, 'catalogId': ?catalogId},
        });

    AgentToRendererMessage callWith(
      Object? value, {
      String? surfaceId,
      String catalogId = 'arcana',
      String name = 'shared',
    }) => message({
      'callRendererFunction': {
        'surfaceId': ?surfaceId,
        'functionCallId': 'f1',
        'callFunction': {
          'catalogId': catalogId,
          '@call': name,
          'args': {'value': value},
        },
      },
    });

    const greet = {'@call': 'greet'};

    test("runs in the surface's default catalog when it names none", () {
      validatePayload(all, [
        surface('s', catalogId: greeter.id),
        callWith(greet, surfaceId: 's'),
      ]);
    });

    test("runs in the call's catalog when the message names no surface", () {
      expect(
        () => validatePayload(all, [callWith(greet)]),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains("Unrecognized function 'greet'"),
          ),
        ),
      );
    });

    test('is refused on a surface whose default catalog lacks it', () {
      expect(
        () => validatePayload(all, [
          surface('s', catalogId: arcana.id),
          callWith(greet, surfaceId: 's', catalogId: greeter.id, name: 'echo'),
        ]),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains("Unrecognized function 'greet'"),
          ),
        ),
      );
    });

    test('is refused on a surface with no default catalog', () {
      expect(
        () => validatePayload(all, [
          surface('s'),
          callWith(greet, surfaceId: 's'),
        ]),
        refused(
          "Function call 'greet' in function call 'f1' names no catalogId, "
          "and surface 's' has no default catalog.",
        ),
      );
    });

    test('may name its catalog on a surface with no default catalog', () {
      validatePayload(all, [
        surface('s'),
        callWith({'@call': 'greet', 'catalogId': greeter.id}, surfaceId: 's'),
      ]);
    });

    test('passes on an assumed surface if some catalog declares it', () {
      validatePayload(all, [callWith(greet, surfaceId: 'elsewhere')]);
    });

    test("passes on a surface the payload assumes, whose placeholder's "
        'catalog is a guess', () {
      validatePayload(all, [
        message({
          'updateComponents': {
            'surfaceId': 'p',
            'components': [
              {'id': 'root', 'component': 'Label', 'text': 'Hi'},
            ],
          },
        }),
        callWith(greet, surfaceId: 'p'),
      ]);
    });

    test('is refused on an assumed surface if no catalog declares it', () {
      expect(
        () => validatePayload(all, [
          callWith({'@call': 'missing'}, surfaceId: 'elsewhere'),
        ]),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains("Unrecognized function 'missing'"),
          ),
        ),
      );
    });

    test('is refused on an assumed surface if every declaring catalog '
        'refuses it', () {
      expect(
        () => validatePayload(all, [
          callWith({'@call': 'secret'}, surfaceId: 'elsewhere'),
        ]),
        refused(
          "Function call 'secret' in function call 'f1' is a call the "
          "renderer can't make: $agentOnly",
        ),
      );
    });

    test('runs in the default catalog of a surface an earlier payload '
        'created', () {
      final state = RendererState(all);
      addTearDown(state.dispose);
      state.apply([surface('s', catalogId: greeter.id)]);
      state.apply([callWith(greet, surfaceId: 's')]);
      expect(
        () => state.apply([callWith(greet)]),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test("runs in the default catalog of a renderer's surface", () {
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [
          for (final CatalogApi c in all)
            c.withFunctions([
              for (final FunctionApi f in c.functions.values) _Stub(f),
            ]),
        ],
        validationConfig: ValidationConfig.strict,
      );
      addTearDown(processor.model.dispose);
      processor.processMessages([
        {
          'version': '1.0',
          'createSurface': {'surfaceId': 's', 'catalogId': greeter.id},
        },
      ]);
      final state = RendererState.of(processor);
      // Rolled back, so that the renderer never runs the call.
      expect(
        () => state.transaction(() {
          state.apply([callWith(greet, surfaceId: 's')]);
          throw StateError('rolled back');
        }),
        throwsStateError,
      );
      expect(
        () => state.apply([callWith(greet)]),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('may not require a user activation', () {
      expect(
        () => validatePayload(all, [
          surface('s', catalogId: greeter.id),
          callWith({'@call': 'tap'}, surfaceId: 's'),
        ]),
        refused(
          "Function call 'tap' in function call 'f1' is a call the "
          "renderer can't make: Function 'tap' requires a user activation, "
          'and a call from the agent has none.',
        ),
      );
    });

    test('may not hold a null catalogId or null args', () {
      expect(
        () => validatePayload(all, [
          callWith(
            {'@call': 'greet', 'catalogId': null},
            catalogId: greeter.id,
            name: 'echo',
          ),
        ]),
        refused(
          "Function call 'greet' in function call 'f1' has a null "
          "'catalogId', and 'catalogId' must be a string.",
        ),
      );
      expect(
        () => validatePayload(all, [
          callWith(
            {'@call': 'greet', 'args': null},
            catalogId: greeter.id,
            name: 'echo',
          ),
        ]),
        refused(
          "Function call 'greet' in function call 'f1' has null 'args', "
          "and 'args' must be an object.",
        ),
      );
    });

    test('may not hold a field FunctionCall lacks', () {
      expect(
        () => validatePayload(all, [
          callWith(
            {'@call': 'greet', 'bogus': 1},
            catalogId: greeter.id,
            name: 'echo',
          ),
        ]),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains("has no field 'bogus'"),
          ),
        ),
      );
    });

    test('is found in an object with an unknown reserved directive', () {
      expect(
        () => validatePayload(all, [
          callWith({'@bogus': 1}, catalogId: greeter.id, name: 'echo'),
        ]),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains("Unrecognized reserved protocol directive '@bogus'"),
          ),
        ),
      );
    });

    test('is found under a non-string @call', () {
      expect(
        () => validatePayload(all, [
          callWith(
            {
              '@call': {
                'x': {'@call': 'secret'},
              },
            },
            catalogId: greeter.id,
            name: 'echo',
          ),
        ]),
        throwsA(isA<A2uiValidationError>()),
      );
    });
  });
}
