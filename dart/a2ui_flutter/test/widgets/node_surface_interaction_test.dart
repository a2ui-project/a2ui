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

import 'package:a2ui_core/a2ui_core.dart' as core;
import 'package:a2ui_flutter/a2ui_flutter.dart';
// coreCatalogFor is internal; this test exercises the same wiring
// SurfaceController performs.
import 'package:a2ui_flutter/src/model/catalog.dart' show coreCatalogFor;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

const _surfaceId = 'interaction-test';
const _catalogId = 'interaction_test_catalog';

/// Calls to the `recordCall` function, in order.
final List<JsonMap> _recordedCalls = [];

/// Catalog builder invocations per component id, for the `Probe` item.
final Map<String, int> _probeBuilderCalls = {};

/// `initState` calls per component id, for the `Probe` item.
final Map<String, int> _probeInits = {};

class _RecordCall extends SynchronousClientFunction {
  const _RecordCall();

  @override
  String get name => 'recordCall';

  @override
  String get description => 'Records its arguments.';

  @override
  Schema get argumentSchema => S.object(properties: {'value': S.string()});

  @override
  ClientFunctionReturnType get returnType => ClientFunctionReturnType.empty;

  @override
  Object? executeSync(JsonMap args, ExecutionContext context) {
    _recordedCalls.add(JsonMap.of(args));
    return null;
  }
}

/// A text that counts its catalog builder calls and its mounts.
final _probe = CatalogItem(
  name: 'Probe',
  dataSchema: S.object(
    properties: {'text': A2uiSchemas.stringReference()},
    required: ['text'],
  ),
  widgetBuilder: (itemContext) {
    _probeBuilderCalls.update(
      itemContext.id,
      (int calls) => calls + 1,
      ifAbsent: () => 1,
    );
    return _ProbeText(
      componentId: itemContext.id,
      text: (itemContext.data as JsonMap)['text'] as String,
    );
  },
);

class _ProbeText extends StatefulWidget {
  const _ProbeText({required this.componentId, required this.text});

  final String componentId;
  final String text;

  @override
  State<_ProbeText> createState() => _ProbeTextState();
}

class _ProbeTextState extends State<_ProbeText> {
  @override
  void initState() {
    super.initState();
    _probeInits.update(
      widget.componentId,
      (int inits) => inits + 1,
      ifAbsent: () => 1,
    );
  }

  @override
  Widget build(BuildContext context) => Text(widget.text);
}

/// A button showing `label:count`, where count lives in its widget State.
final _counter = CatalogItem(
  name: 'Counter',
  dataSchema: S.object(
    properties: {'label': A2uiSchemas.stringReference()},
    required: ['label'],
  ),
  widgetBuilder: (itemContext) => BoundString(
    dataContext: itemContext.dataContext,
    value: (itemContext.data as JsonMap)['label'],
    builder: (context, label) => _CounterButton(label: label ?? ''),
  ),
);

class _CounterButton extends StatefulWidget {
  const _CounterButton({required this.label});

  final String label;

  @override
  State<_CounterButton> createState() => _CounterButtonState();
}

class _CounterButtonState extends State<_CounterButton> {
  int _count = 0;

  @override
  Widget build(BuildContext context) => TextButton(
    onPressed: () => setState(() => _count++),
    child: Text('${widget.label}:$_count'),
  );
}

final _catalog = Catalog(
  [
    BasicCatalogItems.text,
    BasicCatalogItems.column,
    BasicCatalogItems.button,
    BasicCatalogItems.textField,
    BasicCatalogItems.list,
    _probe,
    _counter,
  ],
  functions: const [_RecordCall()],
  catalogId: _catalogId,
);

core.SurfaceModel<core.ComponentApi> _createSurface() =>
    core.SurfaceModel<core.ComponentApi>(
      _surfaceId,
      catalog: coreCatalogFor(_catalog),
    );

Widget _host(
  core.SurfaceModel<core.ComponentApi> surface,
  List<UiEvent> events, {
  List<Object>? errors,
}) => MaterialApp(
  home: Material(
    child: NodeSurface(
      surface: surface,
      catalog: _catalog,
      onEvent: events.add,
      reportError: errors == null
          ? null
          : (Object error, StackTrace? stackTrace) => errors.add(error),
    ),
  ),
);

