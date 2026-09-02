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
import 'package:test/test.dart';

import 'conformance_harness.dart';

/// Runs the shared `conformance/core/message_processor.yaml` suite against
/// [MessageProcessor].
///
/// The suite uses the case vocabulary of the `v1_0` branch: `messages`,
/// `catalogPaths`, and `expect.surfaces`. Cases name a catalog rather than
/// declaring one, because renderers build catalogs from code, so this harness
/// registers a native catalog under the id the messages use.
void main() {
  final List<Map<String, Object?>> cases = loadConformanceSuite(
    'core/message_processor.yaml',
  );

  group('conformance core/message_processor.yaml', () {
    test('suite is not empty', () => expect(cases, isNotEmpty));

    for (final testCase in cases) {
      test(testCase['name']! as String, () => _runCase(testCase));
    }
  });
}

void _runCase(Map<String, Object?> testCase) {
  final name = testCase['name']! as String;
  final catalog = _ConformanceCatalog(_catalogIdOf(testCase));
  final processor = MessageProcessor<ComponentApi>(catalogs: [catalog]);
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

/// The messages a case processes, accepting both the bare list and the
/// `{messages: [...]}` wrapper the protocol allows.
List<Map<String, Object?>> _messagesOf(Map<String, Object?> testCase) {
  final Object? raw = testCase['messages'] ?? testCase['payload'];
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
///
/// Conversion counts as processing here: the Dart processor takes typed
/// messages, so [A2uiMessage.fromJson] rejects a malformed envelope first.
void _process(
  MessageProcessor<ComponentApi> processor,
  List<Map<String, Object?>> messages,
) {
  for (final envelope in messages) {
    processor.processMessages([
      A2uiMessage.fromJson(Map<String, dynamic>.from(envelope)),
    ]);
  }
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
        (expectations['components']! as List<Object?>)
            .cast<Map<String, Object?>>(),
        '$name: $surfaceId',
      );
    }
  });
}

/// Checks the surface's component graph against the case's expectations.
///
/// Each entry is the component's flattened properties: `id`, `component`, and
/// whatever else the message set on it. The list is exhaustive, so an empty
/// one asserts the surface holds no components at all.
void _checkComponents(
  SurfaceModel<ComponentApi> surface,
  List<Map<String, Object?>> expected,
  String reason,
) {
  expect(surface.componentsModel.all.map((c) => c.id).toSet(), {
    for (final Map<String, Object?> entry in expected) entry['id'],
  }, reason: '$reason: component ids');

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
    'ValidationError' => isA<A2uiValidationError>(),
    'CatalogError' => isA<A2uiCatalogError>(),
    'IntegrityError' => isA<A2uiIntegrityError>(),
    'RecursionError' => isA<A2uiRecursionError>(),
    'StateError' => isA<A2uiStateError>(),
    'ParseError' => isA<A2uiParseError>(),
    'CompileError' => isA<A2uiCompileError>(),
    _ => isA<A2uiError>(),
  };
  if (message != null) {
    matcher = allOf(
      matcher,
      predicate<Object?>(
        (Object? e) => RegExp(message).hasMatch(e.toString()),
        'message matching /$message/',
      ),
    );
  }
  return matcher;
}

/// The minimal catalog's components under the id a case names, built natively
/// as the suite requires.
///
/// The suite's cases are written against `Text`, so the catalog has to declare
/// it: the processor validates each arriving component against its surface's
/// catalog, and a catalog declaring nothing would reject every case.
class _ConformanceCatalog
    extends Catalog<ComponentApi, FunctionImplementation> {
  _ConformanceCatalog(String id)
    : super(
        id: id,
        components: [
          MinimalTextApi(),
          MinimalRowApi(),
          MinimalColumnApi(),
          MinimalButtonApi(),
          MinimalTextFieldApi(),
        ],
        functions: [CapitalizeFunction()],
      );
}
