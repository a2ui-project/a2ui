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
import 'package:flutter/widgets.dart';

import '../catalog/component_implementation.dart';
import '../surface/surface_scope.dart';
import 'fallback_views.dart';

/// Recursive node dispatcher widget.
///
/// Subscribes to the reactive [ComponentNode.props], dispatches based on
/// [ComponentNode.state], and delegates rendering to the catalog's
/// [FlutterComponentImplementation].
class NodeView extends StatefulWidget {
  final ComponentNode<FlutterComponentImplementation> node;

  const NodeView({super.key, required this.node});

  @override
  State<NodeView> createState() => _NodeViewState();
}

class _NodeViewState extends State<NodeView> {
  void Function()? _unsubscribe;

  @override
  void initState() {
    super.initState();
    _subscribe();
  }

  @override
  void didUpdateWidget(NodeView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.node != widget.node) {
      _unsubscribe?.call();
      _subscribe();
    }
  }

  void _subscribe() {
    _unsubscribe = widget.node.props.subscribe((_) {
      if (mounted) {
        setState(() {});
      }
    });
  }

  @override
  void dispose() {
    _unsubscribe?.call();
    _unsubscribe = null;
    super.dispose();
  }

  Widget _buildChild(ComponentNode<FlutterComponentImplementation> child) {
    return NodeView(key: ValueKey(child.instanceId), node: child);
  }

  @override
  Widget build(BuildContext context) {
    final ComponentNode<FlutterComponentImplementation> node = widget.node;

    switch (node.state) {
      case NodeState.pending:
        return A2uiLoadingPlaceholder(componentId: node.componentId);

      case NodeState.unknownType:
        return A2uiUnknownTypeWarning(
          type: node.type,
          componentId: node.componentId,
        );

      case NodeState.cyclic:
        return A2uiCyclicReferenceIndicator(componentId: node.componentId);

      case NodeState.resolved:
        final FlutterComponentImplementation? impl =
            node.impl ??
            A2uiSurfaceScope.maybeOf(
              context,
            )?.surface.catalog.components[node.type];

        if (impl == null) {
          return A2uiUnknownTypeWarning(
            type: node.type,
            componentId: node.componentId,
          );
        }

        return impl.builder(context, node, _buildChild);
    }
  }
}