void _add(
  core.SurfaceModel<core.ComponentApi> surface,
  String id,
  String type,
  Map<String, Object?> properties,
) {
  surface.componentsModel.addComponent(
    core.ComponentModel(id, type, properties),
  );
}

/// The nodes currently mounted by [NodeSurface], found through the
/// `ObjectKey(node)` each node's subtree carries.
List<core.ComponentNode> _mountedNodes(WidgetTester tester) => [
  for (final Element element in tester.allElements)
    if (element.widget.key case ObjectKey(:final core.ComponentNode value))
      value,
];

core.ComponentNode _nodeFor(WidgetTester tester, String componentId) =>
    _mountedNodes(
      tester,
    ).singleWhere((core.ComponentNode node) => node.componentId == componentId);

TextEditingController _fieldController(WidgetTester tester) =>
    tester.widget<TextField>(find.byType(TextField)).controller!;

core.AgentToRendererMessage _message(Map<String, Object?> body) =>
    core.AgentToRendererMessage.fromJson({'version': 'v0.9', ...body});

/// A controller holding surface [_surfaceId] with [components], created
/// through messages.
SurfaceController _controllerWith(List<Map<String, Object?>> components) {
  final controller = SurfaceController(catalogs: [_catalog]);
  controller.handleMessage(
    _message({
      'createSurface': {'surfaceId': _surfaceId, 'catalogId': _catalogId},
    }),
  );
  controller.handleMessage(
    _message({
      'updateComponents': {'surfaceId': _surfaceId, 'components': components},
    }),
  );
  return controller;
}

/// The error payloads [controller] sends to the agent, as they arrive.
List<String> _errorSubmissions(SurfaceController controller) {
  final submitted = <String>[];
  controller.onSubmit.listen((ChatMessage message) {
    for (final UiInteractionPart part in message.parts.uiInteractionParts) {
      if (part.interaction.contains('"error"')) {
        submitted.add(part.interaction);
      }
    }
  });
  return submitted;
}

core.A2uiClientError _clientError(String message) => core.A2uiClientError(
  code: 'UNKNOWN_COMPONENT_TYPE',
  surfaceId: _surfaceId,
  message: message,
);

