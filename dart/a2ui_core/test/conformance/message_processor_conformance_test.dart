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
/// Cases supply only a catalog id: renderers build catalogs from code, so each
/// harness builds one natively, as the suite header explains.
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
  final catalog = _EmptyCatalog(_catalogIdOf(testCase));
  final processor = MessageProcessor<ComponentApi>(catalogs: [catalog]);
  final List<Map<String, Object?>> payload =
      (testCase['payload']! as List<Object?>).cast<Map<String, Object?>>();
  final name = testCase['name']! as String;

  final Object? expectError = testCase['expect_error'];
  if (expectError != null) {
    expect(
      () => _process(processor, payload),
      throwsA(_matchesError(expectError as Map<String, Object?>)),
      reason: name,
    );
    return;
  }

  _process(processor, payload);

  final Map<String, Object?> expected =
      (testCase['expect'] as Map<String, Object?>?) ?? const {};
  _checkSurfaces(processor, expected, name);
  _checkAbsentSurfaces(processor, expected, name);
  _checkClientDataModel(processor, expected, name);
  _checkClientCapabilities(processor, expected, name);
}

/// Converts each envelope and processes it.
///
/// Conversion counts as processing here: the Dart processor takes typed
/// messages, so [A2uiMessage.fromJson] rejects a malformed envelope first.
void _process(
  MessageProcessor<ComponentApi> processor,
  List<Map<String, Object?>> payload,
) {
  for (final envelope in payload) {
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
    expect(surface, isNotNull, reason: '$name: surface $surfaceId is open');

    final expectations = raw! as Map<String, Object?>;
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
    if (expectations.containsKey('data_model')) {
      expect(
        surface!.dataModel.get('/'),
        equals(expectations['data_model']),
        reason: '$name: $surfaceId data model',
      );
    }
    final components = expectations['components'] as Map<String, Object?>?;
    if (components != null) {
      _checkComponents(surface!, components, '$name: $surfaceId');
    }
  });
}

void _checkComponents(
  SurfaceModel<ComponentApi> surface,
  Map<String, Object?> expected,
  String reason,
) {
  for (final MapEntry<String, Object?> entry in expected.entries) {
    final ComponentModel? component = surface.componentsModel.get(entry.key);
    expect(component, isNotNull, reason: '$reason: component ${entry.key}');

    final expectations = entry.value! as Map<String, Object?>;
    if (expectations.containsKey('component')) {
      expect(
        component!.type,
        expectations['component'],
        reason: '$reason: ${entry.key} type',
      );
    }
    final properties = expectations['properties'] as Map<String, Object?>?;
    if (properties != null) {
      properties.forEach((key, value) {
        expect(
          component!.properties[key],
          equals(value),
          reason: '$reason: ${entry.key}.$key',
        );
      });
    }
  }
  if (expected.isEmpty) {
    expect(
      surface.componentsModel.all,
      isEmpty,
      reason: '$reason: no components',
    );
  }
}

void _checkAbsentSurfaces(
  MessageProcessor<ComponentApi> processor,
  Map<String, Object?> expected,
  String name,
) {
  final absent = expected['absent_surfaces'] as List<Object?>?;
  if (absent == null) return;
  for (final Object? surfaceId in absent) {
    expect(
      processor.groupModel.getSurface(surfaceId! as String),
      isNull,
      reason: '$name: surface $surfaceId is closed',
    );
  }
}

void _checkClientDataModel(
  MessageProcessor<ComponentApi> processor,
  Map<String, Object?> expected,
  String name,
) {
  if (expected['client_data_model_absent'] == true) {
    expect(processor.getClientDataModel(), isNull, reason: name);
  }
  final model = expected['client_data_model'] as Map<String, Object?>?;
  if (model == null) return;

  final Map<String, dynamic>? actual = processor.getClientDataModel();
  expect(actual, isNotNull, reason: name);
  model.forEach((key, value) {
    expect(actual![key], equals(value), reason: '$name: client data $key');
  });
}

void _checkClientCapabilities(
  MessageProcessor<ComponentApi> processor,
  Map<String, Object?> expected,
  String name,
) {
  final capabilities = expected['client_capabilities'] as Map<String, Object?>?;
  if (capabilities == null) return;

  final Map<String, dynamic> actual = processor.getClientCapabilities();
  capabilities.forEach((version, value) {
    final expectations = value! as Map<String, Object?>;
    final actualVersion = actual[version] as Map<String, dynamic>?;
    expect(actualVersion, isNotNull, reason: '$name: capabilities $version');
    expectations.forEach((key, expectedValue) {
      expect(
        actualVersion![key],
        equals(expectedValue),
        reason: '$name: capabilities $version.$key',
      );
    });
  });
}

String _catalogIdOf(Map<String, Object?> testCase) {
  final Map<String, Object?> catalog =
      (testCase['catalog'] as Map<String, Object?>?) ?? const {};
  final schema = catalog['catalog_schema'] as Map<String, Object?>?;
  return schema?['catalogId'] as String? ?? 'conformance-catalog';
}

Matcher _matchesError(Map<String, Object?> expectError) {
  final category = expectError['category'] as String?;
  final message = expectError['message'] as String?;
  Matcher matcher = switch (category) {
    'StateError' => isA<A2uiStateError>(),
    'ValidationError' => isA<A2uiValidationError>(),
    'DataError' => isA<A2uiDataError>(),
    'CatalogError' => isA<A2uiCatalogError>(),
    'IntegrityError' => isA<A2uiIntegrityError>(),
    'RecursionError' => isA<A2uiRecursionError>(),
    _ => isA<A2uiError>(),
  };
  if (message != null) {
    matcher = allOf(
      matcher,
      predicate<Object?>(
        (e) => RegExp(message).hasMatch(e.toString()),
        'message matching /$message/',
      ),
    );
  }
  return matcher;
}

/// A catalog with no components, built natively as the suite requires.
class _EmptyCatalog extends Catalog<ComponentApi, FunctionImplementation> {
  _EmptyCatalog(String id) : super(id: id, components: const []);
}
