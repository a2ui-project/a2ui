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

void main() {
  final List<Object?> accessibilityTests = _loadYamlTests(
    '../../conformance/core/accessibility.yaml',
  );
  final List<Object?> adapterTests = _loadYamlTests(
    '../../conformance/core/adapter_conformance.yaml',
  );

  group('Accessibility Conformance (accessibility.yaml)', () {
    for (final entry in accessibilityTests) {
      final testCase = entry! as Map<String, Object?>;
      final name = testCase['name']! as String;
      testWidgets(name, (tester) async {
        await _runAccessibilityCase(tester, testCase);
      });
    }
  });

  group('Adapter Conformance (adapter_conformance.yaml)', () {
    for (final entry in adapterTests) {
      final testCase = entry! as Map<String, Object?>;
      final name = testCase['name']! as String;
      testWidgets(name, (tester) async {
        await _runAdapterCase(tester, testCase);
      });
    }
  });
}

List<Object?> _loadYamlTests(String relativePath) {
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
    functions: [
      for (final FunctionImplementation fn in v10Api.functions.values)
        if (fn.name == 'formatString') _V10FormatStringAdapter(fn) else fn,
      _IncrementCounterFunction(),
    ],
    themeSchema: v10Api.themeSchema,
    schemaId: v10Api.schemaId,
    title: v10Api.title,
    description: v10Api.description,
    protocolVersion: v10Api.protocolVersion,
    instructions: v10Api.instructions,
    definitions: v10Api.definitions,
  );
}

class _V10FormatStringAdapter extends FunctionImplementation {
  _V10FormatStringAdapter(this._delegate)
    : super(
        name: _delegate.name,
        argumentSchema: _delegate.argumentSchema,
        returnType: _delegate.returnType,
        description: _delegate.description,
      );

  final FunctionImplementation _delegate;

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    final Object? rawValue = args['value'];
    if (rawValue is String && rawValue.contains(r'${@index}')) {
      return _delegate.execute(
        {...args, 'value': rawValue.replaceAll(r'${@index}', r'${@index()}')},
        context,
        cancellationSignal,
      );
    }
    return _delegate.execute(args, context, cancellationSignal);
  }
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

class _ConformanceHarness {
  _ConformanceHarness() {
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
    );
    processor.model.onAction.subscribe(actions.add);
    processor.model.onSurfaceCreated.subscribe((created) {
      surface = created;
      created.onError.subscribe(errors.add);
    });
  }

  late final MessageProcessor<ComponentImplementation> processor;
  SurfaceModel<ComponentImplementation>? surface;
  final Map<String, ComponentNode<ComponentImplementation>> renderedNodes = {};
  final List<A2uiRendererAction> actions = [];
  final List<A2uiRendererError> errors = [];
  final List<String> openedUrls = [];
  final Map<String, Element> savedElements = {};
  final Map<String, ComponentNode<ComponentImplementation>> savedNodes = {};
  bool mounted = false;

  ComponentNode<ComponentImplementation>? get rootNode =>
      renderedNodes[surface?.rootId ?? 'root'];

  Future<void> processMessages(
    WidgetTester tester,
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
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(child: A2uiSurface(surface: surface!)),
          ),
        ),
      );
    } else {
      await tester.pump();
    }
  }

  void dispose() {
    processor.model.dispose();
  }
}

