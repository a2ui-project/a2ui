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
import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

import '../support/renderer_catalog.dart';
import 'conformance_harness.dart';

/// Cases in `core/message_processor_v1_0.yaml` expected to fail, with the
/// reason each is currently failing.
const Map<String, String> _v10ExpectedFailures = {
  'test_batch_atomic_rollback_on_candidate_topology_cycle':
      'The v1.0 common types are not embedded yet.',
  'test_batch_duplicate_component_ids_in_same_message_error':
      'The v1.0 common types are not embedded yet.',
  'test_batch_multi_stage_lifecycle_pipeline':
      'The v1.0 common types are not embedded yet.',
  'test_composition_constraints_preserved_on_partial_parent_update':
      'The v1.0 common types are not embedded yet.',
  'test_permissive_mode_allows_dangling_references':
      'The v1.0 common types are not embedded yet.',
  'test_permissive_mode_allows_orphan_components':
      'The v1.0 common types are not embedded yet.',
  'test_v10_component_catalog_override':
      'The v1.0 common types are not embedded yet.',
  'test_v10_create_surface_inline_initialization':
      'The v1.0 common types are not embedded yet.',
  'test_v10_update_components_mismatched_catalog_protocol_version_error':
      'The v1.0 common types are not embedded yet.',
  'test_v10_get_renderer_capabilities':
      'getRendererCapabilities does not emit v1.0 capabilities yet.',
  'test_v10_create_surface_metadata_extension_key_must_be_identifier':
      'Metadata extension keys are not checked against the v1.0 schema yet.',
};

/// The `process_messages` cases in `core/reserved_keys.yaml` expected to
/// fail, with the reason each is currently failing.
const Map<String, String> _reservedKeysExpectedFailures = {
  'test_escaped_doubled_at_unescaping':
      'The v1.0 common types are not embedded yet, so the inline '
          'component cannot be validated.',
};

/// The `validate` cases in `core/functions.yaml` expected to fail, with the
/// reason each is currently failing.
const Map<String, String> _functionsExpectedFailures = {
  'test_function_format_currency_locale_and_symbol':
      'The v1.0 common types are not embedded yet.',
  'test_function_format_date_tr35_tokens':
      'The v1.0 common types are not embedded yet.',
  'test_function_logical_and_or_not':
      'The v1.0 common types are not embedded yet.',
  'test_function_pluralize_categories':
      'The v1.0 common types are not embedded yet.',
};

/// Runs the shared message-processor suites against [MessageProcessor] and
/// [DataContext]: `core/message_processor_v0_9.yaml`,
/// `core/message_processor_v1_0.yaml`, the `process_messages` cases of
/// `core/reserved_keys.yaml`, and the `validate` cases of
/// `core/functions.yaml`, which render basic-catalog components.
void main() {
  _registerSuite('core/message_processor_v0_9.yaml');
  _registerSuite(
    'core/message_processor_v1_0.yaml',
    expectedFailures: _v10ExpectedFailures,
  );
  _registerSuite(
    'core/reserved_keys.yaml',
    onlyAction: 'process_messages',
    expectedFailures: _reservedKeysExpectedFailures,
  );
  _registerSuite(
    'core/functions.yaml',
    onlyAction: 'validate',
    expectedFailures: _functionsExpectedFailures,
  );
}

void _registerSuite(
  String suite, {
  String? onlyAction,
  Map<String, String> expectedFailures = const {},
}) {
  final List<ConformanceTestCase> cases = [
    for (final ConformanceTestCase testCase in loadConformanceSuite(suite))
      if (onlyAction == null || _actionOf(testCase) == onlyAction) testCase,
  ];

  group('conformance $suite', () {
    test('suite is not empty', () => expect(cases, isNotEmpty));
    runConformanceSuite(cases, _runCase, expectedFailures: expectedFailures);
  });
}

String _actionOf(Map<String, Object?> testCase) =>
    (testCase['action'] as String?) ?? 'process_messages';

void _runCase(Map<String, Object?> testCase) {
  final String action = _actionOf(testCase);
  switch (action) {
    case 'process_messages' || 'validate':
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
    validationConfig:
        strictMode ? ValidationConfig.strict : ValidationConfig.relaxed,
  );

  if (testCase['steps'] case final List<Object?> steps) {
    _runSteps(processor, testCase, steps.cast<Map<String, Object?>>());
    return;
  }

  final Object? expectError = testCase['expectError'];
  if (expectError != null) {
    expect(
      () => _process(processor, testCase),
      throwsA(_matchesError(expectError as Map<String, Object?>)),
      reason: name,
    );
    return;
  }

  _process(processor, testCase);

  final Map<String, Object?> expected =
      (testCase['expect'] as Map<String, Object?>?) ?? const {};
  _checkSurfaces(processor, expected, name);
}

