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

/// Runs the shared `conformance/core/data_model.yaml` suite against
/// [DataModel].
///
/// Two mappings, both documented in the suite header: `op: delete` maps to
/// `set(path, null)`, since Dart has no `undefined`; `watch` attaches one
/// observer per entry, so a repeated path attaches a second.
void main() {
  final List<Map<String, Object?>> cases = loadConformanceSuite(
    'core/data_model.yaml',
  );
  final List<Map<String, Object?>> pointerCases = loadConformanceSuite(
    'core/data_model_pointers.yaml',
  );
  final List<Map<String, Object?>> deletionCases = loadConformanceSuite(
    'core/data_deletion.yaml',
  );
  final List<Map<String, Object?>> contextCases = loadConformanceSuite(
    'core/data_context.yaml',
  );

  group('conformance core/data_model.yaml', () {
    test('suite is not empty', () => expect(cases, isNotEmpty));

    for (final testCase in cases) {
      test(testCase['name']! as String, () {
        _runCase(testCase);
      });
    }
  });

  group('conformance core/data_model_pointers.yaml', () {
    test('suite is not empty', () => expect(pointerCases, isNotEmpty));

    for (final testCase in pointerCases) {
      test(testCase['name']! as String, () {
        _runPayloadDataModelCase(testCase);
      });
    }
  });

  group('conformance core/data_deletion.yaml', () {
    test('suite is not empty', () => expect(deletionCases, isNotEmpty));

    for (final testCase in deletionCases) {
      test(testCase['name']! as String, () {
        _runPayloadDataModelCase(testCase);
      });
    }
  });

  group('conformance core/data_context.yaml', () {
    test('suite is not empty', () => expect(contextCases, isNotEmpty));

    for (final testCase in contextCases) {
      test(testCase['name']! as String, () {
        _runResolvePathCase(testCase);
      });
    }
  });
}

/// Runs a payload case through [MessageProcessor], over catalogs that accept
/// any component, so the data model is built the way a renderer builds it.
void _runPayloadDataModelCase(Map<String, Object?> testCase) {
  final steps = testCase['steps']! as List<Object?>;
  final List<Map<String, Object?>> envelopes = [
    for (final Object? step in steps)
      for (final Object? item
          in (step! as Map<String, Object?>)['payload']! as List<Object?>)
        item! as Map<String, Object?>,
  ];
  final String version =
      envelopes.map((e) => e['version']).whereType<String>().firstOrNull ??
          'v0.9';
  final Set<String> catalogIds = {
    for (final Map<String, Object?> envelope in envelopes)
      if (envelope['createSurface'] case final Map<String, Object?> body)
        if (body['catalogId'] case final String id) id,
  };
  final processor = MessageProcessor<ComponentApi>(
    catalogs: [
      for (final String id
          in catalogIds.isEmpty ? {'test-catalog'} : catalogIds)
        Catalog<ComponentApi, FunctionImplementation>(
          id: id,
          protocolVersion: A2uiProtocolVersion.tryParseSemVer(version),
          components: const [],
        ),
    ],
    validationConfig: ValidationConfig.relaxed,
  );
  addTearDown(processor.groupModel.dispose);

  for (var i = 0; i < steps.length; i++) {
    final step = steps[i]! as Map<String, Object?>;
    final Object? payload = _deepCopy(step['payload']);
    final expectError = step['expectError'] as Map<String, Object?>?;
    if (expectError != null) {
      expect(
        () => processor.processMessages(payload),
        throwsA(_matchesError(expectError)),
        reason: '${testCase['name']} step $i',
      );
      return;
    }
    processor.processMessages(payload);
  }

  final expected = testCase['expect'] as Map<String, Object?>?;
  if (expected != null && expected.containsKey('surfaces')) {
    final surfaces = expected['surfaces']! as Map<String, Object?>;
    surfaces.forEach((surfaceId, surfaceExp) {
      final expMap = surfaceExp! as Map<String, Object?>;
      if (expMap.containsKey('dataModel')) {
        expect(
          processor.groupModel.getSurface(surfaceId)!.dataModel.get('/'),
          equals(expMap['dataModel']),
          reason: '${testCase['name']} surface $surfaceId dataModel',
        );
      }
    });
  }
}

void _runResolvePathCase(Map<String, Object?> testCase) {
  final args = testCase['args']! as Map<String, Object?>;
  final String path = (args['path'] as String?) ?? '';
  final String contextPath = (args['contextPath'] as String?) ??
      (args['context_path'] as String?) ??
      '/';
  final ctx =
      DataContext(DataModel(), (call, fnArgs, ctx) => null, contextPath);
  expect(ctx.resolvePath(path), equals(testCase['expect']));
}

