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

import '../support/renderer_catalog.dart';
import 'conformance_harness.dart';

/// Runs the shared `conformance/core/message_processor_v0_9.yaml` suite against
/// [MessageProcessor] and [DataContext].
void main() {
  final List<Map<String, Object?>> cases = loadConformanceSuite(
    'core/message_processor_v0_9.yaml',
  );

  group('conformance core/message_processor_v0_9.yaml', () {
    test('suite is not empty', () => expect(cases, isNotEmpty));

    for (final testCase in cases) {
      test(testCase['name']! as String, () => _runCase(testCase));
    }
  });
}

void _runCase(Map<String, Object?> testCase) {
  final String action = (testCase['action'] as String?) ?? 'process_messages';
  switch (action) {
    case 'process_messages':
      _runProcessMessagesCase(testCase);
    case 'get_renderer_data_model':
      _runGetRendererDataModelCase(testCase);
    case 'get_renderer_capabilities':
      _runGetRendererCapabilitiesCase(testCase);
    case 'resolve_path':
      _runResolvePathCase(testCase);
    default:
      throw StateError('Unsupported message_processor action: $action');
  }
}

void _runProcessMessagesCase(Map<String, Object?> testCase) {
  final name = testCase['name']! as String;
  final strictMode = testCase['strictMode'] == true;
  final processor = MessageProcessor<ComponentApi>(
    catalogs: _catalogsFor(testCase),
    defaultVersion: A2uiProtocolVersion.v0_9,
    validationConfig:
        strictMode ? ValidationConfig.strict : ValidationConfig.relaxed,
  );
  final List<Map<String, Object?>> messages = _messagesOf(testCase);

  final Object? expectError = testCase['expectError'];
  if (expectError != null) {
    expect(
      () => _process(processor, messages),
      throwsA(_matchesError(expectError as Map<String, Object?>)),
      reason: name,
    );
    return;
  }

  _process(processor, messages);

  final Map<String, Object?> expected =
      (testCase['expect'] as Map<String, Object?>?) ?? const {};
  _checkSurfaces(processor, expected, name);
}

void _runGetRendererDataModelCase(Map<String, Object?> testCase) {
  final name = testCase['name']! as String;
  final processor = MessageProcessor<ComponentApi>(
    catalogs: _catalogsFor(testCase),
    defaultVersion: A2uiProtocolVersion.v0_9,
    validationConfig: ValidationConfig.relaxed,
  );
  _process(processor, _messagesOf(testCase));

  final Map<String, dynamic>? actual = processor.getClientDataModel();
  final Object? expected = testCase['expect'];
  if (expected == null) {
    expect(actual, isNull, reason: name);
  } else {
    expect(actual, equals(expected), reason: name);
  }
}

void _runGetRendererCapabilitiesCase(Map<String, Object?> testCase) {
  final name = testCase['name']! as String;
  final processor = MessageProcessor<ComponentApi>(
    catalogs: _catalogsFor(testCase),
    defaultVersion: A2uiProtocolVersion.v0_9,
  );
  final Map<String, Object?> args =
      (testCase['args'] as Map<String, Object?>?) ?? const {};
  final includeInlineCatalogs = args['includeInlineCatalogs'] == true;

  final Map<String, dynamic> actual = processor.getClientCapabilities(
    includeInlineCatalogs: includeInlineCatalogs,
  );
  expect(actual, equals(testCase['expect']), reason: name);
}

void _runResolvePathCase(Map<String, Object?> testCase) {
  final name = testCase['name']! as String;
  final Map<String, Object?> args =
      (testCase['args'] as Map<String, Object?>?) ?? const {};
  final String path = (args['path'] as String?) ?? '';
  final String contextPath = (args['contextPath'] as String?) ?? '/';
  final context = DataContext(DataModel(), (_, __, ___) => null, contextPath);
  expect(context.resolvePath(path), equals(testCase['expect']), reason: name);
}

