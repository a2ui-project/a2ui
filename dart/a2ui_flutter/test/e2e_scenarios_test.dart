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

import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'adapter_harness.dart';

const Set<String> _e2eScenarioKnownKeys = {
  'name',
  'description',
  'features',
  'action',
  'protocolVersion',
  'catalogPaths',
  'formats',
  'source',
  'turns',
};

const Set<String> _e2eSourceKnownKeys = {'kind', 'from', 'model', 'recordedAt'};

const Set<String> _e2eTurnKnownKeys = {
  'userText',
  'modelChunks',
  'expectWire',
  'expectViewTree',
  'expectErrors',
  'uiOps',
  'expectDataModel',
  'expectOutbound',
};

const Set<String> _e2eUiOpKnownKeys = {
  'op',
  'surfaceId',
  'targetNode',
  'inputValue',
  'userActivation',
};

const Set<String> _e2eViewNodeKnownKeys = {
  ...viewNodeKnownKeys,
  'label',
  'disabled',
};

void main() {
  final List<(String, String)> suiteFiles = _findE2eSuiteFiles();
  if (suiteFiles.isEmpty) {
    throw StateError(
      'Expected E2E scenario YAML files under ../../conformance/e2e',
    );
  }

  tearDownAll(assertAllUnsupportedMatched);

  for (final (String suiteRelPath, String filePath) in suiteFiles) {
    final List<Object?> scenarios = loadYamlTests(filePath);
    group('E2E Scenarios ($suiteRelPath)', () {
      for (final Object? entry in scenarios) {
        final scenario = entry! as Map<String, Object?>;
        final name = scenario['name']! as String;
        testWidgets(name, (tester) async {
          var status = 'failed';
          String? reason;
          addTearDown(() {
            writeManifestRecord({
              'harness': 'flutter',
              'suite': suiteRelPath,
              'case': name,
              'status': status,
              'reason': ?reason,
            });
          });
          try {
            _assertKnownE2eScenario(scenario);
            final String? skipReason = findUnsupportedReason(name);
            if (skipReason != null) {
              status = 'skipped';
              reason = skipReason;
              markTestSkipped(skipReason);
              return;
            }
            await _runScenario(tester, scenario);
            status = 'passed';
          } catch (error) {
            status = 'failed';
            reason = error.toString();
            rethrow;
          }
        });
      }
    });
  }
}