Future<void> _runAccessibilityCase(
  WidgetTester tester,
  Map<String, Object?> testCase,
) async {
  final SemanticsHandle semantics = tester.ensureSemantics();
  final harness = _ConformanceHarness();
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

Future<void> _runAdapterCase(
  WidgetTester tester,
  Map<String, Object?> testCase,
) async {
  final SemanticsHandle semantics = tester.ensureSemantics();
  final harness = _ConformanceHarness();
  try {
    final steps = testCase['steps']! as List<Object?>;
    for (final rawStep in steps) {
      final step = rawStep! as Map<String, Object?>;
      await _executeStep(tester, harness, step);
      _assertStepExpectations(tester, harness, step);
      _snapshotIdentities(tester, harness);
    }
  } finally {
    harness.dispose();
    semantics.dispose();
  }
}

Future<void> _executeStep(
  WidgetTester tester,
  _ConformanceHarness harness,
  Map<String, Object?> step,
) async {
  harness.actions.clear();
  harness.errors.clear();
  final op = step['op']! as String;
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
    (w) => w.key == NodeKey(instanceId) && w is! KeyedSubtree && w is! Flexible,
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
  final Finder scope = _findNodeView(targetId);
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
  final Finder scope = _findNodeView(targetId);
  final Finder button = find.descendant(
    of: scope,
    matching: find.byWidgetPredicate((w) => w is ButtonStyleButton),
  );
  await tester.tap(button);
  await tester.pump();
}

Future<void> _executeProgrammaticInvoke(
  WidgetTester tester,
  _ConformanceHarness harness,
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
  _ConformanceHarness harness,
  Map<String, Object?> step,
) {
  if (step['expectViewTree'] case final Map<String, Object?> expectedTree) {
    final ComponentNode<ComponentImplementation>? root = harness.rootNode;
    expect(root, isNotNull);
    _assertViewNode(tester, root!, expectedTree);
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

void _snapshotIdentities(WidgetTester tester, _ConformanceHarness harness) {
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
  _ConformanceHarness harness,
  String id,
) {
  final Map<String, (ComponentNode<ComponentImplementation>, Element?)>
  identities = _collectIdentityMap(tester, harness.rootNode);
  return identities[id]?.$1;
}

void _assertViewNode(
  WidgetTester tester,
  ComponentNode<ComponentImplementation> node,
  Map<String, Object?> spec, [
  Finder? ancestor,
]) {
  expect(node.componentId, spec['id']);
  final Finder viewFinder = _findNodeView(node.instanceId, ancestor).first;
  expect(viewFinder, findsOneWidget);
  if (spec['state'] case final String expectedState) {
    _assertNodeState(node, viewFinder, expectedState);
  }
  if (spec['type'] case final String expectedType) {
    expect(node.type, expectedType);
  }
  final props = ComponentProps(node.props.peek());
  for (final propKey in const ['text', 'value', 'badgeText']) {
    if (spec[propKey] case final Object expectedVal) {
      expect(props.value(propKey), expectedVal);
    }
  }
  _assertNodeValidation(tester, props, viewFinder, spec);
  if (spec['children'] case final List<Object?> expectedChildren) {
    final List<ComponentNode<ComponentImplementation>> actualChildren =
        _directChildren(node);
    expect(actualChildren, hasLength(expectedChildren.length));
    for (var i = 0; i < expectedChildren.length; i++) {
      _assertViewNode(
        tester,
        actualChildren[i],
        expectedChildren[i]! as Map<String, Object?>,
        viewFinder,
      );
    }
  }
}

void _assertNodeState(
  ComponentNode<ComponentImplementation> node,
  Finder viewFinder,
  String expectedState,
) {
  switch (expectedState) {
    case 'pending':
      expect(node.state, NodeState.pending);
      expect(
        find.descendant(
          of: viewFinder,
          matching: find.byType(CircularProgressIndicator),
        ),
        findsOneWidget,
      );
    case 'resolved':
      expect(node.state, NodeState.resolved);
    case 'unknown-type':
      expect(node.state, NodeState.unknownType);
      expect(
        find.descendant(
          of: viewFinder,
          matching: find.text('Unknown component type "${node.type}"'),
        ),
        findsOneWidget,
      );
    case 'cyclic':
      expect(node.state, NodeState.cyclic);
      expect(
        find.descendant(
          of: viewFinder,
          matching: find.text('Cyclic reference to "${node.componentId}"'),
        ),
        findsOneWidget,
      );
  }
}

void _assertNodeValidation(
  WidgetTester tester,
  ComponentProps props,
  Finder viewFinder,
  Map<String, Object?> spec,
) {
  if (spec['isValid'] case final bool expectedValid) {
    expect(props.isValid, expectedValid);
  }
  if (spec['validationErrors'] case final List<Object?> expectedErrors) {
    expect(props.validationErrors, hasLength(expectedErrors.length));
    for (final String actualError in props.validationErrors) {
      expect(actualError, isNotEmpty);
    }
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