List<Catalog<ComponentApi, FunctionImplementation>> _catalogsFor(
  Map<String, Object?> testCase,
) {
  if (testCase['catalogs'] case final List<Object?> rawCatalogs) {
    return [
      for (final Object? item in rawCatalogs)
        if (item is Map<String, Object?>) rendererCatalog(item),
    ];
  }
  final expectError = testCase['expectError'] as Map<String, Object?>?;
  if (expectError?['category'] == 'CatalogError') {
    return [_ConformanceCatalog('test-catalog')];
  }
  return [_ConformanceCatalog(_catalogIdOf(testCase))];
}

/// The messages a case processes, accepting both the bare list and the
/// `{messages: [...]}` wrapper the protocol allows.
List<Map<String, Object?>> _messagesOf(Map<String, Object?> testCase) {
  final Object? raw = testCase['messages'] ?? testCase['payload'];
  if (raw == null) return const [];
  final Object? list = raw is Map<String, Object?> ? raw['messages'] : raw;
  return (list! as List<Object?>).cast<Map<String, Object?>>();
}

/// The catalog id the case's messages bind surfaces to.
String _catalogIdOf(Map<String, Object?> testCase) {
  for (final Map<String, Object?> message in _messagesOf(testCase)) {
    final Object? create = message['createSurface'];
    if (create is Map<String, Object?> && create['catalogId'] is String) {
      return create['catalogId']! as String;
    }
  }
  return 'test-catalog';
}

/// Converts each envelope and processes it.
void _process(
  MessageProcessor<ComponentApi> processor,
  List<Map<String, Object?>> messages,
) {
  processor.processMessages(
    AgentToRendererMessagePayload([
      for (final envelope in messages)
        AgentToRendererMessage.fromJson(Map<String, dynamic>.from(envelope)),
    ]),
  );
}

void _checkSurfaces(
  MessageProcessor<ComponentApi> processor,
  Map<String, Object?> expected,
  String name,
) {
  final surfaces = expected['surfaces'] as Map<String, Object?>?;
  if (surfaces == null) return;

  surfaces.forEach((surfaceId, raw) {
    final SurfaceModel<ComponentApi>? surface = processor.groupModel.getSurface(
      surfaceId,
    );
    final expectations = raw! as Map<String, Object?>;

    if (expectations['exists'] == false) {
      expect(surface, isNull, reason: '$name: surface $surfaceId is closed');
      return;
    }
    expect(surface, isNotNull, reason: '$name: surface $surfaceId is open');

    if (expectations.containsKey('catalogId')) {
      expect(
        surface!.catalog.id,
        expectations['catalogId'],
        reason: '$name: $surfaceId catalogId',
      );
    }
    if (expectations.containsKey('theme')) {
      expect(
        surface!.theme,
        equals(expectations['theme']),
        reason: '$name: $surfaceId theme',
      );
    }
    if (expectations.containsKey('sendDataModel')) {
      expect(
        surface!.sendDataModel,
        expectations['sendDataModel'],
        reason: '$name: $surfaceId sendDataModel',
      );
    }
    if (expectations.containsKey('dataModel')) {
      expect(
        surface!.dataModel.get('/'),
        equals(expectations['dataModel']),
        reason: '$name: $surfaceId data model',
      );
    }
    if (expectations.containsKey('components')) {
      _checkComponents(
        surface!,
        _normalizeExpectedComponents(expectations['components']),
        '$name: $surfaceId',
      );
    }
  });
}

List<Map<String, Object?>> _normalizeExpectedComponents(Object? raw) {
  if (raw is List<Object?>) {
    return raw.cast<Map<String, Object?>>();
  }
  if (raw is Map<String, Object?>) {
    return [
      for (final MapEntry<String, Object?> entry in raw.entries)
        <String, Object?>{
          'id': entry.key,
          ...(entry.value! as Map<String, Object?>),
        },
    ];
  }
  return const [];
}

