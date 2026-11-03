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

/// Replays the scenarios of the conformance hub (`conformance/e2e`) through
/// the example app: the model's chunks go through [FakeClient] into the
/// [ChatSession], which parses them with the agent SDK, applies them with the
/// core, and renders them with the Flutter widgets, in one process.
///
/// Each turn's `expectViewTree` is checked against the rendered nodes,
/// `uiOps` drive the rendered widgets, and `expectOutbound` is checked against
/// the `a2ui` messages of the next request the session makes.
library;

import 'dart:convert';
import 'dart:io';

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter_example_v0_9/chat_app.dart';
import 'package:a2ui_flutter_example_v0_9/chat_session.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaml/yaml.dart';

import 'fake_client.dart';

/// The formats whose chunks the scenarios carry, by their name in the hub.
const Map<String, InferenceFormatFactory> hubFormats = {
  'direct_json': ChatSession.defaultFormat,
  'express': ExpressFormatFactory(),
};

/// The `e2e_scenario` entries of every YAML file directly under [directory],
/// as (file name, scenario) pairs sorted by file name.
List<(String, Map<String, Object?>)> loadHubScenarios(String directory) {
  final dir = Directory(directory);
  if (!dir.existsSync()) return const [];
  final List<File> files = [
    for (final FileSystemEntity entity in dir.listSync())
      if (entity is File && entity.path.endsWith('.yaml')) entity,
  ]..sort((a, b) => a.path.compareTo(b.path));
  return [
    for (final File file in files)
      for (final Object? entry
          in _yamlToDart(loadYaml(file.readAsStringSync())) as List<Object?>)
        if (entry case {'action': 'e2e_scenario'} && Map<String, Object?>())
          (file.uri.pathSegments.last, entry),
  ];
}

Object? _yamlToDart(Object? node) => switch (node) {
  YamlMap() => <String, Object?>{
    for (final MapEntry<Object?, Object?> entry in node.entries)
      entry.key.toString(): _yamlToDart(entry.value),
  },
  YamlList() => <Object?>[for (final Object? item in node) _yamlToDart(item)],
  _ => node,
};

/// Runs [scenario] through a [ChatSession] reading [format], the hub's name
/// of one of [hubFormats], and checks what each turn expects.
Future<void> runHubScenario(
  WidgetTester tester,
  Map<String, Object?> scenario,
  String format,
) async {
  final List<Map<String, Object?>> turns = [
    for (final Object? turn in scenario['turns']! as List<Object?>)
      turn! as Map<String, Object?>,
  ];
  final client = FakeClient([
    for (final Map<String, Object?> turn in turns)
      ((turn['modelChunks']! as Map<String, Object?>)[format]! as List<Object?>)
          .cast<String>(),
  ]);
  final session = ChatSession(
    client: client,
    inferenceFormatFactory: hubFormats[format]!,
  );
  addTearDown(session.dispose);
  await tester.pumpWidget(ChatApp(session: session));

  var errorMark = 0;
  for (var i = 0; i < turns.length; i++) {
    final Map<String, Object?> turn = turns[i];
    final where = 'turn $i';
    final bool previousSentOutbound =
        i > 0 && turns[i - 1]['expectOutbound'] != null;
    if (turn['userText'] case final String userText
        when i == 0 || !previousSentOutbound) {
      await tester.enterText(
        find.widgetWithText(TextField, 'Ask for some UI'),
        userText,
      );
      await tester.tap(find.byTooltip('Send'));
    }
    await _settle(tester, session);
    expect(
      client.requests,
      hasLength(i + 1),
      reason: '$where: the session should have made one request per turn',
    );

    if (turn['expectWire'] case final List<Object?> wire) {
      _assertModelText(session, wire, where);
    }
    if (turn['expectViewTree'] case final Map<String, Object?> viewTrees) {
      for (final MapEntry<String, Object?> entry in viewTrees.entries) {
        _assertSurface(tester, session, entry.key, entry.value, where);
      }
    }
    if (turn['uiOps'] case final List<Object?> uiOps) {
      for (final op in uiOps) {
        await _runUiOp(tester, session, op! as Map<String, Object?>, where);
      }
    }
    if (turn['expectDataModel'] case final Map<String, Object?> dataModels) {
      for (final MapEntry<String, Object?> entry in dataModels.entries) {
        final SurfaceModel<ComponentImplementation>? surface = session
            .processor
            .model
            .getSurface(entry.key);
        expect(surface, isNotNull, reason: '$where: surface ${entry.key}');
        expect(
          surface!.dataModel.get('/'),
          equals(entry.value),
          reason: '$where: data model of ${entry.key}',
        );
      }
    }
    final int errorCount = errorsOf(session).length;
    if (turn['expectErrors'] case final List<Object?> expectedErrors) {
      expect(
        errorsOf(session).sublist(errorMark),
        hasLength(expectedErrors.length),
        reason: '$where: errors the session reported',
      );
    }
    errorMark = errorCount;

    await _settle(tester, session);
    if (turn['expectOutbound'] case final List<Object?> expectedOutbound) {
      expect(
        client.requests.length,
        greaterThan(i + 1),
        reason: '$where: expected a request carrying the outbound messages',
      );
      final request =
          jsonDecode(client.requests[i + 1].last.text) as Map<String, Object?>;
      final messages =
          (request['a2ui']! as Map<String, Object?>)['messages']!
              as List<Object?>;
      expect(
        messages,
        hasLength(expectedOutbound.length),
        reason: '$where: expectOutbound length',
      );
      for (var j = 0; j < expectedOutbound.length; j++) {
        _assertMatches(
          messages[j],
          expectedOutbound[j],
          '$where.expectOutbound[$j]',
        );
      }
    }
  }
}

