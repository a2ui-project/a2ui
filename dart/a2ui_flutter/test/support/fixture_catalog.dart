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
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/material.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

/// The id of [fixtureCatalog].
const String fixtureCatalogId = 'https://a2ui.org/test/fixture_catalog.json';

/// What the fixture components and functions record.
class FixtureLog {
  /// Component ids, in the order their builders ran.
  final List<String> builds = [];

  /// The node each builder last ran for, by instance id.
  final Map<String, ComponentNode<ComponentImplementation>> nodes = {};

  /// Instance ids of `Probe` states, in the order they were created.
  final List<String> probeStates = [];

  /// Arguments of each `record` call.
  final List<Map<String, Object?>> calls = [];
}

/// A catalog of minimal components for adapter tests:
///
/// - `Text`: `text` (DynamicString).
/// - `Column`: `children` (ChildList).
/// - `Box`: `child` (ComponentId).
/// - `Button`: `child` (ComponentId), `action` (Action).
/// - `Input`: `value` (DynamicString), written back on each edit.
/// - `Probe`: `label` (DynamicString), rendered by a stateful widget that
///   logs its state's creation.
/// - `OtherProbe`: the same as `Probe`, under another type name.
///
/// It declares one function, `record`, which logs its arguments.
WidgetCatalog fixtureCatalog([FixtureLog? log]) {
  ComponentImplementation component(
    String name,
    Map<String, Schema> properties,
    ComponentWidgetBuilder builder,
  ) => ComponentImplementation(
    name: name,
    schema: Schema.object(properties: properties),
    builder: (context, node, props, buildChild) {
      log?.builds.add(node.componentId);
      log?.nodes[node.instanceId] = node;
      return builder(context, node, props, buildChild);
    },
  );

  return WidgetCatalog(
    id: fixtureCatalogId,
    components: [
      component(
        'Text',
        {'text': CommonSchemas.dynamicString},
        (context, node, props, buildChild) => Text(props.string('text') ?? ''),
      ),
      component(
        'Column',
        {'children': CommonSchemas.childList},
        (context, node, props, buildChild) => Column(
          mainAxisSize: MainAxisSize.min,
          children: props.children('children').map(buildChild).toList(),
        ),
      ),
      component('Box', {'child': CommonSchemas.componentId}, (
        context,
        node,
        props,
        buildChild,
      ) {
        final ComponentNode<ComponentImplementation>? child = props.child(
          'child',
        );
        return child == null ? const SizedBox.shrink() : buildChild(child);
      }),
      component(
        'Button',
        {'child': CommonSchemas.componentId, 'action': CommonSchemas.action},
        (context, node, props, buildChild) {
          final ComponentNode<ComponentImplementation>? child = props.child(
            'child',
          );
          return TextButton(
            onPressed: props.action('action'),
            child: child == null ? const SizedBox.shrink() : buildChild(child),
          );
        },
      ),
      component(
        'Input',
        {'value': CommonSchemas.dynamicString},
        (context, node, props, buildChild) => _Input(
          value: props.string('value') ?? '',
          onChanged: props.writable('value')?.set,
        ),
      ),
      for (final String name in ['Probe', 'OtherProbe'])
        component(
          name,
          {'label': CommonSchemas.dynamicString},
          (context, node, props, buildChild) => _Probe(
            instanceId: node.instanceId,
            label: props.string('label') ?? '',
            log: log,
          ),
        ),
    ],
    functions: [_RecordFunction(log)],
  );
}

class _RecordFunction extends FunctionImplementation {
  _RecordFunction(this.log)
    : super(
        name: 'record',
        returnType: A2uiReturnType.void_,
        argumentSchema: Schema.object(
          properties: {'value': CommonSchemas.dynamicString},
        ),
      );

  final FixtureLog? log;

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    log?.calls.add(Map<String, Object?>.of(args));
    return null;
  }
}

class _Input extends StatefulWidget {
  const _Input({required this.value, required this.onChanged});

  final String value;
  final void Function(Object? value)? onChanged;

  @override
  State<_Input> createState() => _InputState();
}

class _InputState extends State<_Input> {
  late final TextEditingController _controller = TextEditingController(
    text: widget.value,
  );

  @override
  void didUpdateWidget(_Input oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.value != _controller.text) _controller.text = widget.value;
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) =>
      TextField(controller: _controller, onChanged: widget.onChanged);
}

class _Probe extends StatefulWidget {
  const _Probe({required this.instanceId, required this.label, this.log});

  final String instanceId;
  final String label;
  final FixtureLog? log;

  @override
  State<_Probe> createState() => _ProbeState();
}

class _ProbeState extends State<_Probe> {
  @override
  void initState() {
    super.initState();
    widget.log?.probeStates.add(widget.instanceId);
  }

  @override
  Widget build(BuildContext context) => Text(widget.label);
}
