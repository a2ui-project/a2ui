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
import 'dart:isolate';
import 'dart:ui' show CheckedState;

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/basic_catalog.dart';
import 'package:a2ui_flutter/v0_9/basic_catalog.dart' as v0_9;
// ignore: deprecated_member_use, see https://github.com/a2ui-project/a2ui/issues/3235
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:json_schema_builder/json_schema_builder.dart'
    hide ValidationResult;
import 'package:yaml/yaml.dart';

/// Reasoned skip entries keyed by `<case>` or `<case>/<op|expectKey>`.
/// Every entry in this map must match at least one case during the run.
const Map<String, String> unsupported = {};

final Set<String> _matchedUnsupportedKeys = {};

const Set<String> adapterCaseKnownKeys = {
  'name',
  'description',
  'features',
  'action',
  'protocolVersion',
  'catalogPaths',
  'catalogs',
  'steps',
};

const Set<String> adapterCatalogKnownKeys = {
  'catalogId',
  'protocolVersion',
  'components',
};

const Set<String> adapterStepKnownKeys = {
  'description',
  'op',
  'messages',
  'targetNode',
  'inputValue',
  'userActivation',
  'expectViewTree',
  'expectAccessibilityTree',
  'expectDataModel',
  'expectActions',
  'expectErrors',
  'expectOutbound',
  'expectSameViewIdentity',
  'expectActiveSubscriptions',
};

const Set<String> adapterStepKnownOps = {
  'process_messages',
  'user_input',
  'user_gesture',
  'programmatic_invoke',
  'unmount_surface',
};

const Set<String> viewNodeKnownKeys = {
  'id',
  'type',
  'state',
  'text',
  'value',
  'badgeText',
  'isValid',
  'validationErrors',
  'validationResults',
  'children',
};

const Set<String> validationResultKnownKeys = {
  'valid',
  'code',
  'message',
  'severity',
};

const Set<String> expectedActionKnownKeys = {
  'name',
  'surfaceId',
  'sourceComponentId',
  'context',
};

const Set<String> expectedErrorKnownKeys = {'code', 'surfaceId', 'message'};

const Set<String> accessibilityCaseKnownKeys = {
  'name',
  'description',
  'features',
  'action',
  'protocolVersion',
  'catalogPath',
  'surface',
  'messages',
  'assertions',
  'steps',
};

const Set<String> accessibilityStepKnownKeys = {
  'description',
  'messages',
  'assertions',
};

const Set<String> accessibilityAssertionsKnownKeys = {
  'accessibilityTree',
  'axeCore',
};

const Set<String> accessibilityNodeKnownKeys = {
  'label',
  'description',
  'live',
  'hidden',
  'role',
  'checked',
};

void _assertMapKeys(
  Map<String, Object?> obj,
  Set<String> allowed,
  String where,
) {
  final List<String> unknown =
      obj.keys.where((k) => !allowed.contains(k)).toList()..sort();
  if (unknown.isNotEmpty) {
    fail('Unhandled keys at $where: $unknown');
  }
}

void _assertKnownViewNodeKeys(Map<String, Object?> node, String where) {
  _assertMapKeys(node, viewNodeKnownKeys, where);
  if (node['validationResults'] case final List<Object?> results) {
    for (var i = 0; i < results.length; i++) {
      _assertMapKeys(
        results[i]! as Map<String, Object?>,
        validationResultKnownKeys,
        '$where.validationResults[$i]',
      );
    }
  }
  if (node['children'] case final List<Object?> children) {
    for (var i = 0; i < children.length; i++) {
      _assertKnownViewNodeKeys(
        children[i]! as Map<String, Object?>,
        '$where.children[$i]',
      );
    }
  }
}

void assertKnownKeys(
  Map<String, Object?> obj, [
  Set<String> allowed = adapterStepKnownKeys,
  String where = 'step',
]) {
  _assertMapKeys(obj, allowed, where);
  if (allowed != adapterStepKnownKeys) return;

  if (obj['op'] case final Object rawOp) {
    if (rawOp is! String || !adapterStepKnownOps.contains(rawOp)) {
      fail('Unsupported adapter step op at $where.op: $rawOp');
    }
  }
  if (obj['expectViewTree'] case final Map<String, Object?> viewTree) {
    _assertKnownViewNodeKeys(viewTree, '$where.expectViewTree');
  }
  if (obj['expectAccessibilityTree'] case final Map<String, Object?> a11yTree) {
    for (final MapEntry<String, Object?> entry in a11yTree.entries) {
      _assertMapKeys(
        entry.value! as Map<String, Object?>,
        accessibilityNodeKnownKeys,
        '$where.expectAccessibilityTree.${entry.key}',
      );
    }
  }
  if (obj['expectActions'] case final List<Object?> actions) {
    for (var i = 0; i < actions.length; i++) {
      _assertMapKeys(
        actions[i]! as Map<String, Object?>,
        expectedActionKnownKeys,
        '$where.expectActions[$i]',
      );
    }
  }
  if (obj['expectErrors'] case final List<Object?> errors) {
    for (var i = 0; i < errors.length; i++) {
      _assertMapKeys(
        errors[i]! as Map<String, Object?>,
        expectedErrorKnownKeys,
        '$where.expectErrors[$i]',
      );
    }
  }
  if (obj['expectOutbound'] case final List<Object?> outboundList) {
    for (var i = 0; i < outboundList.length; i++) {
      final Object? item = outboundList[i];
      if (item is! Map<String, Object?>) {
        fail('Expected object at $where.expectOutbound[$i]');
      }
      if (item['version'] is! String) {
        fail('Expected string at $where.expectOutbound[$i].version');
      }
    }
  }
}

