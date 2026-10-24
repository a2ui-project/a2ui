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

import 'dart:async';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

import 'conformance_harness.dart';

class _MaybeFail extends FunctionImplementation {
  _MaybeFail()
      : super(
          name: 'maybeFail',
          returnType: A2uiReturnType.string,
          argumentSchema: Schema.object(
            properties: {'flag': CommonSchemas.dynamicBoolean},
          ),
        );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    if (args['flag'] == true) throw StateError('evaluation failed');
    return 'ready';
  }
}

class _Reenter extends FunctionImplementation {
  _Reenter(this.onCall)
      : super(
          name: 'reenter',
          returnType: A2uiReturnType.string,
          argumentSchema: Schema.object(
            properties: {'tick': CommonSchemas.dynamicNumber},
          ),
        );

  final void Function() onCall;

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    onCall();
    return 'ok';
  }
}

Catalog<ComponentApi, FunctionImplementation> _buildCatalog({
  required void Function() onReenter,
}) =>
    Catalog(
      id: 'problem-delivery-test',
      protocolVersion: A2uiProtocolVersion.v0_9,
      functions: [_MaybeFail(), _Reenter(onReenter)],
      components: [
        ComponentApi(
          name: 'Text',
          schema: Schema.object(
            properties: {
              'text': CommonSchemas.dynamicString,
              'value': CommonSchemas.dynamicString,
            },
          ),
        ),
        ComponentApi(
          name: 'Button',
          schema: Schema.object(properties: {'action': CommonSchemas.action}),
        ),
        ComponentApi(
          name: 'Column',
          schema:
              Schema.object(properties: {'children': CommonSchemas.childList}),
        ),
      ],
    );

/// Runs the shared `conformance/core/problems.yaml` suite against
/// [MessageProcessor], [SurfaceGroupModel], [SurfaceModel], and [NodeResolver].
void main() {
  final List<ConformanceTestCase> cases = loadConformanceSuite(
    'core/problems.yaml',
  );

  group('conformance core/problems.yaml', () {
    test('suite is not empty', () => expect(cases, isNotEmpty));
    runConformanceSuite(cases, _runCase);
  });
}