void _runCase(Map<String, Object?> testCase) {
  // The suite is shared across cases, so deep copy before mutating.
  final model = DataModel(
    _deepCopy(testCase['initial']) ?? <String, Object?>{},
  );
  addTearDown(model.dispose);

  final watched = <_Observer>[];
  final List<Object?> watchPaths =
      (testCase['watch'] as List<Object?>?) ?? const [];
  for (final path in watchPaths) {
    watched.add(_Observer(model, path! as String));
  }

  final steps = testCase['steps']! as List<Object?>;
  for (var i = 0; i < steps.length; i++) {
    final step = steps[i]! as Map<String, Object?>;
    final reason = '${testCase['name']} step $i (${step['op']})';
    for (final observer in watched) {
      observer.resetCount();
    }

    final Object? expectError = step['expect_error'];
    if (expectError != null) {
      expect(
        () => _applyOp(model, step),
        throwsA(_matchesError(expectError as Map<String, Object?>)),
        reason: reason,
      );
      continue;
    }

    _applyOp(model, step, observers: watched, reason: reason);
    _checkNotifications(step, watched, reason);
    _checkWatchedValues(step, watched, reason);
  }
}

void _applyOp(
  DataModel model,
  Map<String, Object?> step, {
  List<_Observer> observers = const [],
  String reason = '',
}) {
  final op = step['op']! as String;
  switch (op) {
    case 'get':
      final Object? actual = model.get(step['path']! as String);
      if (step['expect_absent'] == true) {
        expect(actual, isNull, reason: reason);
      }
      if (step.containsKey('expect_type')) {
        expect(
          actual,
          step['expect_type'] == 'list'
              ? isA<List<Object?>>()
              : isA<Map<Object?, Object?>>(),
          reason: reason,
        );
      }
      if (step.containsKey('expect')) {
        expect(actual, equals(step['expect']), reason: reason);
      }
    case 'set':
      model.set(step['path']! as String, step['value']);
    case 'delete':
      // Dart has no `undefined`; writing null removes the key.
      model.set(step['path']! as String, null);
    case 'dispose':
      model.dispose();
    default:
      fail('Unknown data_model op: $op');
  }
}

void _checkNotifications(
  Map<String, Object?> step,
  List<_Observer> observers,
  String reason,
) {
  final Object? expected = step['expect_notified'];
  if (expected == null) return;
  final List<String> expectedPaths = (expected as List<Object?>).cast<String>();
  final notified = <String>[
    for (final _Observer observer in observers)
      for (var i = 0; i < observer.changeCount; i++) observer.path,
  ];
  expect(
    notified..sort(),
    equals([...expectedPaths]..sort()),
    reason: '$reason: notified observers',
  );
}

void _checkWatchedValues(
  Map<String, Object?> step,
  List<_Observer> observers,
  String reason,
) {
  final Object? expected = step['expect_values'];
  if (expected == null) return;
  (expected as Map<String, Object?>).forEach((path, value) {
    final _Observer observer = observers.firstWhere(
      (o) => o.path == path,
      orElse: () => fail('$reason: $path is not watched'),
    );
    expect(observer.signal.value, equals(value), reason: '$reason: $path');
  });
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
    'ParseError' => isA<A2uiParseError>(),
    _ => isA<A2uiError>(),
  };
  if (message != null) {
    matcher = allOf(
      matcher,
      predicate<Object?>((Object? e) {
        return RegExp(message).hasMatch(e.toString());
      }, 'message matching /$message/'),
    );
  }
  return matcher;
}

/// Deep copies plain maps, lists and scalars parsed from a conformance suite.
Object? _deepCopy(Object? value) {
  if (value is Map) {
    return <String, Object?>{
      for (final MapEntry<Object?, Object?> entry in value.entries)
        entry.key.toString(): _deepCopy(entry.value),
    };
  }
  if (value is List) {
    return <Object?>[for (final Object? item in value) _deepCopy(item)];
  }
  return value;
}

/// A single observer attached to one path of a [DataModel].
class _Observer {
  final String path;
  final ReadonlySignal<Object?> signal;
  int _count = 0;

  _Observer(DataModel model, this.path) : signal = model.watch<Object?>(path) {
    signal.subscribe((_) => _count++);
    // preact_signals calls back on subscribe; that is not a change.
    _count = 0;
  }

  int get changeCount => _count;

  void resetCount() => _count = 0;
}