void assertKnownAdapterCase(Map<String, Object?> testCase) {
  final name = testCase['name']! as String;
  _assertMapKeys(testCase, adapterCaseKnownKeys, 'case($name)');
  if (testCase['action'] != 'render_surface') {
    fail('Unsupported action in case($name): ${testCase['action']}');
  }
  if (testCase['catalogs'] case final List<Object?> catalogs) {
    for (var i = 0; i < catalogs.length; i++) {
      _assertMapKeys(
        catalogs[i]! as Map<String, Object?>,
        adapterCatalogKnownKeys,
        'case($name).catalogs[$i]',
      );
    }
  }
  final steps = testCase['steps']! as List<Object?>;
  for (var i = 0; i < steps.length; i++) {
    assertKnownKeys(
      steps[i]! as Map<String, Object?>,
      adapterStepKnownKeys,
      'case($name).steps[$i]',
    );
  }
}

void _assertKnownAccessibilityAssertions(
  Map<String, Object?>? assertions,
  String where,
) {
  if (assertions == null) return;
  _assertMapKeys(assertions, accessibilityAssertionsKnownKeys, where);
  if (assertions['accessibilityTree'] case final Map<String, Object?> tree) {
    for (final MapEntry<String, Object?> entry in tree.entries) {
      _assertMapKeys(
        entry.value! as Map<String, Object?>,
        accessibilityNodeKnownKeys,
        '$where.accessibilityTree.${entry.key}',
      );
    }
  }
}

void assertKnownAccessibilityCase(Map<String, Object?> testCase) {
  final name = testCase['name']! as String;
  _assertMapKeys(testCase, accessibilityCaseKnownKeys, 'case($name)');
  if (testCase['action'] != 'accessibility_check') {
    fail('Unsupported action in case($name): ${testCase['action']}');
  }
  _assertKnownAccessibilityAssertions(
    testCase['assertions'] as Map<String, Object?>?,
    'case($name).assertions',
  );
  if (testCase['steps'] case final List<Object?> steps) {
    for (var i = 0; i < steps.length; i++) {
      final step = steps[i]! as Map<String, Object?>;
      _assertMapKeys(step, accessibilityStepKnownKeys, 'case($name).steps[$i]');
      _assertKnownAccessibilityAssertions(
        step['assertions'] as Map<String, Object?>?,
        'case($name).steps[$i].assertions',
      );
    }
  }
}

String? findUnsupportedReason(
  String caseName, [
  List<Object?> steps = const [],
]) {
  if (unsupported.containsKey(caseName)) {
    _matchedUnsupportedKeys.add(caseName);
    return unsupported[caseName];
  }
  for (final rawStep in steps) {
    final step = rawStep! as Map<String, Object?>;
    final op = step['op'] as String?;
    if (op != null) {
      final opKey = '$caseName/$op';
      if (unsupported.containsKey(opKey)) {
        _matchedUnsupportedKeys.add(opKey);
        return unsupported[opKey];
      }
    }
    for (final String key in step.keys) {
      final stepKey = '$caseName/$key';
      if (unsupported.containsKey(stepKey)) {
        _matchedUnsupportedKeys.add(stepKey);
        return unsupported[stepKey];
      }
    }
    if (step['assertions'] case final Map<String, Object?> assertions) {
      for (final String key in assertions.keys) {
        final assertionKey = '$caseName/$key';
        if (unsupported.containsKey(assertionKey)) {
          _matchedUnsupportedKeys.add(assertionKey);
          return unsupported[assertionKey];
        }
      }
    }
  }
  return null;
}

void assertAllUnsupportedMatched() {
  final List<String> unused =
      unsupported.keys
          .where((k) => !_matchedUnsupportedKeys.contains(k))
          .toList()
        ..sort();
  if (unused.isNotEmpty) {
    fail('Unused unsupported entries did not match any case: $unused');
  }
}