Future<void> _runCase(ConformanceTestCase testCase) async {
  final name = testCase['name']! as String;
  final List<String> listeners = [
    if (testCase['listeners'] case final List<Object?> configured)
      for (final Object? item in configured) item! as String
    else
      'processor',
  ];
  final throwOnFirstReport = testCase['throwOnFirstReport'] == true;
  var disposeResolverOnFirstReport =
      testCase['disposeResolverOnFirstReport'] as String?;

  var functionCalls = 0;
  void Function() onReenter = () {};
  final Catalog<ComponentApi, FunctionImplementation> catalog = _buildCatalog(
    onReenter: () {
      functionCalls++;
      onReenter();
    },
  );

  final processor = MessageProcessor<ComponentApi>(
    catalogs: [catalog],
    defaultVersion: A2uiProtocolVersion.v0_9,
  );
  addTearDown(processor.dispose);

  final reports = <Map<String, Object?>>[];
  final resolvers = <String, NodeResolver<ComponentApi>>{};
  final heldSurfaces = <String, SurfaceModel<ComponentApi>>{};
  final subscribedSurfaces = <SurfaceModel<ComponentApi>>{};
  final printed = <String>[];
  final uncaughtErrors = <Object>[];

  var listenerDepth = 0;
  var reenteredListener = false;
  var firstListenerThrew = false;
  List<Object?>? pendingFirstReportMessages;

  void recordReport(Map<String, Object?> entry, {required String listener}) {
    if (listenerDepth > 0) {
      reenteredListener = true;
    }
    listenerDepth++;
    try {
      reports.add(entry);
      if (disposeResolverOnFirstReport case final String targetId) {
        disposeResolverOnFirstReport = null;
        resolvers.remove(targetId)?.dispose();
      }
      if (pendingFirstReportMessages case final List<Object?> nested) {
        pendingFirstReportMessages = null;
        final int beforeNested = reports.length;
        processor.processMessages(nested);
        if (reports.length != beforeNested) {
          reenteredListener = true;
        }
      }
      if (throwOnFirstReport && listener == 'first' && !firstListenerThrew) {
        firstListenerThrew = true;
        throw StateError('listener failed');
      }
    } finally {
      listenerDepth--;
    }
  }

  void subscribeSurface(SurfaceModel<ComponentApi> surface) {
    if (!listeners.contains('surface')) return;
    if (!subscribedSurfaces.add(surface)) return;
    surface.onError.subscribe((error) {
      recordReport(
        {
          'listener': 'surface',
          'kind': 'error',
          'code': error.code,
          'surfaceId': error.surfaceId,
        },
        listener: 'surface',
      );
    });
    surface.onWarning.subscribe((warning) {
      recordReport(
        {
          'listener': 'surface',
          'kind': 'warning',
          'code': warning.code,
          'path': warning.path,
        },
        listener: 'surface',
      );
    });
  }

  processor.model.onSurfaceCreated.subscribe(subscribeSurface);

  for (final listener in listeners) {
    if (listener == 'surface') continue;
    processor.model.onError.subscribe((error) {
      recordReport(
        {
          'listener': listener,
          'kind': 'error',
          'code': error.code,
          'surfaceId': error.surfaceId,
        },
        listener: listener,
      );
    });
    processor.model.onWarning.subscribe((warning) {
      recordReport(
        {
          'listener': listener,
          'kind': 'warning',
          'code': warning.code,
          'path': warning.path,
        },
        listener: listener,
      );
    });
  }

  final List<Object?> steps = (testCase['steps'] as List<Object?>?) ?? const [];

  Future<void> executeSteps() async {
    for (var stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      final step = steps[stepIndex]! as Map<String, Object?>;
      final op = step['op']! as String;
      pendingFirstReportMessages =
          step['onFirstReportMessages'] as List<Object?>?;

      switch (op) {
        case 'process_messages':
          processor.processMessages(step['messages'] ?? step['payload']);
        case 'construct_resolver':
          final surfaceId = step['surfaceId']! as String;
          final SurfaceModel<ComponentApi> surface;
          if (step['standalone'] == true) {
            surface = SurfaceModel<ComponentApi>(
              surfaceId,
              defaultCatalog: catalog,
            );
            addTearDown(surface.dispose);
            heldSurfaces[surfaceId] = surface;
            subscribeSurface(surface);
            if (step['components'] case final List<Object?> components) {
              for (final raw in components) {
                final map = raw! as Map<String, Object?>;
                final id = map['id']! as String;
                final type = map['component']! as String;
                final properties = <String, Object?>{
                  for (final MapEntry<String, Object?> entry in map.entries)
                    if (entry.key != 'id' && entry.key != 'component')
                      entry.key: entry.value,
                };
                surface.componentsModel.addComponent(
                  ComponentModel(id, type, properties),
                );
              }
            }
          } else {
            surface = processor.model.getSurface(surfaceId) ??
                heldSurfaces[surfaceId]!;
          }
          if (step['reenterMessages'] case final List<Object?> reenter) {
            onReenter = () {
              onReenter = () {};
              processor.processMessages(reenter);
            };
          }
          final resolver = NodeResolver<ComponentApi>(surface);
          if (step['disposeImmediately'] == true) {
            resolver.dispose();
          } else {
            resolvers[surfaceId] = resolver;
            addTearDown(resolver.dispose);
          }
        case 'dispose_resolver':
          final surfaceId = step['surfaceId']! as String;
          final NodeResolver<ComponentApi> resolver =
              resolvers.remove(surfaceId)!;
          if (step['onDestroyedMessages'] case final List<Object?> destroyed) {
            resolver.rootNode.peek()!.onDestroyed.subscribe(
                  (_) => processor.processMessages(destroyed),
                );
          }
          resolver.dispose();
        case 'set':
          final surfaceId = step['surfaceId']! as String;
          final path = step['path']! as String;
          (processor.model.getSurface(surfaceId) ?? heldSurfaces[surfaceId]!)
              .dataModel
              .set(path, step['value']);
        case 'invoke_action':
          final surfaceId = step['surfaceId']! as String;
          final nodeId = step['node']! as String;
          final property = step['property']! as String;
          final ComponentNode<ComponentApi>? target = _findNode(
            resolvers[surfaceId]!.rootNode.peek(),
            nodeId,
          );
          expect(
            target,
            isNotNull,
            reason: '$name step $stepIndex: node $nodeId not found',
          );
          final action =
              target!.props.peek()[property]! as Future<void> Function();
          unawaited(action());
        case 'detach_surface':
          final surfaceId = step['surfaceId']! as String;
          final SurfaceModel<ComponentApi>? detached =
              processor.model.detachSurface(surfaceId);
          expect(
            detached,
            isNotNull,
            reason: '$name step $stepIndex: surface $surfaceId not attached',
          );
          heldSurfaces[surfaceId] = detached!;
        case 'add_surface':
          final surfaceId = step['surfaceId']! as String;
          final SurfaceModel<ComponentApi> surface =
              heldSurfaces.remove(surfaceId)!;
          processor.model.addSurface(surface);
        case 'delete_surface':
          final surfaceId = step['surfaceId']! as String;
          processor.model.deleteSurface(surfaceId);
        case 'await_delivery':
          await Future<void>.microtask(() {});
        default:
          throw StateError('Unsupported step op: $op');
      }

      expect(
        reenteredListener,
        isFalse,
        reason: '$name step $stepIndex: listener was re-entered during drain',
      );

      if (step['expect_reports'] case final List<Object?> expectedReports) {
        _assertReports(
          reports,
          expectedReports.cast<Map<String, Object?>>(),
          '$name step $stepIndex',
        );
        reports.clear();
      }

      if (step['expectLogged'] case final List<Object?> expectedLogged) {
        for (final pattern in expectedLogged) {
          expect(
            printed,
            contains(contains(pattern! as String)),
            reason: '$name step $stepIndex: expected log containing $pattern',
          );
        }
      }

      if (step['expectNotLogged'] case final List<Object?> expectedNotLogged) {
        for (final pattern in expectedNotLogged) {
          expect(
            printed,
            isNot(contains(contains(pattern! as String))),
            reason:
                '$name step $stepIndex: expected no log containing $pattern',
          );
        }
      }

      if (step['expectFunctionCalls'] case final int expectedCalls) {
        expect(
          functionCalls,
          expectedCalls,
          reason: '$name step $stepIndex: function call count',
        );
      }
    }
  }

  final done = Completer<void>();
  runZonedGuarded(
    () {
      runZoned(
        executeSteps,
        zoneSpecification: ZoneSpecification(
          print: (_, __, ___, line) => printed.add(line),
        ),
      ).then(done.complete, onError: done.completeError);
    },
    (error, stackTrace) {
      if (throwOnFirstReport && error is StateError) {
        uncaughtErrors.add(error);
        return;
      }
      if (!done.isCompleted) {
        done.completeError(error, stackTrace);
      } else {
        Zone.current.handleUncaughtError(error, stackTrace);
      }
    },
  );
  await done.future;

  if (throwOnFirstReport) {
    expect(uncaughtErrors, [isA<StateError>()], reason: name);
  }
}