void main() {
  setUp(() {
    _recordedCalls.clear();
    _probeBuilderCalls.clear();
    _probeInits.clear();
  });

  group('write-back', () {
    testWidgets('typing writes the bound path and survives a rebuild', (
      WidgetTester tester,
    ) async {
      final core.SurfaceModel<core.ComponentApi> surface = _createSurface();
      surface.dataModel.set('/form/name', 'Ada');
      _add(surface, 'root', 'Column', {
        'children': ['field', 'echo'],
      });
      _add(surface, 'field', 'TextField', {
        'label': 'Name',
        'value': {'path': '/form/name'},
      });
      _add(surface, 'echo', 'Text', {
        'text': {'path': '/form/name'},
      });

      await tester.pumpWidget(_host(surface, []));
      await tester.pumpAndSettle();
      expect(_fieldController(tester).text, 'Ada');

      await tester.enterText(find.byType(TextField), 'Grace');
      await tester.pumpAndSettle();

      expect(surface.dataModel.get('/form/name'), 'Grace');
      expect(find.text('Grace'), findsNWidgets(2));
      final Object? resolvedValue = _nodeFor(
        tester,
        'field',
      ).props.value['value'];
      expect(resolvedValue, isA<core.WritableBinding<Object?>>());
      expect((resolvedValue! as core.WritableBinding<Object?>).value, 'Grace');

      // A props change on the parent rebuilds the field's subtree.
      surface.componentsModel.get('root')!.properties = {
        'children': ['field', 'echo'],
        'align': 'start',
      };
      await tester.pumpAndSettle();
      expect(_fieldController(tester).text, 'Grace');
    });

    testWidgets('a node binding set reaches the field', (
      WidgetTester tester,
    ) async {
      final core.SurfaceModel<core.ComponentApi> surface = _createSurface();
      surface.dataModel.set('/form/name', 'Ada');
      _add(surface, 'root', 'TextField', {
        'label': 'Name',
        'value': {'path': '/form/name'},
      });

      await tester.pumpWidget(_host(surface, []));
      await tester.pumpAndSettle();

      final binding =
          _nodeFor(tester, 'root').props.value['value']!
              as core.WritableBinding<Object?>;
      expect(binding.path, '/form/name');
      binding.set('Linus');
      await tester.pumpAndSettle();

      expect(surface.dataModel.get('/form/name'), 'Linus');
      expect(_fieldController(tester).text, 'Linus');
    });

    testWidgets('an external data change replaces the text and moves the '
        'cursor to the end', (WidgetTester tester) async {
      final core.SurfaceModel<core.ComponentApi> surface = _createSurface();
      surface.dataModel.set('/form/name', 'Grace');
      _add(surface, 'root', 'TextField', {
        'label': 'Name',
        'value': {'path': '/form/name'},
      });

      await tester.pumpWidget(_host(surface, []));
      await tester.pumpAndSettle();
      await tester.showKeyboard(find.byType(TextField));
      _fieldController(tester).selection = const TextSelection.collapsed(
        offset: 2,
      );
      await tester.pump();

      surface.dataModel.set('/form/name', 'Grace Hopper');
      await tester.pumpAndSettle();

      final TextEditingController controller = _fieldController(tester);
      expect(controller.text, 'Grace Hopper');
      expect(controller.selection, const TextSelection.collapsed(offset: 12));
    });
  });

  group('actions', () {
    testWidgets('an event action emits once with its context resolved at '
        'dispatch', (WidgetTester tester) async {
      final core.SurfaceModel<core.ComponentApi> surface = _createSurface();
      final coreActions = <core.A2uiClientAction>[];
      surface.onAction.addListener(coreActions.add);
      final events = <UiEvent>[];
      surface.dataModel.set('/user/name', 'Ada');
      _add(surface, 'root', 'Button', {
        'child': 'label',
        'action': {
          'event': {
            'name': 'submit',
            'context': {
              'who': {'path': '/user/name'},
              'count': 3,
            },
          },
        },
      });
      _add(surface, 'label', 'Text', {'text': 'Send'});

      await tester.pumpWidget(_host(surface, events));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Send'));
      await tester.pumpAndSettle();
      surface.dataModel.set('/user/name', 'Grace');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Send'));
      await tester.pumpAndSettle();

      expect(events, hasLength(2));
      final first = UserActionEvent.fromMap(events[0].toMap());
      final second = UserActionEvent.fromMap(events[1].toMap());
      expect(first.name, 'submit');
      expect(first.sourceComponentId, 'root');
      expect(first.surfaceId, _surfaceId);
      expect(first.context, {'who': 'Ada', 'count': 3});
      expect(second.context, {'who': 'Grace', 'count': 3});
      // The view dispatches through onEvent, not through the node's action
      // closure, so the core surface emits nothing.
      expect(coreActions, isEmpty);

      final action =
          _nodeFor(tester, 'root').props.value['action']!
              as Future<void> Function();
      await action();
      expect(coreActions, hasLength(1));
      expect(coreActions.single.name, 'submit');
      expect(coreActions.single.sourceComponentId, 'root');
      expect(coreActions.single.context, {'who': 'Grace', 'count': 3});
    });

    testWidgets('a functionCall action runs the catalog function and emits '
        'no event', (WidgetTester tester) async {
      final core.SurfaceModel<core.ComponentApi> surface = _createSurface();
      final coreActions = <core.A2uiClientAction>[];
      surface.onAction.addListener(coreActions.add);
      final events = <UiEvent>[];
      surface.dataModel.set('/user/name', 'Ada');
      _add(surface, 'root', 'Button', {
        'child': 'label',
        'action': {
          'functionCall': {
            'call': 'recordCall',
            'args': {
              'value': {'path': '/user/name'},
            },
          },
        },
      });
      _add(surface, 'label', 'Text', {'text': 'Record'});

      await tester.pumpWidget(_host(surface, events));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Record'));
      await tester.pumpAndSettle();

      expect(_recordedCalls, [
        {'value': 'Ada'},
      ]);
      expect(events, isEmpty);
      expect(coreActions, isEmpty);
    });

    testWidgets('an action from a template row resolves relative paths in '
        'its row scope', (WidgetTester tester) async {
      final core.SurfaceModel<core.ComponentApi> surface = _createSurface();
      final events = <UiEvent>[];
      surface.dataModel.set('/items', <Object?>[
        {'name': 'A', 'id': 1},
        {'name': 'B', 'id': 2},
      ]);
      _add(surface, 'root', 'List', {
        'children': {'componentId': 'pick', 'path': '/items'},
      });
      _add(surface, 'pick', 'Button', {
        'child': 'pickLabel',
        'action': {
          'event': {
            'name': 'pick',
            'context': {
              'id': {'path': 'id'},
            },
          },
        },
      });
      _add(surface, 'pickLabel', 'Text', {
        'text': {'path': 'name'},
      });

      await tester.pumpWidget(_host(surface, events));
      await tester.pumpAndSettle();
      await tester.tap(find.text('B'));
      await tester.pumpAndSettle();

      expect(events, hasLength(1));
      final pick = UserActionEvent.fromMap(events.single.toMap());
      expect(pick.sourceComponentId, 'pick');
      expect(pick.context, {'id': 2});
    });
  });

  group('template list', () {
    testWidgets('appending keeps row State; removing the first item keeps '
        'State by position', (WidgetTester tester) async {
      final core.SurfaceModel<core.ComponentApi> surface = _createSurface();
      surface.dataModel.set('/items', <Object?>[
        {'name': 'A'},
        {'name': 'B'},
      ]);
      _add(surface, 'root', 'List', {
        'children': {'componentId': 'row', 'path': '/items'},
      });
      _add(surface, 'row', 'Counter', {
        'label': {'path': 'name'},
      });

      await tester.pumpWidget(_host(surface, []));
      await tester.pumpAndSettle();
      expect(find.byType(TextButton), findsNWidgets(2));

      await tester.tap(find.text('A:0'));
      await tester.pump();
      await tester.tap(find.text('A:1'));
      await tester.pump();
      await tester.tap(find.text('B:0'));
      await tester.pumpAndSettle();
      expect(find.text('A:2'), findsOneWidget);
      expect(find.text('B:1'), findsOneWidget);
      final List<core.ComponentNode> before = _mountedNodes(tester);

      surface.dataModel.set('/items/2', {'name': 'C'});
      await tester.pumpAndSettle();

      expect(find.byType(TextButton), findsNWidgets(3));
      expect(find.text('A:2'), findsOneWidget);
      expect(find.text('B:1'), findsOneWidget);
      expect(find.text('C:0'), findsOneWidget);
      expect(_mountedNodes(tester), containsAllInOrder(before));

      surface.dataModel.set('/items', <Object?>[
        {'name': 'B'},
        {'name': 'C'},
      ]);
      await tester.pumpAndSettle();

      // Rows are identified by index: the rows at positions 0 and 1 keep
      // their State and show the shifted data.
      expect(find.byType(TextButton), findsNWidgets(2));
      expect(find.text('B:2'), findsOneWidget);
      expect(find.text('C:1'), findsOneWidget);
    });
  });

  group('progressive arrival', () {
    testWidgets('a late child replaces its placeholder without remounting '
        'siblings', (WidgetTester tester) async {
      final core.SurfaceModel<core.ComponentApi> surface = _createSurface();
      _add(surface, 'root', 'Column', {
        'children': ['first', 'late', 'last'],
      });
      _add(surface, 'first', 'Probe', {'text': 'First'});
      _add(surface, 'last', 'Probe', {'text': 'Last'});

      await tester.pumpWidget(_host(surface, []));
      await tester.pumpAndSettle();
      expect(find.text('First'), findsOneWidget);
      expect(find.text('Last'), findsOneWidget);
      expect(
        _mountedNodes(tester).where((core.ComponentNode node) {
          return node.isPlaceholder;
        }),
        hasLength(1),
      );
      expect(_probeBuilderCalls, {'first': 1, 'last': 1});

      _add(surface, 'late', 'Probe', {'text': 'Late'});
      await tester.pumpAndSettle();

      expect(find.text('Late'), findsOneWidget);
      expect(
        _mountedNodes(tester).where((core.ComponentNode node) {
          return node.isPlaceholder;
        }),
        isEmpty,
      );
      expect(_probeInits, {'first': 1, 'last': 1, 'late': 1});
      // The parent's props re-emit with the upgraded node, so the Column and
      // every sibling's catalog builder run once more.
      expect(_probeBuilderCalls, {'first': 2, 'last': 2, 'late': 1});
    });
  });

  group('fallback states', () {
    testWidgets('an unknown type renders the fallback and is dispatched once', (
      WidgetTester tester,
    ) async {
      final core.SurfaceModel<core.ComponentApi> surface = _createSurface();
      final errors = <Object>[];
      final coreErrors = <core.A2uiClientError>[];
      surface.onError.addListener(coreErrors.add);
      _add(surface, 'root', 'Column', {
        'children': ['known', 'mystery'],
      });
      _add(surface, 'known', 'Text', {'text': 'Known'});
      _add(surface, 'mystery', 'Mystery', {'text': 'Hidden'});

      await tester.pumpWidget(_host(surface, [], errors: errors));
      await tester.pumpAndSettle();

      expect(find.text('Known'), findsOneWidget);
      expect(find.byType(FallbackWidget), findsOneWidget);
      expect(
        tester.widget<FallbackWidget>(find.byType(FallbackWidget)).error,
        isA<CatalogItemNotFoundException>().having(
          (CatalogItemNotFoundException e) => e.widgetType,
          'widgetType',
          'Mystery',
        ),
      );
      expect(_nodeFor(tester, 'mystery').state, core.NodeState.unknownType);
      expect(coreErrors.map((core.A2uiClientError e) => e.code), [
        'UNKNOWN_COMPONENT_TYPE',
      ]);
      expect(errors, isEmpty);

      // A rebuild of the parent reports nothing new.
      surface.componentsModel.get('known')!.properties = {'text': 'Again'};
      await tester.pumpAndSettle();
      expect(find.text('Again'), findsOneWidget);
      expect(coreErrors, hasLength(1));
      expect(errors, isEmpty);
    });

    testWidgets('a cycle renders the fallback and is dispatched once', (
      WidgetTester tester,
    ) async {
      final core.SurfaceModel<core.ComponentApi> surface = _createSurface();
      final errors = <Object>[];
      final coreErrors = <core.A2uiClientError>[];
      surface.onError.addListener(coreErrors.add);
      _add(surface, 'root', 'Column', {
        'children': ['label', 'loop'],
      });
      _add(surface, 'label', 'Text', {'text': 'Label'});
      _add(surface, 'loop', 'Column', {
        'children': ['root'],
      });

      await tester.pumpWidget(_host(surface, [], errors: errors));
      await tester.pumpAndSettle();

      expect(find.text('Label'), findsOneWidget);
      expect(find.byType(FallbackWidget), findsOneWidget);
      expect(
        _mountedNodes(tester).where((core.ComponentNode node) {
          return node.state == core.NodeState.cyclic;
        }),
        hasLength(1),
      );
      expect(coreErrors.map((core.A2uiClientError e) => e.code), [
        'CYCLIC_REFERENCE',
      ]);
      expect(errors, isEmpty);
    });

    testWidgets('a pending child renders empty, reports nothing, and is '
        'replaced when its definition arrives', (WidgetTester tester) async {
      final core.SurfaceModel<core.ComponentApi> surface = _createSurface();
      final errors = <Object>[];
      _add(surface, 'root', 'Column', {
        'children': ['first', 'late'],
      });
      _add(surface, 'first', 'Text', {'text': 'First'});

      await tester.pumpWidget(_host(surface, [], errors: errors));
      await tester.pumpAndSettle();

      expect(find.text('First'), findsOneWidget);
      expect(find.byType(FallbackWidget), findsNothing);
      expect(_nodeFor(tester, 'late').state, core.NodeState.pending);
      expect(errors, isEmpty);

      _add(surface, 'late', 'Text', {'text': 'Late'});
      await tester.pumpAndSettle();

      expect(find.text('Late'), findsOneWidget);
      expect(_nodeFor(tester, 'late').state, core.NodeState.resolved);
      expect(find.byType(FallbackWidget), findsNothing);
      expect(errors, isEmpty);
    });

    testWidgets('an expression error is not sent to the agent', (
      WidgetTester tester,
    ) async {
      final SurfaceController controller = _controllerWith([
        {
          'id': 'root',
          'component': 'Column',
          'children': ['expression'],
        },
      ]);
      addTearDown(controller.dispose);
      final List<String> submitted = _errorSubmissions(controller);
      await tester.pump();
      final core.SurfaceModel<core.ComponentApi> surface = controller
          .liveSurfaceFor(_surfaceId)!;
      final coreErrors = <core.A2uiClientError>[];
      surface.onError.addListener(coreErrors.add);
      _add(surface, 'expression', 'Text', {
        'text': {'call': 'missingFunction', 'args': <String, Object?>{}},
      });

      await tester.pumpWidget(_controllerApp(controller));
      await tester.pumpAndSettle();

      expect(
        coreErrors.map((core.A2uiClientError e) => e.code),
        contains('EXPRESSION_ERROR'),
      );
      expect(submitted, isEmpty);
    });

    testWidgets('unmounting stops forwarding the surface errors', (
      WidgetTester tester,
    ) async {
      final core.SurfaceModel<core.ComponentApi> surface = _createSurface();
      final errors = <Object>[];
      _add(surface, 'root', 'Text', {'text': 'Root'});

      await tester.pumpWidget(_host(surface, [], errors: errors));
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox());

      await surface.dispatchError(
        core.A2uiClientError(
          code: 'UNKNOWN_COMPONENT_TYPE',
          surfaceId: _surfaceId,
          message: 'After unmount.',
        ),
      );
      _add(surface, 'mystery', 'Mystery', {});
      surface.componentsModel.get('root')!.properties = {'text': 'Changed'};
      await tester.pump();

      expect(tester.takeException(), isNull);
      expect(errors, isEmpty);
      surface.dispose();
    });

    testWidgets('a forwarded unknown-type error reaches the agent as '
        "Surface's does", (WidgetTester tester) async {
      final controller = SurfaceController(catalogs: [_catalog]);
      addTearDown(controller.dispose);
      final submitted = <String>[];
      controller.onSubmit.listen((ChatMessage message) {
        submitted.addAll(
          message.parts.uiInteractionParts.map(
            (UiInteractionPart part) => part.interaction,
          ),
        );
      });

      // What Surface reports for an unknown type, then what NodeSurface
      // forwards from the resolver.
      controller.reportError(
        const CatalogItemNotFoundException('Mystery', catalogId: _catalogId),
        null,
      );
      controller.reportError(
        core.A2uiClientError(
          code: 'UNKNOWN_COMPONENT_TYPE',
          surfaceId: _surfaceId,
          message: "Component 'mystery' has type 'Mystery'.",
        ),
        null,
      );
      await tester.pump();

      expect(submitted, hasLength(2));
      expect(submitted.last, submitted.first);
    });
  });

  group('error routing', () {
    testWidgets('SurfaceController sends a surface diagnostic to the agent '
        'and stops when the surface is deleted', (WidgetTester tester) async {
      final SurfaceController controller = _controllerWith([
        {'id': 'root', 'component': 'Text', 'text': 'Root'},
      ]);
      addTearDown(controller.dispose);
      final List<String> submitted = _errorSubmissions(controller);
      await tester.pump();
      final core.SurfaceModel<core.ComponentApi> surface = controller
          .liveSurfaceFor(_surfaceId)!;

      await surface.dispatchError(_clientError('Before deletion.'));
      await tester.pump();
      expect(submitted, hasLength(1));

      controller.handleMessage(
        _message({
          'deleteSurface': {'surfaceId': _surfaceId},
        }),
      );
      await surface.dispatchError(_clientError('After deletion.'));
      await tester.pump();
      expect(submitted, hasLength(1));
    });

    testWidgets('two NodeSurfaces on one surface report a diagnostic once '
        'per resolver', (WidgetTester tester) async {
      final SurfaceController controller = _controllerWith([
        {
          'id': 'root',
          'component': 'Column',
          'children': ['known', 'mystery'],
        },
        {'id': 'known', 'component': 'Text', 'text': 'Known'},
      ]);
      addTearDown(controller.dispose);
      final List<String> submitted = _errorSubmissions(controller);
      await tester.pump();
      expect(submitted, isEmpty);
      final core.SurfaceModel<core.ComponentApi> surface = controller
          .liveSurfaceFor(_surfaceId)!;
      _add(surface, 'mystery', 'Mystery', {});

      await tester.pumpWidget(
        MaterialApp(
          home: Material(
            child: SingleChildScrollView(
              child: Column(
                children: [
                  _ControllerHost(
                    controller: controller,
                    surfaceId: _surfaceId,
                  ),
                  _ControllerHost(
                    controller: controller,
                    surfaceId: _surfaceId,
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(FallbackWidget), findsNWidgets(2));
      expect(submitted, hasLength(2));

      _add(surface, 'mystery2', 'Mystery', {});
      surface.componentsModel.get('root')!.properties = {
        'children': ['known', 'mystery', 'mystery2'],
      };
      await tester.pumpAndSettle();
      expect(find.byType(FallbackWidget), findsNWidgets(4));
      expect(submitted, hasLength(4));
    });

    testWidgets('re-keying a NodeSurface reports only the fresh resolver\'s '
        'diagnostic', (WidgetTester tester) async {
      final SurfaceController controller = _controllerWith([
        {
          'id': 'root',
          'component': 'Column',
          'children': ['known', 'mystery'],
        },
        {'id': 'known', 'component': 'Text', 'text': 'Known'},
      ]);
      addTearDown(controller.dispose);
      final List<String> submitted = _errorSubmissions(controller);
      await tester.pump();
      _add(controller.liveSurfaceFor(_surfaceId)!, 'mystery', 'Mystery', {});

      Widget keyed(String key) => MaterialApp(
        home: Material(
          child: KeyedSubtree(
            key: ValueKey<String>(key),
            child: _ControllerHost(
              controller: controller,
              surfaceId: _surfaceId,
            ),
          ),
        ),
      );

      await tester.pumpWidget(keyed('a'));
      await tester.pumpAndSettle();
      expect(submitted, hasLength(1));

      await tester.pumpWidget(keyed('b'));
      await tester.pumpAndSettle();
      expect(find.byType(FallbackWidget), findsOneWidget);
      expect(submitted, hasLength(2));
    });
  });

  group('teardown', () {
    testWidgets('deleting the surface through SurfaceController tears the '
        'tree down', (WidgetTester tester) async {
      final controller = SurfaceController(catalogs: [_catalog]);
      addTearDown(controller.dispose);
      final errors = <Object>[];

      controller.handleMessage(
        _message({
          'createSurface': {'surfaceId': _surfaceId, 'catalogId': _catalogId},
        }),
      );
      controller.handleMessage(
        _message({
          'updateDataModel': {
            'surfaceId': _surfaceId,
            'path': '/',
            'value': {
              'name': 'Ada',
              'items': [
                {'name': 'A'},
                {'name': 'B'},
              ],
            },
          },
        }),
      );
      controller.handleMessage(
        _message({
          'updateComponents': {
            'surfaceId': _surfaceId,
            'components': [
              {
                'id': 'root',
                'component': 'Column',
                'children': ['field', 'rows', 'pending'],
              },
              {
                'id': 'field',
                'component': 'TextField',
                'label': 'Name',
                'value': {'path': '/name'},
              },
              {
                'id': 'rows',
                'component': 'List',
                'children': {'componentId': 'row', 'path': '/items'},
              },
              {
                'id': 'row',
                'component': 'Counter',
                'label': {'path': 'name'},
              },
            ],
          },
        }),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Material(
            child: _ControllerHost(
              controller: controller,
              surfaceId: _surfaceId,
              onError: errors.add,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(NodeSurface), findsOneWidget);
      await tester.enterText(find.byType(TextField), 'Grace');
      await tester.tap(find.text('A:0'));
      await tester.pumpAndSettle();
      final core.SurfaceModel<core.ComponentApi> surface = controller
          .liveSurfaceFor(_surfaceId)!;
      expect(surface.dataModel.get('/name'), 'Grace');

      final List<core.ComponentNode> nodes = _mountedNodes(tester);
      expect(nodes, hasLength(6));
      expect(nodes.where((core.ComponentNode n) => n.disposed), isEmpty);

      controller.handleMessage(
        _message({
          'deleteSurface': {'surfaceId': _surfaceId},
        }),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(errors, isEmpty);
      expect(find.byType(NodeSurface), findsNothing);
      expect(nodes.where((core.ComponentNode n) => !n.disposed), isEmpty);
    });

    testWidgets('unmounting disposes the nodes and stops listening to a '
        'surface that stays alive', (WidgetTester tester) async {
      final core.SurfaceModel<core.ComponentApi> surface = _createSurface();
      surface.dataModel.set('/items', <Object?>[
        {'name': 'A'},
      ]);
      _add(surface, 'root', 'Column', {
        'children': ['probe', 'rows', 'pending'],
      });
      _add(surface, 'probe', 'Probe', {'text': 'Probe'});
      _add(surface, 'rows', 'List', {
        'children': {'componentId': 'row', 'path': '/items'},
      });
      _add(surface, 'row', 'Counter', {
        'label': {'path': 'name'},
      });

      await tester.pumpWidget(_host(surface, []));
      await tester.pumpAndSettle();
      final List<core.ComponentNode> nodes = _mountedNodes(tester);
      expect(nodes, hasLength(5));

      await tester.pumpWidget(const SizedBox());
      expect(nodes.where((core.ComponentNode n) => !n.disposed), isEmpty);

      final Map<String, int> buildsAtUnmount = Map.of(_probeBuilderCalls);
      surface.dataModel.set('/items', <Object?>[
        {'name': 'A'},
        {'name': 'B'},
      ]);
      _add(surface, 'pending', 'Probe', {'text': 'Pending'});
      surface.componentsModel.get('probe')!.properties = {'text': 'Changed'};
      await tester.pump();

      expect(tester.takeException(), isNull);
      expect(_probeBuilderCalls, buildsAtUnmount);
      surface.dispose();
    });
  });
}

/// An app hosting [controller]'s surface [_surfaceId].
Widget _controllerApp(SurfaceController controller) => MaterialApp(
  home: Material(
    child: _ControllerHost(controller: controller, surfaceId: _surfaceId),
  ),
);

/// Hosts a controller's surface the way the example app does under
/// `--dart-define=nodes=true`.
class _ControllerHost extends StatelessWidget {
  const _ControllerHost({
    required this.controller,
    required this.surfaceId,
    this.onError,
  });

  final SurfaceController controller;
  final String surfaceId;

  /// Receives NodeSurface's reports in place of the controller.
  final void Function(Object error)? onError;

  @override
  Widget build(BuildContext context) {
    final SurfaceContext surfaceContext = controller.contextFor(surfaceId);
    return ValueListenableBuilder<SurfaceDefinition?>(
      valueListenable: surfaceContext.definition,
      builder: (context, definition, _) {
        final core.SurfaceModel<core.ComponentApi>? surface = controller
            .liveSurfaceFor(surfaceId);
        final Catalog? catalog = surfaceContext.catalog;
        if (definition == null || surface == null || catalog == null) {
          return const SizedBox.shrink();
        }
        return NodeSurface(
          surface: surface,
          catalog: catalog,
          onEvent: surfaceContext.handleUiEvent,
          reportError: onError == null
              ? surfaceContext.reportError
              : (Object error, StackTrace? stackTrace) => onError!(error),
        );
      },
    );
  }
}