void writeManifestRecord(Map<String, Object?> rec) {
  final String? dir = Platform.environment['A2UI_CONFORMANCE_MANIFEST_DIR'];
  if (dir == null || dir.isEmpty) return;
  Directory(dir).createSync(recursive: true);
  final String harness = (rec['harness'] as String?) ?? 'flutter';
  final file = File(
    '$dir${Platform.pathSeparator}'
    '$harness-$pid-${Isolate.current.hashCode}.jsonl',
  );
  final reason = rec['reason'] as String?;
  final payload = <String, Object?>{
    'harness': harness,
    'suite': (rec['suite']! as String).replaceAll(r'\', '/'),
    'case': rec['case']! as String,
    'status': rec['status']! as String,
    if (reason != null && reason.isNotEmpty) 'reason': reason,
  };
  file.writeAsStringSync(
    '${jsonEncode(payload)}\n',
    mode: FileMode.append,
    flush: true,
  );
}

List<Object?> loadYamlTests(String relativePath) {
  final String source = File(relativePath).readAsStringSync();
  final Object? parsed = _yamlToDart(loadYaml(source));
  if (parsed is List<Object?>) return parsed;
  return (parsed! as Map<String, Object?>)['tests']! as List<Object?>;
}

Object? _yamlToDart(Object? node) {
  if (node is YamlMap) {
    return <String, Object?>{
      for (final MapEntry<Object?, Object?> entry in node.entries)
        entry.key.toString(): _yamlToDart(entry.value),
    };
  }
  if (node is YamlList) {
    return <Object?>[for (final Object? item in node) _yamlToDart(item)];
  }
  return node;
}

CatalogImplementation _buildV10BasicCatalog({
  required Map<String, ComponentNode<ComponentImplementation>> renderedNodes,
  List<String>? openedUrls,
}) {
  final Catalog<ComponentApi, FunctionImplementation> v10Api =
      BasicCatalog.v1_0(openUrl: (uri) => openedUrls?.add(uri.toString()));
  final Map<String, ComponentImplementation> v09ByName = {
    for (final ComponentImplementation impl in BasicComponents.all)
      impl.name: impl,
  };
  final components = <ComponentImplementation>[
    for (final MapEntry<String, ComponentApi> entry
        in v10Api.components.entries)
      if (v09ByName[entry.key] case final ComponentImplementation impl)
        ComponentImplementation(
          name: entry.key,
          schema: entry.value.schema,
          builder: (context, node, props, buildChild) {
            renderedNodes[node.instanceId] = node;
            return impl.builder(context, node, props, buildChild);
          },
        ),
  ];
  return CatalogImplementation(
    id: BasicCatalog.v1_0Id,
    components: components,
    functions: [...v10Api.functions.values, _IncrementCounterFunction()],
    themeSchema: v10Api.themeSchema,
    schemaId: v10Api.schemaId,
    title: v10Api.title,
    description: v10Api.description,
    protocolVersion: v10Api.protocolVersion,
    instructions: v10Api.instructions,
    definitions: v10Api.definitions,
  );
}

CatalogImplementation _buildCustomStatusBadgeCatalog(
  Map<String, ComponentNode<ComponentImplementation>> renderedNodes,
) {
  final statusBadge = ComponentImplementation(
    name: 'StatusBadge',
    schema: Schema.fromMap({
      'type': 'object',
      'properties': {
        'component': {'const': 'StatusBadge'},
        'badgeText': {
          'oneOf': [
            {'type': 'string'},
            {
              'type': 'object',
              'properties': {
                '@path': {'type': 'string'},
              },
              'required': ['@path'],
            },
          ],
        },
      },
      'required': ['component', 'badgeText'],
    }),
    builder: (context, node, props, buildChild) {
      renderedNodes[node.instanceId] = node;
      return Text(props.string('badgeText') ?? '');
    },
  );
  return CatalogImplementation(
    id: 'https://example.com/catalogs/badges/v1/catalog.json',
    components: [statusBadge],
    protocolVersion: A2uiProtocolVersion.v1_0,
  );
}

class _IncrementCounterFunction extends FunctionImplementation {
  _IncrementCounterFunction()
    : super(
        name: 'incrementCounter',
        argumentSchema: Schema.fromMap({'type': 'object'}),
      );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    final path = args['path']! as String;
    final num step = (args['step'] as num?) ?? 1;
    final num current = (context.dataModel.get(path) as num?) ?? 0;
    context.dataModel.set(path, current + step);
    return null;
  }
}