List<(String, String)> _findE2eSuiteFiles() {
  final e2eDir = Directory('../../conformance/e2e');
  if (!e2eDir.existsSync()) return const [];
  final List<(String, String)> entries = [];
  for (final FileSystemEntity entity in e2eDir.listSync(recursive: true)) {
    if (entity is File && entity.path.endsWith('.yaml')) {
      final String normalized = entity.path.replaceAll(r'\', '/');
      final int idx = normalized.indexOf('conformance/');
      final String suiteRel = normalized.substring(idx + 'conformance/'.length);
      entries.add((suiteRel, entity.path));
    }
  }
  entries.sort((a, b) => a.$1.compareTo(b.$1));
  return entries;
}

void _assertKnownE2eViewNode(Map<String, Object?> node, String where) {
  assertKnownKeys(node, _e2eViewNodeKnownKeys, where);
  if (node['validationResults'] case final List<Object?> results) {
    for (var i = 0; i < results.length; i++) {
      assertKnownKeys(
        results[i]! as Map<String, Object?>,
        validationResultKnownKeys,
        '$where.validationResults[$i]',
      );
    }
  }
  if (node['children'] case final List<Object?> children) {
    for (var i = 0; i < children.length; i++) {
      _assertKnownE2eViewNode(
        children[i]! as Map<String, Object?>,
        '$where.children[$i]',
      );
    }
  }
}

void _assertKnownE2eScenario(Map<String, Object?> scenario) {
  final name = scenario['name']! as String;
  assertKnownKeys(scenario, _e2eScenarioKnownKeys, 'scenario($name)');
  if (scenario['action'] != 'e2e_scenario') {
    fail('Unsupported action in scenario($name): ${scenario['action']}');
  }
  if (scenario['source'] case final Map<String, Object?> source) {
    assertKnownKeys(source, _e2eSourceKnownKeys, 'scenario($name).source');
  }
  final turns = scenario['turns']! as List<Object?>;
  expect(turns, isNotEmpty);
  for (var i = 0; i < turns.length; i++) {
    final turn = turns[i]! as Map<String, Object?>;
    assertKnownKeys(turn, _e2eTurnKnownKeys, 'scenario($name).turns[$i]');
    if (turn['expectViewTree'] case final Map<String, Object?> viewTrees) {
      for (final MapEntry<String, Object?> entry in viewTrees.entries) {
        if (entry.value case final Map<String, Object?> tree) {
          _assertKnownE2eViewNode(
            tree,
            'scenario($name).turns[$i].expectViewTree.${entry.key}',
          );
        }
      }
    }
    if (turn['uiOps'] case final List<Object?> uiOps) {
      for (var j = 0; j < uiOps.length; j++) {
        final uiOp = uiOps[j]! as Map<String, Object?>;
        assertKnownKeys(
          uiOp,
          _e2eUiOpKnownKeys,
          'scenario($name).turns[$i].uiOps[$j]',
        );
      }
    }
  }
}

Map<String, Object?> _stripExtendedViewNodeKeys(
  Map<String, Object?> expected,
) => <String, Object?>{
  for (final MapEntry<String, Object?> entry in expected.entries)
    if (entry.key == 'children' && entry.value is List<Object?>)
      'children': <Object?>[
        for (final Object? child in entry.value! as List<Object?>)
          _stripExtendedViewNodeKeys(child! as Map<String, Object?>),
      ]
    else if (viewNodeKnownKeys.contains(entry.key))
      entry.key: entry.value,
};

List<ComponentNode<ComponentImplementation>> _directChildrenOf(
  ComponentNode<ComponentImplementation> node,
) {
  final props = ComponentProps(node.props.peek());
  if (props.child('child')
      case final ComponentNode<ComponentImplementation> child) {
    return [child];
  }
  return props.children('children');
}

void _assertExtendedViewNodeProps(
  ComponentNode<ComponentImplementation> node,
  Map<String, Object?> expected,
) {
  final props = ComponentProps(node.props.peek());
  for (final key in const ['label', 'disabled']) {
    if (expected[key] case final Object expectedVal) {
      expect(props.value(key), expectedVal);
    }
  }
  if (expected['children'] case final List<Object?> expectedChildren) {
    final List<ComponentNode<ComponentImplementation>> children =
        _directChildrenOf(node);
    for (var i = 0; i < expectedChildren.length; i++) {
      _assertExtendedViewNodeProps(
        children[i],
        expectedChildren[i]! as Map<String, Object?>,
      );
    }
  }
}

List<Map<String, Object?>> captureOutbound(AdapterHarnessSession session) =>
    List<Map<String, Object?>>.from(session.outbound);

bool _isMatchAny(Object? value) =>
    value is Map && value.length == 1 && value[r'$match'] == 'any';

void _assertMatchesOutbound(Object? actual, Object? expected, String where) {
  if (_isMatchAny(expected)) {
    expect(
      actual,
      isNotNull,
      reason: '$where: expected non-null value for {r"\$match": "any"}',
    );
    return;
  }
  if (expected is List) {
    expect(actual, isA<List<Object?>>(), reason: '$where: expected list');
    final actualList = actual! as List<Object?>;
    expect(actualList, hasLength(expected.length));
    for (var i = 0; i < expected.length; i++) {
      _assertMatchesOutbound(actualList[i], expected[i], '$where[$i]');
    }
    return;
  }
  if (expected is Map) {
    expect(
      actual,
      isA<Map<String, Object?>>(),
      reason: '$where: expected object',
    );
    final actualMap = actual! as Map<String, Object?>;
    final List<String> actualKeys = actualMap.keys.toList()..sort();
    final List<String> expectedKeys =
        expected.keys.map((k) => k.toString()).toList()..sort();
    expect(actualKeys, equals(expectedKeys), reason: '$where: keys mismatch');
    for (final key in expectedKeys) {
      _assertMatchesOutbound(actualMap[key], expected[key], '$where.$key');
    }
    return;
  }
  expect(actual, equals(expected), reason: '$where: value mismatch');
}

void assertOutbound(
  List<Map<String, Object?>> actual,
  List<Object?> expected,
  String protocolVersion,
) {
  expect(protocolVersion, isNotEmpty);
  expect(
    actual,
    hasLength(expected.length),
    reason: 'expectOutbound length mismatch',
  );
  for (var i = 0; i < expected.length; i++) {
    _assertMatchesOutbound(actual[i], expected[i], 'expectOutbound[$i]');
  }
}

Future<void> _selectSurface(
  WidgetTester tester,
  AdapterHarnessSession session,
  String surfaceId,
) async {
  final SurfaceModel<ComponentImplementation>? target = session.processor.model
      .getSurface(surfaceId);
  expect(target, isNotNull, reason: 'Expected surface "$surfaceId" to exist');
  if (!identical(session.surface, target) || !session.mounted) {
    session.surface = target;
    session.mounted = true;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(child: A2uiSurface(surface: target!)),
        ),
      ),
    );
  }
}

