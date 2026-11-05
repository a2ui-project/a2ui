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
}
