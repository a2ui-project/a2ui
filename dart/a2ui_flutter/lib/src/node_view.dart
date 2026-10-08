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
/// A resolved node renders through its implementation's builder. A pending
/// node renders a [LoadingPlaceholder], and an unknown-type or cyclic node
/// a short diagnostic.
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
      // A type change keeps the instance id, so the type keys the subtree.
      NodeState.resolved => KeyedSubtree(
        key: _TypeKey(node.type),
        child: node.impl!.builder(
          context,
          node,
          ComponentProps(node.props.peek()),
          NodeView.new,
        ),
      ),
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

class _TypeKey extends ValueKey<String> {
  const _TypeKey(super.value);
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
