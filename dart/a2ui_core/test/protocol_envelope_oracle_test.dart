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

/// Checks the hand-written envelope parsers against the specification's
/// envelope schemas.
///
/// Each case runs through both `json_schema_builder` and the typed parser
/// (`AgentToRendererMessage.fromJson` or `RendererToAgentMessage.fromJson`),
/// and the test fails if they disagree on whether the envelope is valid. The
/// catalog the schemas reference is stubbed: every `catalog.json` definition is
/// the empty schema, so the cases exercise envelope rules only. Component and
/// function contents are the payload validator's job.
///
/// Known gaps, which the table therefore avoids:
///
/// - `format: date-time` is an annotation by default, so the schema accepts
///   any `timestamp` string while the typed parser requires ISO 8601.
/// - The v1.0 `Extensions` key pattern uses `\p{XID_Start}` and
///   `\p{XID_Continue}`. `json_schema_builder` 0.1.7 matches no key against
///   it, so it rejects every extension, while the typed parser requires only
///   that `extensions` is an object. The table uses empty `extensions`.
/// - An optional field set to null is read as absent by the typed parser; the
///   schema rejects it as the wrong type.
/// - The v1.0 `Component` definition sets `unevaluatedProperties: false`, so
///   with the catalog stubbed a component may carry only the common
///   properties. The typed parser leaves component contents to the payload
///   validator.
/// - The v0.9 generic error leaves `code` untyped; the typed parser requires a
///   string.
/// - The schemas leave `action` open to additional properties, which the typed
///   parser accepts and drops on round trip, other than `catalogId` and
///   `metadata`.
library;

import 'dart:convert';
import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:path/path.dart' as p;
import 'package:test/test.dart';

final String _specRoot = p.normalize(
  p.join(Directory.current.path, '..', '..', 'specification'),
);

/// Loads a specification schema, dropping its `$schema` declaration so that
/// validation does not try to fetch the draft 2020-12 meta-schema.
Map<String, Object?> _load(String relativePath) =>
    (jsonDecode(File(p.join(_specRoot, relativePath)).readAsStringSync())
        as Map<String, Object?>)
      ..remove(r'$schema');

/// A catalog whose every definition accepts anything.
const Map<String, Object?> _stubCatalog = {
  r'$defs': {
    'anyComponent': <String, Object?>{},
    'anyFunction': <String, Object?>{},
    'theme': <String, Object?>{},
  },
};

/// An envelope schema, with the documents it references registered.
class _Oracle {
  _Oracle(String version, String file, {List<String> siblings = const []}) {
    final Uri base = Uri.parse('https://a2ui.org/specification/$version/');
    sourceUri = base.resolve(file);
    registry.addSchema(
        base.resolve('catalog.json'), Schema.fromMap(_stubCatalog));
    for (final sibling in siblings) {
      registry.addSchema(
        base.resolve(sibling),
        Schema.fromMap(_load('$version/json/$sibling')),
      );
    }
    schema = Schema.fromMap(_load('$version/json/$file'));
  }

  final SchemaRegistry registry = SchemaRegistry();
  late final Uri sourceUri;
  late final Schema schema;

  List<ValidationError> validate(Map<String, Object?> envelope) =>
      schema.validateSync(
        envelope,
        sourceUri: sourceUri,
        schemaRegistry: registry,
      );
}

bool _parses(Object? Function() parse) {
  try {
    parse();
    return true;
  } on A2uiValidationError {
    return false;
  }
}

void _expectAgreement(
  _Oracle oracle,
  Map<String, Map<String, Object?>> cases,
  Object? Function(Map<String, Object?>) parse,
) {
  cases.forEach((String name, Map<String, Object?> envelope) {
    test(name, () {
      final List<ValidationError> errors = oracle.validate(envelope);
      final bool parserAccepts = _parses(() => parse(envelope));
      expect(
        parserAccepts,
        errors.isEmpty,
        reason: errors.isEmpty
            ? 'The schema accepts the envelope but the parser rejects it.'
            : 'The schema rejects the envelope ($errors) but the parser '
                'accepts it.',
      );
    });
  });
}