/// Pumps until [session] has no turn waiting for or reading a reply.
Future<void> _settle(WidgetTester tester, ChatSession session) async {
  for (var i = 0; i < 100 && session.busy; i++) {
    await tester.pump();
  }
  expect(session.busy, isFalse, reason: 'the session did not finish its turn');
  await tester.pump();
}

/// Checks that each text part of [wire] was shown as a model entry.
void _assertModelText(ChatSession session, List<Object?> wire, String where) {
  final List<String> shown = [
    for (final ChatEntry entry in session.entries)
      if (entry.kind == ChatEntryKind.model) entry.text.trim(),
  ];
  for (final part in wire) {
    if (part case {'text': final String text}) {
      expect(
        shown,
        contains(text.trim()),
        reason: '$where: the model text should be shown',
      );
    }
  }
}

void _assertSurface(
  WidgetTester tester,
  ChatSession session,
  String surfaceId,
  Object? expected,
  String where,
) {
  final SurfaceModel<ComponentImplementation>? surface = session.processor.model
      .getSurface(surfaceId);
  if (expected == null) {
    expect(surface, isNull, reason: '$where: surface $surfaceId');
    expect(
      _surfaceFinder(surfaceId),
      findsNothing,
      reason: '$where: surface $surfaceId should not be rendered',
    );
    return;
  }
  expect(surface, isNotNull, reason: '$where: surface $surfaceId');
  final Finder surfaceFinder = _surfaceFinder(surfaceId);
  expect(surfaceFinder, findsOneWidget, reason: '$where: surface $surfaceId');
  final expectedTree = expected as Map<String, Object?>;
  final rootId = expectedTree['id']! as String;
  final Finder rootFinder = find.descendant(
    of: surfaceFinder,
    matching: _nodeFinder(rootId),
  );
  expect(rootFinder, findsOneWidget, reason: '$where: root $rootId');
  _assertViewTree(
    tester,
    _nodeOf(tester, rootFinder),
    rootFinder,
    expectedTree,
    where,
  );
}

Finder _surfaceFinder(String surfaceId) => find.byWidgetPredicate(
  (widget) => widget is A2uiSurface && widget.surface.id == surfaceId,
);

/// The widget built for the node with the instance id [instanceId].
Finder _nodeFinder(String instanceId) => find.byWidgetPredicate(
  (widget) =>
      widget.key == NodeKey(instanceId) &&
      widget is! KeyedSubtree &&
      widget is! Flexible,
);

/// The node rendered by the widget [finder] finds.
///
/// The renderer keys that widget by the node's instance id and keeps the node
/// in its `node` field, which the package does not export a type for.
ComponentNode<ComponentImplementation> _nodeOf(
  WidgetTester tester,
  Finder finder,
) =>
    // ignore: avoid_dynamic_calls
    (tester.widget(finder) as dynamic).node
        as ComponentNode<ComponentImplementation>;

const Set<String> _viewNodeKeys = {
  'id',
  'type',
  'state',
  'text',
  'value',
  'label',
  'disabled',
  'isValid',
  'validationErrors',
  'children',
};