class AdapterHarnessSession {
  AdapterHarnessSession([this.tester, this.protocolVersion = '1.0']) {
    final CatalogImplementation v10Catalog = _buildV10BasicCatalog(
      renderedNodes: renderedNodes,
      openedUrls: openedUrls,
    );
    final CatalogImplementation customCatalog = _buildCustomStatusBadgeCatalog(
      renderedNodes,
    );
    processor = MessageProcessor<ComponentImplementation>(
      catalogs: [v0_9.basicCatalog(), v10Catalog, customCatalog],
      defaultVersion: A2uiProtocolVersion.v1_0,
      outboundListener: (msg) {
        outbound.add(
          jsonDecode(jsonEncode(msg.toJson())) as Map<String, Object?>,
        );
      },
    );
    processor.model.onAction.subscribe((action) {
      actions.add(action);
      outbound.add(_frameActionEnvelope(action, protocolVersion));
    });
    processor.model.onSurfaceCreated.subscribe((created) {
      surface = created;
      created.onError.subscribe((err) {
        errors.add(err);
        if (currentOp != 'programmatic_invoke') {
          outbound.add(
            jsonDecode(
                  jsonEncode(
                    ErrorMessage(version: protocolVersion, error: err).toJson(),
                  ),
                )
                as Map<String, Object?>,
          );
        }
      });
    });
  }

  WidgetTester? tester;
  final String protocolVersion;
  String? currentOp;
  late final MessageProcessor<ComponentImplementation> processor;
  SurfaceModel<ComponentImplementation>? surface;
  final Map<String, ComponentNode<ComponentImplementation>> renderedNodes = {};
  final List<A2uiRendererAction> actions = [];
  final List<A2uiRendererError> errors = [];
  final List<Map<String, Object?>> outbound = [];
  final List<String> openedUrls = [];
  final Map<String, Element> savedElements = {};
  final Map<String, ComponentNode<ComponentImplementation>> savedNodes = {};
  bool mounted = false;

  ComponentNode<ComponentImplementation>? get rootNode =>
      renderedNodes[surface?.rootId ?? 'root'];

  Future<void> processMessages(
    WidgetTester activeTester,
    List<Object?> rawMessages,
  ) async {
    final messages = <Map<String, Object?>>[
      for (final Object? raw in rawMessages)
        Map<String, Object?>.from(raw! as Map),
    ];
    processor.processMessages(
      AgentToRendererMessagePayload.fromJson(
        messages,
        protocolVersion: A2uiProtocolVersion.v1_0,
      ),
    );
    if (!mounted && surface != null) {
      mounted = true;
      await activeTester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(child: A2uiSurface(surface: surface!)),
          ),
        ),
      );
    } else {
      await activeTester.pump();
    }
  }

  void dispose() {
    processor.model.dispose();
  }
}

AdapterHarnessSession mountSurface([
  Map<String, Object?>? caseSpec,
  WidgetTester? tester,
]) => AdapterHarnessSession(
  tester,
  (caseSpec?['protocolVersion'] as String?) ?? '1.0',
);

ComponentNode<ComponentImplementation>? extractViewTree(
  AdapterHarnessSession session,
) => session.rootNode;

void assertViewTree(
  ComponentNode<ComponentImplementation>? actual,
  Map<String, Object?> expected, [
  WidgetTester? tester,
  Finder? ancestor,
]) {
  assertKnownKeys({'expectViewTree': expected});
  expect(actual, isNotNull);
  final ComponentNode<ComponentImplementation> node = actual!;
  expect(node.componentId, expected['id']);
  final Finder candidates = _findNodeView(node.instanceId, ancestor);
  if (expected['state'] case final String expectedState) {
    _assertNodeState(node, candidates, expectedState);
    if (expectedState != 'resolved') return;
  }
  final Finder viewFinder = candidates.first;
  expect(viewFinder, findsOneWidget);
  if (expected['type'] case final String expectedType) {
    expect(node.type, expectedType);
  }
  final props = ComponentProps(node.props.peek());
  for (final propKey in const ['text', 'value', 'badgeText']) {
    if (expected[propKey] case final Object expectedVal) {
      expect(props.value(propKey), expectedVal);
    }
  }
  _assertNodeValidation(tester, props, viewFinder, expected);
  if (expected['children'] case final List<Object?> expectedChildren) {
    final List<ComponentNode<ComponentImplementation>> actualChildren =
        _directChildren(node);
    expect(actualChildren, hasLength(expectedChildren.length));
    for (var i = 0; i < expectedChildren.length; i++) {
      assertViewTree(
        actualChildren[i],
        expectedChildren[i]! as Map<String, Object?>,
        tester,
        viewFinder,
      );
    }
  }
}

Future<void> runStep(
  AdapterHarnessSession session,
  Map<String, Object?> step, [
  WidgetTester? tester,
]) async {
  assertKnownKeys(step);
  final WidgetTester activeTester = (tester ?? session.tester)!;
  await _executeStep(activeTester, session, step);
  _assertStepExpectations(activeTester, session, step);
  _snapshotIdentities(activeTester, session);
}