const String _timestamp = '2026-01-02T03:04:05.000Z';

Map<String, Object?> _action([Map<String, Object?> extra = const {}]) => {
      'name': 'submit',
      'surfaceId': 's1',
      'sourceComponentId': 'btn',
      'timestamp': _timestamp,
      'context': <String, Object?>{},
      ...extra,
    };

void main() {
  group('v0.9 agent-to-renderer envelopes agree with the schema', () {
    final oracle = _Oracle('v0_9', 'server_to_client.json');
    _expectAgreement(
      oracle,
      {
        'createSurface': {
          'version': 'v0.9',
          'createSurface': {'surfaceId': 's', 'catalogId': 'c'},
        },
        'createSurface with theme and sendDataModel': {
          'version': 'v0.9',
          'createSurface': {
            'surfaceId': 's',
            'catalogId': 'c',
            'theme': {'primaryColor': '#fff'},
            'sendDataModel': true,
          },
        },
        'createSurface without catalogId': {
          'version': 'v0.9',
          'createSurface': {'surfaceId': 's'},
        },
        'createSurface with components': {
          'version': 'v0.9',
          'createSurface': {
            'surfaceId': 's',
            'catalogId': 'c',
            'components': [
              {'id': 'root'},
            ],
          },
        },
        'createSurface with a non-boolean sendDataModel': {
          'version': 'v0.9',
          'createSurface': {
            'surfaceId': 's',
            'catalogId': 'c',
            'sendDataModel': 'yes',
          },
        },
        'updateComponents': {
          'version': 'v0.9',
          'updateComponents': {
            'surfaceId': 's',
            'components': [
              {'id': 'root', 'component': 'Text'},
            ],
          },
        },
        'updateComponents with no components': {
          'version': 'v0.9',
          'updateComponents': {'surfaceId': 's', 'components': <Object?>[]},
        },
        'updateDataModel without value': {
          'version': 'v0.9',
          'updateDataModel': {'surfaceId': 's', 'path': '/a'},
        },
        'updateDataModel with a non-string path': {
          'version': 'v0.9',
          'updateDataModel': {'surfaceId': 's', 'path': 3},
        },
        'deleteSurface': {
          'version': 'v0.9',
          'deleteSurface': {'surfaceId': 's'},
        },
        'deleteSurface with an unknown body key': {
          'version': 'v0.9',
          'deleteSurface': {'surfaceId': 's', 'x': 1},
        },
        'an unknown envelope key': {
          'version': 'v0.9',
          'deleteSurface': {'surfaceId': 's'},
          'x': 1,
        },
        'two message bodies': {
          'version': 'v0.9',
          'deleteSurface': {'surfaceId': 's'},
          'updateDataModel': {'surfaceId': 's'},
        },
        'no version': {
          'deleteSurface': {'surfaceId': 's'},
        },
        'callRendererFunction': {
          'version': 'v0.9',
          'callRendererFunction': {
            'functionCallId': 'c1',
            'callFunction': {'@call': 'f', 'catalogId': 'c'},
          },
        },
      },
      AgentToRendererMessage.fromJson,
    );
  });

  group('v1.0 agent-to-renderer envelopes agree with the schema', () {
    final oracle = _Oracle(
      'v1_0',
      'agent_to_renderer.json',
      siblings: ['common_types.json'],
    );
    _expectAgreement(
      oracle,
      {
        'createSurface with only a surfaceId': {
          'version': 'v1.0',
          'createSurface': {'surfaceId': 's'},
        },
        'createSurface with every field': {
          'version': 'v1.0',
          'createSurface': {
            'surfaceId': 's',
            'catalogId': 'c',
            'sendDataModel': true,
            'components': [
              {'id': 'root', 'component': 'Text'},
            ],
            'dataModel': {'a': 1},
            'metadata': {'extensions': <String, Object?>{}},
          },
        },
        'createSurface with theme': {
          'version': 'v1.0',
          'createSurface': {
            'surfaceId': 's',
            'theme': <String, Object?>{},
          },
        },
        'createSurface with no components': {
          'version': 'v1.0',
          'createSurface': {'surfaceId': 's', 'components': <Object?>[]},
        },
        'createSurface with a non-object dataModel': {
          'version': 'v1.0',
          'createSurface': {'surfaceId': 's', 'dataModel': 3},
        },
        'createSurface with an unknown metadata key': {
          'version': 'v1.0',
          'createSurface': {
            'surfaceId': 's',
            'metadata': {'other': 1},
          },
        },
        'updateDataModel with an explicit null value': {
          'version': 'v1.0',
          'updateDataModel': {'surfaceId': 's', 'value': null},
        },
        'updateDataModel without value': {
          'version': 'v1.0',
          'updateDataModel': {'surfaceId': 's', 'path': '/a'},
        },
        'deleteSurface with an unknown body key': {
          'version': 'v1.0',
          'deleteSurface': {'surfaceId': 's', 'x': 1},
        },
        'an unknown envelope key': {
          'version': 'v1.0',
          'deleteSurface': {'surfaceId': 's'},
          'x': 1,
        },
        'callRendererFunction': {
          'version': 'v1.0',
          'callRendererFunction': {
            'functionCallId': 'c1',
            'callFunction': {'@call': 'f', 'catalogId': 'c'},
          },
        },
        'callRendererFunction without catalogId': {
          'version': 'v1.0',
          'callRendererFunction': {
            'functionCallId': 'c1',
            'callFunction': {'@call': 'f'},
          },
        },
        'callRendererFunction without functionCallId': {
          'version': 'v1.0',
          'callRendererFunction': {
            'callFunction': {'@call': 'f', 'catalogId': 'c'},
          },
        },
        'callRendererFunction with an unknown body key': {
          'version': 'v1.0',
          'callRendererFunction': {
            'functionCallId': 'c1',
            'callFunction': {'@call': 'f', 'catalogId': 'c'},
            'x': 1,
          },
        },
        'agentFunctionResponse with a value': {
          'version': 'v1.0',
          'agentFunctionResponse': {'functionCallId': 'c1', 'value': 1},
        },
        'agentFunctionResponse with an error': {
          'version': 'v1.0',
          'agentFunctionResponse': {
            'functionCallId': 'c1',
            'error': {'code': 'X', 'message': 'm'},
          },
        },
        'agentFunctionResponse with a value and an error': {
          'version': 'v1.0',
          'agentFunctionResponse': {
            'functionCallId': 'c1',
            'value': 1,
            'error': {'code': 'X', 'message': 'm'},
          },
        },
        'agentFunctionResponse with neither value nor error': {
          'version': 'v1.0',
          'agentFunctionResponse': {'functionCallId': 'c1'},
        },
        'agentFunctionResponse error without a message': {
          'version': 'v1.0',
          'agentFunctionResponse': {
            'functionCallId': 'c1',
            'error': {'code': 'X'},
          },
        },
        'a v0.9 version tag': {
          'version': 'v0.9',
          'agentFunctionResponse': {'functionCallId': 'c1', 'value': 1},
        },
      },
      AgentToRendererMessage.fromJson,
    );
  });

  group('v0.9 renderer-to-agent envelopes agree with the schema', () {
    final oracle = _Oracle('v0_9', 'client_to_server.json');
    _expectAgreement(
      oracle,
      {
        'action': {'version': 'v0.9', 'action': _action()},
        'action with an additional property': {
          'version': 'v0.9',
          'action': _action({'userMessage': 'hi', 'catalogId': 'c'}),
        },
        'action without context': {
          'version': 'v0.9',
          'action': _action()..remove('context'),
        },
        'validation error': {
          'version': 'v0.9',
          'error': {
            'code': 'VALIDATION_FAILED',
            'surfaceId': 's',
            'path': '/a',
            'message': 'm',
          },
        },
        'validation error with an extra property': {
          'version': 'v0.9',
          'error': {
            'code': 'VALIDATION_FAILED',
            'surfaceId': 's',
            'path': '/a',
            'message': 'm',
            'details': 1,
          },
        },
        'validation error without a path': {
          'version': 'v0.9',
          'error': {
            'code': 'VALIDATION_FAILED',
            'surfaceId': 's',
            'message': 'm'
          },
        },
        'generic error with additional properties': {
          'version': 'v0.9',
          'error': {'code': 'X', 'surfaceId': 's', 'message': 'm', 'extra': 1},
        },
        'generic error without a surfaceId': {
          'version': 'v0.9',
          'error': {'code': 'X', 'message': 'm'},
        },
        'an action and an error': {
          'version': 'v0.9',
          'action': _action(),
          'error': {'code': 'X', 'surfaceId': 's', 'message': 'm'},
        },
        'an unknown envelope key': {
          'version': 'v0.9',
          'action': _action(),
          'x': 1,
        },
        'rendererFunctionResponse': {
          'version': 'v0.9',
          'rendererFunctionResponse': {'functionCallId': 'c1', 'value': 1},
        },
      },
      RendererToAgentMessage.fromJson,
    );
  });

  group('v1.0 renderer-to-agent envelopes agree with the schema', () {
    final oracle = _Oracle(
      'v1_0',
      'renderer_to_agent.json',
      siblings: ['common_types.json'],
    );
    _expectAgreement(
      oracle,
      {
        'action with catalogId and metadata': {
          'version': 'v1.0',
          'action': _action({
            'catalogId': 'c',
            'metadata': {'extensions': <String, Object?>{}},
          }),
        },
        'action with an unknown metadata key': {
          'version': 'v1.0',
          'action': _action({
            'metadata': {'other': 1},
          }),
        },
        'callAgentFunction': {
          'version': 'v1.0',
          'callAgentFunction': {
            'surfaceId': 's',
            'functionCallId': 'c1',
            'callFunction': {'@call': 'f'},
          },
        },
        'callAgentFunction without surfaceId': {
          'version': 'v1.0',
          'callAgentFunction': {
            'functionCallId': 'c1',
            'callFunction': {'@call': 'f'},
          },
        },
        'callAgentFunction with a callFunction lacking @call': {
          'version': 'v1.0',
          'callAgentFunction': {
            'surfaceId': 's',
            'functionCallId': 'c1',
            'callFunction': {'catalogId': 'c'},
          },
        },
        'rendererFunctionResponse': {
          'version': 'v1.0',
          'rendererFunctionResponse': {'functionCallId': 'c1', 'value': null},
        },
        'rendererFunctionResponse without functionCallId': {
          'version': 'v1.0',
          'rendererFunctionResponse': {'value': 1},
        },
        'unallowed-parent error': {
          'version': 'v1.0',
          'error': {
            'code': 'UNALLOWED_PARENT',
            'surfaceId': 's',
            'path': '/a',
            'message': 'm',
          },
        },
        'unallowed-child error without a surfaceId': {
          'version': 'v1.0',
          'error': {'code': 'UNALLOWED_CHILD', 'path': '/a', 'message': 'm'},
        },
        'validation error with an extra property': {
          'version': 'v1.0',
          'error': {
            'code': 'VALIDATION_FAILED',
            'surfaceId': 's',
            'path': '/a',
            'message': 'm',
            'x': 1,
          },
        },
        'generic error with a surfaceId': {
          'version': 'v1.0',
          'error': {'code': 'X', 'surfaceId': 's', 'message': 'm', 'x': 1},
        },
        'generic error with a functionCallId': {
          'version': 'v1.0',
          'error': {'code': 'X', 'functionCallId': 'c1', 'message': 'm'},
        },
        'generic error with both identifiers': {
          'version': 'v1.0',
          'error': {
            'code': 'X',
            'surfaceId': 's',
            'functionCallId': 'c1',
            'message': 'm',
          },
        },
        'generic error with neither identifier': {
          'version': 'v1.0',
          'error': {'code': 'X', 'message': 'm'},
        },
        'generic error with a non-string code': {
          'version': 'v1.0',
          'error': {'code': 3, 'surfaceId': 's', 'message': 'm'},
        },
        'an unknown envelope key': {
          'version': 'v1.0',
          'action': _action(),
          'x': 1,
        },
      },
      RendererToAgentMessage.fromJson,
    );
  });
}
