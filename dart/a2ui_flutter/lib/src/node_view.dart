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
import 'package:flutter/material.dart';

import 'component_implementation.dart';
import 'component_props.dart';
import 'signal_state.dart';

/// Renders one [ComponentNode] and rebuilds when the node's own props change.
///
/// A resolved node renders through its implementation's builder, under a
/// semantics node carrying its `accessibility` label and description, if it
/// has either. A pending node renders a [LoadingPlaceholder], and an
/// unknown-type or cyclic node a short diagnostic.
class NodeView extends StatefulWidget {
  /// Creates a view of [node], keyed by its instance id.
  NodeView(this.node) : super(key: NodeKey(node.instanceId));

  /// The node to render.
  final ComponentNode<ComponentImplementation> node;

  @override
  State<NodeView> createState() => _NodeViewState();
}

class _NodeViewState extends State<NodeView> with SignalState {
  late void Function() _unsubscribe;

  void _subscribe() {
    _unsubscribe = listenAfterFirst(widget.node.props, (_) => signalChanged());
  }

  @override
  void initState() {
    super.initState();
    _subscribe();
  }

  @override
  void didUpdateWidget(NodeView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.node, widget.node)) {
      _unsubscribe();
      _subscribe();
    }
  }

  @override
  void dispose() {
    _unsubscribe();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ComponentNode<ComponentImplementation> node = widget.node;
    return switch (node.state) {
      NodeState.resolved => _buildResolved(context, node),
      NodeState.pending => const LoadingPlaceholder(),
      NodeState.unknownType => _Diagnostic(
        'Unknown component type "${node.type}"',
      ),
      NodeState.cyclic => _Diagnostic(
        'Cyclic reference to "${node.componentId}"',
      ),
    };
  }
}

/// Builds a resolved [node] through its implementation, in a [Semantics]
/// with the component's `accessibility` label and description. The
/// [Semantics] is there even without them, so adding one later keeps the
/// subtree's state.
Widget _buildResolved(
  BuildContext context,
  ComponentNode<ComponentImplementation> node,
) {
  final props = ComponentProps(node.props.peek());
  final Object? attributes = props.value('accessibility');
  String? read(String key) {
    final String? text = attributes is Map
        ? ComponentProps.asString(attributes[key])
        : null;
    return text == null || text.isEmpty ? null : text;
  }

  final String? label = read('label');
  final String? description = read('description');
  return Semantics(
    container: label != null || description != null,
    label: label,
    hint: description,
    // A type or catalog change keeps the instance id, so the implementation
    // keys the subtree.
    child: KeyedSubtree(
      key: ObjectKey(node.impl),
      child: node.impl!.builder(context, node, props, NodeView.new),
    ),
  );
}

/// A small progress indicator that stands in for a component that has not
/// arrived.
class LoadingPlaceholder extends StatelessWidget {
  const LoadingPlaceholder({super.key});

  @override
  Widget build(BuildContext context) => const Align(
    alignment: AlignmentDirectional.centerStart,
    widthFactor: 1,
    heightFactor: 1,
    child: Padding(
      padding: EdgeInsets.all(4),
      child: SizedBox.square(
        dimension: 16,
        child: CircularProgressIndicator(strokeWidth: 2),
      ),
    ),
  );
}

class _Diagnostic extends StatelessWidget {
  const _Diagnostic(this.message);

  final String message;

  @override
  Widget build(BuildContext context) => Text(
    message,
    style: TextStyle(color: Theme.of(context).colorScheme.error, fontSize: 12),
  );
}