Future<void> runAccessibilityCase(
  WidgetTester tester,
  Map<String, Object?> testCase,
) async {
  assertKnownAccessibilityCase(testCase);
  final SemanticsHandle semantics = tester.ensureSemantics();
  final AdapterHarnessSession harness = mountSurface(testCase, tester);
  try {
    final steps = testCase['steps'] as List<Object?>?;
    if (steps != null) {
      for (final Object? rawStep in steps) {
        final step = rawStep! as Map<String, Object?>;
        final stepMessages = step['messages']! as List<Object?>;
        await harness.processMessages(tester, stepMessages);
        final stepAssertions = step['assertions']! as Map<String, Object?>;
        final stepTree =
            stepAssertions['accessibilityTree']! as Map<String, Object?>;
        _assertAccessibilityTree(tester, stepTree);
      }
    } else {
      final messages = testCase['messages']! as List<Object?>;
      await harness.processMessages(tester, messages);
      final assertions = testCase['assertions']! as Map<String, Object?>;
      final expectTree =
          assertions['accessibilityTree']! as Map<String, Object?>;
      _assertAccessibilityTree(tester, expectTree);
    }
  } finally {
    harness.dispose();
    semantics.dispose();
  }
}

Future<void> runAdapterCase(
  WidgetTester tester,
  Map<String, Object?> testCase,
) async {
  assertKnownAdapterCase(testCase);
  final SemanticsHandle semantics = tester.ensureSemantics();
  final AdapterHarnessSession harness = mountSurface(testCase, tester);
  try {
    final steps = testCase['steps']! as List<Object?>;
    for (final rawStep in steps) {
      final step = rawStep! as Map<String, Object?>;
      await runStep(harness, step, tester);
    }
  } finally {
    harness.dispose();
    semantics.dispose();
  }
}

Future<void> _executeStep(
  WidgetTester tester,
  AdapterHarnessSession harness,
  Map<String, Object?> step,
) async {
  harness.actions.clear();
  harness.errors.clear();
  harness.outbound.clear();
  final op = step['op']! as String;
  harness.currentOp = op;
  switch (op) {
    case 'process_messages':
      await harness.processMessages(tester, step['messages']! as List<Object?>);
    case 'user_input':
      await _executeUserInput(tester, step);
    case 'user_gesture':
      await _executeUserGesture(tester, step);
    case 'programmatic_invoke':
      await _executeProgrammaticInvoke(tester, harness, step);
    case 'unmount_surface':
      harness.mounted = false;
      await tester.pumpWidget(const SizedBox());
    default:
      fail('Unsupported adapter step op: $op');
  }
}

Finder _findNodeView(String instanceId, [Finder? ancestor]) {
  final Finder base = find.byWidgetPredicate(
    (w) =>
        (w.key == NodeKey(instanceId) ||
            (w.key is NodeKey &&
                (w.key! as NodeKey).value.startsWith('$instanceId-['))) &&
        w is! KeyedSubtree &&
        w is! Flexible,
  );
  return ancestor == null
      ? base
      : find.descendant(of: ancestor, matching: base);
}

String _stepTargetId(Map<String, Object?> step) =>
    (step['targetNode'] ?? step['targetComponentId'])! as String;

Future<void> _executeUserInput(
  WidgetTester tester,
  Map<String, Object?> step,
) async {
  final String targetId = _stepTargetId(step);
  final Object? value = step['inputValue'] ?? step['value'];
  final Finder scope = _findNodeView(targetId).first;
  if (value is String) {
    final Finder field = find.descendant(
      of: scope,
      matching: find.byType(TextField),
    );
    await tester.enterText(field, value);
    await tester.pump();
  } else if (value is bool) {
    final Finder checkbox = find.descendant(
      of: scope,
      matching: find.byType(Checkbox),
    );
    await tester.tap(checkbox);
    await tester.pump();
  }
}

Future<void> _executeUserGesture(
  WidgetTester tester,
  Map<String, Object?> step,
) async {
  final String targetId = _stepTargetId(step);
  final Finder scope = _findNodeView(targetId).first;
  final Finder button = find.descendant(
    of: scope,
    matching: find.byWidgetPredicate((w) => w is ButtonStyleButton),
  );
  await tester.tap(button);
  await tester.pump();
}

Future<void> _executeProgrammaticInvoke(
  WidgetTester tester,
  AdapterHarnessSession harness,
  Map<String, Object?> step,
) async {
  final String targetId = _stepTargetId(step);
  final String propName = (step['property'] as String?) ?? 'action';
  final SurfaceModel<ComponentImplementation> surface = harness.surface!;
  final ComponentNode<ComponentImplementation> node = _findNodeById(
    tester,
    harness,
    targetId,
  )!;
  final Object? rawAction = node.context!.componentModel.properties[propName];
  if (rawAction is Map && rawAction['functionCall'] is Map) {
    final fc = Map<String, dynamic>.from(rawAction['functionCall'] as Map);
    try {
      await node.context!.dataContext.evaluateFunctionCall(fc);
    } on A2uiExpressionError catch (error) {
      await surface.dispatchError(
        ComponentContext.clientErrorFor(surface, error),
      );
    }
  }
  await tester.pump();
}