/// Checks the surface's component graph against the case's expectations.
void _checkComponents(
  SurfaceModel<ComponentApi> surface,
  List<Map<String, Object?>> expected,
  String reason,
) {
  expect(
    surface.componentsModel.all.map((c) => c.id).toSet(),
    {
      for (final Map<String, Object?> entry in expected) entry['id'],
    },
    reason: '$reason: component ids',
  );

  for (final entry in expected) {
    final id = entry['id']! as String;
    final ComponentModel? component = surface.componentsModel.get(id);
    expect(component, isNotNull, reason: '$reason: component $id');

    entry.forEach((key, value) {
      if (key == 'id') return;
      if (key == 'component') {
        expect(component!.type, value, reason: '$reason: $id type');
        return;
      }
      expect(
        component!.properties[key],
        equals(value),
        reason: '$reason: $id.$key',
      );
    });
  }
}

Matcher _matchesError(Map<String, Object?> expectError) {
  final category = expectError['category'] as String?;
  final message = expectError['message'] as String?;
  Matcher matcher = switch (category) {
    'DataError' => isA<A2uiDataError>(),
    'ValidationError' => anyOf(
        isA<A2uiValidationError>(),
        isA<A2uiIntegrityError>(),
        isA<A2uiRecursionError>(),
        isA<A2uiCatalogError>(),
      ),
    'CatalogError' => isA<A2uiCatalogError>(),
    'IntegrityError' => isA<A2uiIntegrityError>(),
    'RecursionError' => isA<A2uiRecursionError>(),
    'StateError' => isA<A2uiStateError>(),
    'ParseError' => isA<A2uiParseError>(),
    _ => isA<A2uiError>(),
  };
  if (message != null) {
    final String pattern = _align(message);
    matcher = allOf(
      matcher,
      isA<A2uiError>().having(
        (e) => e.message,
        'message',
        matches(RegExp(pattern, caseSensitive: false)),
      ),
    );
  }
  return matcher;
}

String _align(String pattern) {
  if (pattern.contains('Catalog not found:')) {
    return '($pattern|is not supported by this processor)';
  }
  if (pattern.contains('without a type')) {
    return "($pattern|without a 'component' type)";
  }
  if (pattern.contains('Circular reference detected')) {
    return '($pattern|Self-reference detected)';
  }
  if (pattern.contains('Dangling reference')) {
    return '($pattern|references non-existent component)';
  }
  if (pattern.contains('Orphaned component')) {
    return '($pattern|is not reachable from)';
  }
  if (pattern.contains('Validation failed for component')) {
    return '($pattern|does not match the .* schema)';
  }
  if (pattern.contains('Validation failed for theme')) {
    return '($pattern|Theme does not match the theme schema)';
  }
  if (pattern.contains('multiple conflicting update actions')) {
    return '($pattern|must contain exactly one of)';
  }
  if (pattern.contains('beginRendering')) {
    return '($pattern|Unknown A2UI message type)';
  }
  if (pattern.contains('surfaceId must be a string')) {
    return "($pattern|Field 'createSurface\\.surfaceId' must be a String)";
  }
  return pattern;
}

class _ConformanceCatalog
    extends Catalog<ComponentApi, FunctionImplementation> {
  _ConformanceCatalog(String id)
      : super(
          id: id,
          protocolVersion: 'v0.9',
          components: [
            ComponentApi(
              name: 'Text',
              schema: Schema.fromMap({'type': 'object'}),
            ),
            ComponentApi(
              name: 'Button',
              schema: Schema.fromMap({'type': 'object'}),
            ),
            ComponentApi(
              name: 'Label',
              schema: Schema.fromMap({'type': 'object'}),
            ),
            MinimalRowApi(),
            MinimalColumnApi(),
            MinimalTextFieldApi(),
          ],
          functions: [CapitalizeFunction()],
        );
}