/// Processes each step's payload in turn, as the validator harness does.
///
/// A step's own `expectError` applies to that step, and the case's applies to
/// the last one. The case's `expect` is checked once every step has run.
void _runSteps(
  MessageProcessor<ComponentApi> processor,
  Map<String, Object?> testCase,
  List<Map<String, Object?>> steps,
) {
  final name = testCase['name']! as String;
  for (var index = 0; index < steps.length; index++) {
    final Map<String, Object?> step = steps[index];
    final Object? payload = step['messages'] ?? step['payload'];
    final Object? expectError = step['expectError'] ??
        (index == steps.length - 1 ? testCase['expectError'] : null);
    if (expectError != null) {
      expect(
        () => processor.processMessages(payload),
        throwsA(_matchesError(expectError as Map<String, Object?>)),
        reason: '$name: step $index',
      );
    } else {
      processor.processMessages(payload);
    }
  }
  _checkSurfaces(
    processor,
    (testCase['expect'] as Map<String, Object?>?) ?? const {},
    name,
  );
}

void _runGetRendererDataModelCase(Map<String, Object?> testCase) {
  final name = testCase['name']! as String;
  final processor = MessageProcessor<ComponentApi>(
    catalogs: _catalogsFor(testCase),
    defaultVersion: A2uiProtocolVersion.v0_9,
    validationConfig: ValidationConfig.relaxed,
  );
  _process(processor, testCase);

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
  final String version = _versionOf(testCase);
  if (testCase['catalogs'] case final List<Object?> rawCatalogs) {
    return [
      for (final Object? item in rawCatalogs)
        if (item is Map<String, Object?>)
          rendererCatalog(item, protocolVersion: version),
    ];
  }
  // v0.9 cases naming documents run over the basic catalog with its schema
  // checks relaxed (see [_permissive]): they test processing, the schema
  // checks have their own suite, and several of them send a `Button` with
  // only a `label`, which the v0.9 `Button` schema rejects.
  if (testCase['catalogPaths'] case final List<Object?> paths
      when compareVersions(version, 'v1.0') >= 0) {
    final List<Map<String, Object?>> documents = [
      for (final Object? path in paths)
        if (path is String)
          jsonDecode(File(resolveConformancePath(path)).readAsStringSync())
              as Map<String, Object?>,
    ];
    if (documents.length > 1) {
      return [
        for (final document in documents)
          rendererCatalog(document, protocolVersion: version),
      ];
    }
    // A case declaring one document names it by whichever id its messages
    // use, as the validator harness does.
    final Set<String> ids = _catalogIdsOf(testCase);
    if (ids.isEmpty) ids.add(documents.single['catalogId']! as String);
    return [
      for (final String id in ids)
        rendererCatalog(
          documents.single,
          asCatalogId: id,
          protocolVersion: version,
        ),
    ];
  }
  if (testCase['catalog'] case final Map<String, Object?> document
      when document.containsKey('components') ||
          document.containsKey('catalogId')) {
    return [
      rendererCatalog(
        document,
        asCatalogId: _catalogIdOf(testCase),
        protocolVersion: version,
      ),
    ];
  }
  // A case naming no catalog document, or only a protocol version, runs
  // against the basic catalog of its version, under whichever id its
  // messages use. A case expecting a missing catalog gets one under another
  // id.
  final expectError = testCase['expectError'] as Map<String, Object?>?;
  final Catalog<ComponentApi, FunctionImplementation> basic = basicCatalogFor(
    version,
    asCatalogId: expectError?['category'] == 'CatalogError'
        ? 'test-catalog'
        : _catalogIdOf(testCase),
  );
  return [
    if (testCase.containsKey('catalogPaths')) _permissive(basic) else basic,
  ];
}

/// The protocol version a case targets: the one it declares, else the one
/// its first message declares, else v0.9.
String _versionOf(Map<String, Object?> testCase) {
  if (testCase['protocolVersion'] case final String version) return version;
  for (final Map<String, Object?> message in _messagesOf(testCase)) {
    if (message['version'] case final String version) return version;
  }
  return 'v0.9';
}