void _assertStepExpectations(
  WidgetTester tester,
  AdapterHarnessSession harness,
  Map<String, Object?> step,
) {
  if (step['expectViewTree'] case final Map<String, Object?> expectedTree) {
    assertViewTree(extractViewTree(harness), expectedTree, tester);
  }
  if (step['expectSameViewIdentity'] case final List<Object?> keys) {
    final Map<String, (ComponentNode<ComponentImplementation>, Element?)>
    current = _collectIdentityMap(tester, harness.rootNode);
    for (final rawKey in keys) {
      final key = rawKey! as String;
      expect(current[key]?.$1, same(harness.savedNodes[key]));
      expect(current[key]?.$2, same(harness.savedElements[key]));
    }
  }
  if (step['expectDataModel'] case final Map<String, Object?> expectedData) {
    expect(harness.surface!.dataModel.get('/'), equals(expectedData));
  }
  if (step['expectActions'] case final List<Object?> expectedActions) {
    _assertActions(harness.actions, expectedActions);
  }
  if (step['expectErrors'] case final List<Object?> expectedErrors) {
    _assertErrors(harness.errors, expectedErrors);
  }
  _validateOutboundEnvelopes(harness.outbound, harness.protocolVersion);
  if (step['expectOutbound'] case final List<Object?> expectedOutbound) {
    _assertOutbound(harness.outbound, expectedOutbound);
  }
  if (step['expectAccessibilityTree']
      case final Map<String, Object?> expectedA11y) {
    _assertAccessibilityTree(tester, expectedA11y);
  }
  if (step['expectActiveSubscriptions'] case final int expectedSubs) {
    final int liveViews = find
        .byWidgetPredicate(
          (w) => w.key is NodeKey && w is! KeyedSubtree && w is! Flexible,
        )
        .evaluate()
        .length;
    expect(liveViews, expectedSubs);
    for (final ComponentNode<ComponentImplementation> saved
        in harness.savedNodes.values) {
      expect(saved.disposed, isTrue);
    }
  }
}

List<ComponentNode<ComponentImplementation>> _directChildren(
  ComponentNode<ComponentImplementation> node,
) {
  final props = ComponentProps(node.props.peek());
  if (props.child('child')
      case final ComponentNode<ComponentImplementation> c) {
    return [c];
  }
  return props.children('children');
}

Map<String, (ComponentNode<ComponentImplementation>, Element?)>
_collectIdentityMap(
  WidgetTester tester,
  ComponentNode<ComponentImplementation>? root,
) {
  final result = <String, (ComponentNode<ComponentImplementation>, Element?)>{};
  void visit(
    ComponentNode<ComponentImplementation> node,
    String path,
    Finder? ancestor,
  ) {
    final Finder finder = _findNodeView(node.instanceId, ancestor);
    final Iterable<Element> elements = finder.evaluate();
    final Element? elem = elements.isEmpty ? null : elements.first;
    result[node.instanceId] = (node, elem);
    result[path] = (node, elem);
    final List<ComponentNode<ComponentImplementation>> children =
        _directChildren(node);
    for (var i = 0; i < children.length; i++) {
      visit(children[i], '$path/children/$i', finder);
    }
  }

  if (root != null) visit(root, root.componentId, null);
  return result;
}

void _snapshotIdentities(WidgetTester tester, AdapterHarnessSession harness) {
  harness.savedElements.clear();
  harness.savedNodes.clear();
  final Map<String, (ComponentNode<ComponentImplementation>, Element?)>
  identities = _collectIdentityMap(tester, harness.rootNode);
  for (final MapEntry<
        String,
        (ComponentNode<ComponentImplementation>, Element?)
      >
      entry
      in identities.entries) {
    harness.savedNodes[entry.key] = entry.value.$1;
    if (entry.value.$2 != null) {
      harness.savedElements[entry.key] = entry.value.$2!;
    }
  }
}

ComponentNode<ComponentImplementation>? _findNodeById(
  WidgetTester tester,
  AdapterHarnessSession harness,
  String id,
) {
  final Map<String, (ComponentNode<ComponentImplementation>, Element?)>
  identities = _collectIdentityMap(tester, harness.rootNode);
  return identities[id]?.$1;
}

void _assertNodeState(
  ComponentNode<ComponentImplementation> node,
  Finder candidates,
  String expectedState,
) {
  switch (expectedState) {
    case 'pending':
      expect(node.state, NodeState.pending);
      expect(
        find.descendant(
          of: candidates,
          matching: find.byType(CircularProgressIndicator),
        ),
        findsNothing,
      );
    case 'resolved':
      expect(node.state, NodeState.resolved);
      expect(candidates, findsAtLeastNWidgets(1));
    case 'unknown-type':
      expect(node.state, NodeState.unknownType);
      expect(
        find.descendant(of: candidates, matching: find.byType(Text)),
        findsNothing,
      );
    case 'cyclic':
      expect(node.state, NodeState.cyclic);
      expect(
        find.descendant(of: candidates, matching: find.byType(Text)),
        findsNothing,
      );
  }
}