ComponentNode<ComponentApi>? _findNode(
  ComponentNode<ComponentApi>? root,
  String id,
) {
  if (root == null) return null;
  if (root.componentId == id) return root;
  for (final Object? value in root.props.peek().values) {
    if (value is ComponentNode<ComponentApi>) {
      final ComponentNode<ComponentApi>? found = _findNode(value, id);
      if (found != null) return found;
    } else if (value is List) {
      for (final Object? item in value) {
        if (item is ComponentNode<ComponentApi>) {
          final ComponentNode<ComponentApi>? found = _findNode(item, id);
          if (found != null) return found;
        }
      }
    }
  }
  return null;
}

void _assertReports(
  List<Map<String, Object?>> actual,
  List<Map<String, Object?>> expected,
  String context,
) {
  expect(
    actual.length,
    expected.length,
    reason: '$context: expected ${expected.length} reports, got $actual',
  );
  for (var i = 0; i < expected.length; i++) {
    final Map<String, Object?> exp = expected[i];
    final Map<String, Object?> act = actual[i];
    final String expectedKind = (exp['kind'] as String?) ?? 'error';
    expect(act['kind'], expectedKind, reason: '$context report $i kind');
    expect(act['code'], exp['code'], reason: '$context report $i code');
    if (exp.containsKey('surfaceId')) {
      expect(
        act['surfaceId'],
        exp['surfaceId'],
        reason: '$context report $i surfaceId',
      );
    }
    if (exp.containsKey('path')) {
      expect(act['path'], exp['path'], reason: '$context report $i path');
    }
    if (exp.containsKey('listener')) {
      expect(
        act['listener'],
        exp['listener'],
        reason: '$context report $i listener',
      );
    }
  }
}