/// The catalog ids the case's `createSurface` messages name.
Set<String> _catalogIdsOf(Map<String, Object?> testCase) => <String>{
      for (final Map<String, Object?> message in _messagesOf(testCase))
        if (message['createSurface'] case final Map<String, Object?> body)
          if (body['catalogId'] case final String id) id,
    };

/// The messages a case processes, accepting both the bare list and the
/// `{messages: [...]}` wrapper the protocol allows, across all of its steps.
List<Map<String, Object?>> _messagesOf(Map<String, Object?> testCase) {
  if (testCase['steps'] case final List<Object?> steps) {
    return [
      for (final Object? step in steps)
        ..._messagesOf((step! as Map).cast<String, Object?>()),
    ];
  }
  final Object? raw = testCase['messages'] ?? testCase['payload'];
  if (raw == null) return const [];
  final Object? list = raw is Map<String, Object?> ? raw['messages'] : raw;
  return (list! as List<Object?>).cast<Map<String, Object?>>();
}

/// The catalog id the case's messages bind surfaces to.
String _catalogIdOf(Map<String, Object?> testCase) =>
    _catalogIdsOf(testCase).firstOrNull ?? 'test-catalog';

/// Processes the case's raw payload, in whichever shape it declares it.
void _process(
  MessageProcessor<ComponentApi> processor,
  Map<String, Object?> testCase,
) {
  processor.processMessages(testCase['messages'] ?? testCase['payload']);
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
    if (expectations.containsKey('metadata')) {
      expect(
        surface!.metadata,
        equals(expectations['metadata']),
        reason: '$name: $surfaceId metadata',
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
///
/// Properties are compared on the resolved node tree, as the reference
/// harness does: each [ResolvedBinding] is read once for its value and each
/// child node stands for its component id. A component no node renders, such
/// as one unreachable from the root, falls back to its raw
/// [ComponentModel.properties].
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

  final resolver = NodeResolver<ComponentApi>(surface);
  addTearDown(resolver.dispose);
  final nodes = <String, ComponentNode<ComponentApi>>{};
  void collect(Object? value) {
    if (value is ComponentNode<ComponentApi>) {
      if (nodes.containsKey(value.componentId)) return;
      nodes[value.componentId] = value;
      collect(value.props.peek());
    } else if (value is Map) {
      value.values.forEach(collect);
    } else if (value is List) {
      value.forEach(collect);
    }
  }

  collect(resolver.rootNode.peek());

  for (final entry in expected) {
    final id = entry['id']! as String;
    final ComponentModel? component = surface.componentsModel.get(id);
    expect(component, isNotNull, reason: '$reason: component $id');
    final ComponentNode<ComponentApi>? node = nodes[id];

    entry.forEach((key, value) {
      if (key == 'id') return;
      if (key == 'component') {
        expect(node?.type ?? component!.type, value,
            reason: '$reason: $id type');
        return;
      }
      expect(
        node == null
            ? component!.properties[key]
            : _plain(node.props.peek()[key]),
        equals(value),
        reason: '$reason: $id.$key',
      );
    });
  }
}

/// A resolved property as plain JSON: bindings read for their value, child
/// nodes replaced by their component id.
Object? _plain(Object? value) => switch (value) {
      final ResolvedBinding<Object?> binding => _plain(binding.value),
      final ComponentNode<ComponentApi> node => node.componentId,
      final Map<Object?, Object?> map => {
          for (final MapEntry<Object?, Object?> e in map.entries)
            e.key: _plain(e.value),
        },
      final List<Object?> list => [for (final item in list) _plain(item)],
      _ => value,
    };

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
  if (pattern.contains('Unsupported protocol version')) {
    return '($pattern|Unsupported A2UI protocol version)';
  }
  if (pattern.contains('Missing required version field')) {
    return "($pattern|must declare a 'version')";
  }
  if (pattern.contains('surfaceId must be a string')) {
    return "($pattern|Field 'createSurface\\.surfaceId' must be a String)";
  }
  return pattern;
}

/// [catalog] with every component schema replaced by one that accepts any
/// object, so its components and functions stay but payloads are not
/// schema-checked.
Catalog<ComponentApi, FunctionImplementation> _permissive(
  Catalog<ComponentApi, FunctionImplementation> catalog,
) =>
    Catalog<ComponentApi, FunctionImplementation>(
      id: catalog.id,
      protocolVersion: catalog.protocolVersion,
      components: [
        for (final String name in catalog.components.keys)
          ComponentApi(name: name, schema: Schema.fromMap({'type': 'object'})),
      ],
      functions: catalog.functions.values.toList(),
    );