void _assertNodeValidation(
  WidgetTester? tester,
  ComponentProps props,
  Finder viewFinder,
  Map<String, Object?> spec,
) {
  if (spec['isValid'] case final bool expectedValid) {
    expect(props.isValid, expectedValid);
  }
  if (spec['validationErrors'] case final List<Object?> expectedErrors) {
    expect(props.validationErrors, expectedErrors);
  }
  if (spec['validationResults'] case final List<Object?> expectedResults) {
    final List<Map<String, Object?>> actual = [
      for (final ValidationResult r in props.validationResults)
        {
          'valid': r.valid,
          if (r.code != null) 'code': r.code,
          if (r.message != null) 'message': r.message,
          'severity': r.severity ?? 'error',
        },
    ];
    expect(actual, expectedResults);
  }
}

void _assertActions(
  List<A2uiRendererAction> actual,
  List<Object?> expectedList,
) {
  expect(actual, hasLength(expectedList.length));
  for (var i = 0; i < expectedList.length; i++) {
    final expected = expectedList[i]! as Map<String, Object?>;
    expect(actual[i].name, expected['name']);
    expect(actual[i].surfaceId, expected['surfaceId']);
    expect(actual[i].sourceComponentId, expected['sourceComponentId']);
    expect(actual[i].context, equals(expected['context']));
  }
}

void _assertErrors(List<A2uiRendererError> actual, List<Object?> expectedList) {
  expect(actual, hasLength(expectedList.length));
  for (final rawExpected in expectedList) {
    final expected = rawExpected! as Map<String, Object?>;
    final expectedCode = expected['code'] as String?;
    final expectedSurfaceId = expected['surfaceId'] as String?;
    final messageSub =
        (expected['messageContains'] ?? expected['message']) as String?;
    expect(
      actual.any(
        (err) =>
            (expectedCode == null || err.code == expectedCode) &&
            (expectedSurfaceId == null || err.surfaceId == expectedSurfaceId) &&
            (messageSub == null || err.message.contains(messageSub)),
      ),
      isTrue,
      reason: 'Expected error matching $expected in $actual',
    );
  }
}

Map<String, Object?> _loadSpecSchema(String relativePath) {
  final file = File('../../specification/$relativePath');
  final decoded = jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
  decoded.remove(r'$schema');
  return decoded;
}

class _OutboundSchemaOracle {
  _OutboundSchemaOracle(
    String versionDir,
    String baseVersion,
    String file, {
    List<String> siblings = const [],
  }) {
    final Uri base = Uri.parse('https://a2ui.org/specification/$baseVersion/');
    sourceUri = base.resolve(file);
    registry.addSchema(
      base.resolve('catalog.json'),
      Schema.fromMap(const {
        r'$defs': {
          'anyComponent': <String, Object?>{},
          'anyFunction': <String, Object?>{},
          'theme': <String, Object?>{},
        },
      }),
    );
    for (final sibling in siblings) {
      registry.addSchema(
        base.resolve(sibling),
        Schema.fromMap(_loadSpecSchema('$versionDir/json/$sibling')),
      );
    }
    schema = Schema.fromMap(_loadSpecSchema('$versionDir/json/$file'));
  }

  final SchemaRegistry registry = SchemaRegistry();
  late final Uri sourceUri;
  late final Schema schema;

  List<ValidationError> validate(Map<String, Object?> envelope) => schema
      .validateSync(envelope, sourceUri: sourceUri, schemaRegistry: registry);
}

final _OutboundSchemaOracle _v10OutboundOracle = _OutboundSchemaOracle(
  'v1_0',
  'v1_0',
  'renderer_to_agent.json',
  siblings: const ['common_types.json'],
);

final _OutboundSchemaOracle _v09OutboundOracle = _OutboundSchemaOracle(
  'v0_9_1',
  'v0_9',
  'client_to_server.json',
  siblings: const ['common_types.json'],
);

Map<String, Object?> _frameActionEnvelope(
  A2uiRendererAction action,
  String protocolVersion,
) {
  final actionMap =
      jsonDecode(jsonEncode(action.toJson())) as Map<String, Object?>
        ..remove('catalogId');
  return <String, Object?>{'version': protocolVersion, 'action': actionMap};
}