Future<void> _runScenario(
  WidgetTester tester,
  Map<String, Object?> scenario,
) async {
  final SemanticsHandle semantics = tester.ensureSemantics();
  final AdapterHarnessSession session = mountSurface(scenario, tester);
  try {
    final turns = scenario['turns']! as List<Object?>;
    for (final Object? rawTurn in turns) {
      final turn = rawTurn! as Map<String, Object?>;
      final turnOutbound = <Map<String, Object?>>[];
      final turnErrors = <A2uiRendererError>[];

      final expectWire = turn['expectWire']! as List<Object?>;
      for (final Object? rawPart in expectWire) {
        final part = rawPart! as Map<String, Object?>;
        if (part['a2ui'] case final List<Object?> messages) {
          try {
            await runStep(session, <String, Object?>{
              'op': 'process_messages',
              'messages': messages,
            }, tester);
          } on A2uiError catch (_) {
            // Expected for negative scenarios such as missing_surface_error,
            // which verify the resulting outbound error envelope below.
          }
          turnOutbound.addAll(captureOutbound(session));
          turnErrors.addAll(session.errors);
        }
      }

      if (turn['expectViewTree'] case final Map<String, Object?> viewTrees) {
        for (final MapEntry<String, Object?> entry in viewTrees.entries) {
          final String surfaceId = entry.key;
          final Object? expectedTree = entry.value;
          if (expectedTree == null) {
            expect(session.processor.model.getSurface(surfaceId), isNull);
          } else {
            await _selectSurface(tester, session, surfaceId);
            final expectedMap = expectedTree as Map<String, Object?>;
            final ComponentNode<ComponentImplementation>? root =
                extractViewTree(session);
            assertViewTree(
              root,
              _stripExtendedViewNodeKeys(expectedMap),
              tester,
            );
            _assertExtendedViewNodeProps(root!, expectedMap);
          }
        }
      }

      if (turn['uiOps'] case final List<Object?> uiOps) {
        for (final Object? rawOp in uiOps) {
          final uiOp = rawOp! as Map<String, Object?>;
          final surfaceId = uiOp['surfaceId']! as String;
          await _selectSurface(tester, session, surfaceId);
          final step = <String, Object?>{
            for (final MapEntry<String, Object?> e in uiOp.entries)
              if (e.key != 'surfaceId') e.key: e.value,
          };
          await runStep(session, step, tester);
          turnOutbound.addAll(captureOutbound(session));
          turnErrors.addAll(session.errors);
        }
      }

      if (turn['expectDataModel'] case final Map<String, Object?> dataModels) {
        for (final MapEntry<String, Object?> entry in dataModels.entries) {
          final SurfaceModel<ComponentImplementation>? target = session
              .processor
              .model
              .getSurface(entry.key);
          expect(target, isNotNull);
          expect(target!.dataModel.get('/'), equals(entry.value));
        }
      }

      if (turn['expectErrors'] case final List<Object?> expectedErrors) {
        expect(turnErrors, hasLength(expectedErrors.length));
      }

      if (turn['expectOutbound'] case final List<Object?> expectedOutbound) {
        assertOutbound(turnOutbound, expectedOutbound, session.protocolVersion);
      }
    }
  } finally {
    session.dispose();
    semantics.dispose();
  }
}