void _assertViewTree(
  WidgetTester tester,
  ComponentNode<ComponentImplementation> node,
  Finder nodeFinder,
  Map<String, Object?> expected,
  String where,
) {
  final Set<String> unknown = expected.keys.toSet().difference(_viewNodeKeys);
  expect(unknown, isEmpty, reason: '$where: unsupported view node keys');
  expect(node.componentId, expected['id'], reason: '$where: component id');
  if (expected['state'] case final String state) {
    expect(node.state.name, state, reason: '$where: node state');
    if (state != 'resolved') return;
  }
  if (expected['type'] case final String type) {
    expect(node.type, type, reason: '$where: type of ${node.componentId}');
  }
  final props = ComponentProps(node.props.peek());
  for (final key in const ['text', 'value', 'label', 'disabled']) {
    if (expected[key] case final Object value) {
      expect(
        props.value(key),
        value,
        reason: '$where: $key of ${node.componentId}',
      );
    }
  }
  if (expected['isValid'] case final bool isValid) {
    expect(props.isValid, isValid, reason: '$where: ${node.componentId}');
  }
  if (expected['validationErrors'] case final List<Object?> errors) {
    expect(props.validationErrors, errors, reason: '$where: validation');
  }
  if (expected['children'] case final List<Object?> expectedChildren) {
    final ComponentNode<ComponentImplementation>? onlyChild = props.child(
      'child',
    );
    final List<ComponentNode<ComponentImplementation>> children =
        onlyChild != null ? [onlyChild] : props.children('children');
    expect(
      children.map((child) => child.componentId),
      hasLength(expectedChildren.length),
      reason: '$where: children of ${node.componentId}',
    );
    for (var i = 0; i < children.length; i++) {
      final Finder childFinder = find.descendant(
        of: nodeFinder,
        matching: _nodeFinder(children[i].instanceId),
      );
      expect(
        childFinder,
        findsOneWidget,
        reason: '$where: ${children[i].instanceId} should be rendered',
      );
      _assertViewTree(
        tester,
        children[i],
        childFinder,
        expectedChildren[i]! as Map<String, Object?>,
        where,
      );
    }
  }
}

Future<void> _runUiOp(
  WidgetTester tester,
  ChatSession session,
  Map<String, Object?> op,
  String where,
) async {
  final surfaceId = op['surfaceId']! as String;
  final targetNode = op['targetNode']! as String;
  final Finder target = find.descendant(
    of: _surfaceFinder(surfaceId),
    matching: _nodeFinder(targetNode),
  );
  expect(target, findsOneWidget, reason: '$where: uiOp target $targetNode');
  switch (op['op']) {
    case 'user_input':
      final Object? value = op['inputValue'];
      if (value is String) {
        final Finder field = find.descendant(
          of: target,
          matching: find.byType(TextField),
        );
        await tester.ensureVisible(field);
        await tester.enterText(field, value);
      } else if (value is bool) {
        final Finder checkbox = find.descendant(
          of: target,
          matching: find.byType(Checkbox),
        );
        await tester.ensureVisible(checkbox);
        await tester.tap(checkbox);
      } else {
        fail('$where: unsupported inputValue $value');
      }
    case 'user_gesture':
      final Finder button = find.descendant(
        of: target,
        matching: find.byWidgetPredicate((w) => w is ButtonStyleButton),
      );
      await tester.ensureVisible(button);
      await tester.tap(button);
    case final Object? other:
      fail('$where: unsupported uiOp $other');
  }
  await tester.pump();
}

bool _isWildcard(Object? value) =>
    value is Map && value.length == 1 && value.containsKey(r'$match');

/// Checks [actual] against [expected], in which `{"$match": kind}` stands for
/// any value of that kind.
void _assertMatches(Object? actual, Object? expected, String where) {
  if (_isWildcard(expected)) {
    final Object? kind = (expected! as Map)[r'$match'];
    switch (kind) {
      case 'any':
        expect(actual, isNotNull, reason: '$where: expected a value');
      case 'string':
        expect(actual, isA<String>(), reason: '$where: expected a string');
      case 'iso8601':
        expect(actual, isA<String>(), reason: '$where: expected a timestamp');
        expect(
          DateTime.tryParse(actual! as String),
          isNotNull,
          reason: '$where: expected an ISO 8601 timestamp',
        );
      default:
        fail('$where: unsupported wildcard $kind');
    }
    return;
  }
  if (expected is List) {
    expect(actual, isA<List<Object?>>(), reason: '$where: expected a list');
    final actualList = actual! as List<Object?>;
    expect(actualList, hasLength(expected.length), reason: '$where: length');
    for (var i = 0; i < expected.length; i++) {
      _assertMatches(actualList[i], expected[i], '$where[$i]');
    }
    return;
  }
  if (expected is Map) {
    expect(
      actual,
      isA<Map<String, Object?>>(),
      reason: '$where: expected a map',
    );
    final actualMap = actual! as Map<String, Object?>;
    expect(
      actualMap.keys.toSet(),
      expected.keys.map((key) => key.toString()).toSet(),
      reason: '$where: keys',
    );
    for (final MapEntry<Object?, Object?> entry in expected.entries) {
      _assertMatches(actualMap[entry.key], entry.value, '$where.${entry.key}');
    }
    return;
  }
  expect(actual, equals(expected), reason: '$where: value');
}