void _validateOutboundEnvelopes(
  List<Map<String, Object?>> envelopes,
  String protocolVersion,
) {
  final bool isV09 =
      protocolVersion.startsWith('v0.9') || protocolVersion.startsWith('0.9');
  final _OutboundSchemaOracle oracle = isV09
      ? _v09OutboundOracle
      : _v10OutboundOracle;
  for (var i = 0; i < envelopes.length; i++) {
    final List<ValidationError> validationErrors = oracle.validate(
      envelopes[i],
    );
    expect(
      validationErrors,
      isEmpty,
      reason:
          'outbound[$i] failed protocol schema validation: $validationErrors',
    );
  }
}

bool _isMatchAny(Object? value) =>
    value is Map && value.length == 1 && value[r'$match'] == 'any';

void _assertMatchesExpectedOutbound(
  Object? actual,
  Object? expected,
  String where,
) {
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
    expect(
      actualList,
      hasLength(expected.length),
      reason: '$where: list length mismatch',
    );
    for (var i = 0; i < expected.length; i++) {
      _assertMatchesExpectedOutbound(actualList[i], expected[i], '$where[$i]');
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
      _assertMatchesExpectedOutbound(
        actualMap[key],
        expected[key],
        '$where.$key',
      );
    }
    return;
  }
  expect(actual, equals(expected), reason: '$where: value mismatch');
}

void _assertOutbound(
  List<Map<String, Object?>> actual,
  List<Object?> expected,
) {
  expect(
    actual,
    hasLength(expected.length),
    reason: 'expectOutbound length mismatch',
  );
  for (var i = 0; i < expected.length; i++) {
    _assertMatchesExpectedOutbound(
      actual[i],
      expected[i],
      'expectOutbound[$i]',
    );
  }
}

void _assertAccessibilityTree(
  WidgetTester tester,
  Map<String, Object?> expectedTree,
) {
  for (final MapEntry<String, Object?> entry in expectedTree.entries) {
    final String id = entry.key;
    final spec = entry.value! as Map<String, Object?>;
    final Finder viewFinder = _findNodeView(id).first;
    expect(viewFinder, findsOneWidget);
    final Semantics semanticsWidget = tester.widget<Semantics>(
      find.descendant(of: viewFinder, matching: find.byType(Semantics)).first,
    );
    final List<SemanticsData> subtreeData = _collectSemanticsData(
      tester,
      viewFinder,
    );
    _assertComponentSemantics(semanticsWidget, subtreeData, spec);
  }
}

List<SemanticsData> _collectSemanticsData(
  WidgetTester tester,
  Finder viewFinder,
) {
  final results = <SemanticsData>[];
  final visited = <int>{};
  void addNode(SemanticsNode node) {
    if (!visited.add(node.id)) return;
    results.add(node.getSemanticsData());
    node.visitChildren((child) {
      addNode(child);
      return true;
    });
  }

  for (final Element element
      in find
          .descendant(
            of: viewFinder,
            matching: find.byWidgetPredicate((_) => true),
          )
          .evaluate()) {
    final RenderObject? renderObject = element.renderObject;
    if (renderObject != null && renderObject.debugSemantics != null) {
      addNode(renderObject.debugSemantics!);
    }
  }
  return results;
}

void _assertComponentSemantics(
  Semantics rootSemantics,
  List<SemanticsData> subtreeData,
  Map<String, Object?> spec,
) {
  if (spec['label'] case final String expectedLabel) {
    final matchesRoot = rootSemantics.properties.label == expectedLabel;
    final bool matchesSubtree = subtreeData.any(
      (d) =>
          d.label == expectedLabel ||
          d.label.split('\n').contains(expectedLabel),
    );
    expect(matchesRoot || matchesSubtree, isTrue);
  }
  if (spec['description'] case final String expectedDescription) {
    expect(rootSemantics.properties.hint, expectedDescription);
  }
  if (spec['live'] case final String expectedLive) {
    final bool shouldBeLive =
        expectedLive == 'polite' || expectedLive == 'assertive';
    expect(rootSemantics.properties.liveRegion ?? false, shouldBeLive);
  }
  if (spec['hidden'] case final bool expectedHidden) {
    expect(rootSemantics.properties.hidden ?? false, expectedHidden);
  }
  if (spec['role'] case final String expectedRole) {
    expect(_hasRole(subtreeData, expectedRole), isTrue);
  }
  if (spec['checked'] case final bool expectedChecked) {
    final CheckedState expectedState = expectedChecked
        ? CheckedState.isTrue
        : CheckedState.isFalse;
    expect(
      subtreeData.any((d) => d.flagsCollection.isChecked == expectedState),
      isTrue,
    );
  }
}

bool _hasRole(List<SemanticsData> data, String role) => switch (role) {
  'button' => data.any((d) => d.flagsCollection.isButton),
  'textbox' => data.any((d) => d.flagsCollection.isTextField),
  'checkbox' => data.any(
    (d) => d.flagsCollection.isChecked != CheckedState.none,
  ),
  'radiogroup' => data.any((d) => d.flagsCollection.isInMutuallyExclusiveGroup),
  _ => false,
};
