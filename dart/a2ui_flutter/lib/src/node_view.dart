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
// ignore: deprecated_member_use, see https://github.com/a2ui-project/a2ui/issues/3235
import 'package:flutter/material.dart';

import 'component_implementation.dart';
import 'component_props.dart';
import 'signal_state.dart';

/// Renders one [ComponentNode] and rebuilds when the node's own props change.
///
/// A resolved node renders through its implementation's builder, under the
/// semantics its `accessibility` attributes give. A pending, unknown-type or
/// cyclic node renders nothing: the resolver has already reported unknown
/// types and cycles to the surface, and a pending node is replaced in place
/// when its component arrives.
class NodeView extends StatefulWidget {
  /// Creates a view of [node], keyed by its instance id.
  NodeView(this.node) : super(key: NodeKey(node.instanceId));

  /// The node to render.
  final ComponentNode<ComponentImplementation> node;

  @override
  State<NodeView> createState() => _NodeViewState();
}

class _NodeViewState extends State<NodeView> with SignalState {
  late void Function() _unsubscribeProps;
  void Function()? _disposeBuildEffect;

  void _subscribe() {
    _unsubscribeProps = listenAfterFirst(
      widget.node.props,
      (_) => signalChanged(),
    );
  }

  void _unsubscribe() {
    _unsubscribeProps();
    _disposeBuildEffect?.call();
    _disposeBuildEffect = null;
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
    _disposeBuildEffect?.call();
    _disposeBuildEffect = null;
    final ComponentNode<ComponentImplementation> node = widget.node;
    if (node.state != NodeState.resolved) {
      return const SizedBox.shrink();
    }
    late final Widget built;
    var isInitialBuild = true;
    _disposeBuildEffect = effect(() {
      if (isInitialBuild) {
        built = _buildResolved(context, node);
        isInitialBuild = false;
      } else {
        signalChanged();
      }
    });
    return built;
  }
}

/// Builds a resolved [node] through its implementation, in a [Semantics]
/// with the component's `accessibility` label and description, and a live
/// region when its `live` is `polite` or `assertive`. When its `hidden` is
/// true, the component and its whole subtree are excluded from semantics.
/// The semantics widgets are there even without the attributes, so adding
/// one later keeps the subtree's state.
Widget _buildResolved(
  BuildContext context,
  ComponentNode<ComponentImplementation> node,
) {
  final props = ComponentProps(node.props.peek());
  final Object? attributes = props.value('accessibility');
  Object? read(String key) => attributes is Map ? attributes[key] : null;
  String? text(String key) {
    final String? text = ComponentProps.asString(read(key));
    return text == null || text.isEmpty ? null : text;
  }

  final String? label = text('label');
  final String? description = text('description');
  // Null rather than false, so a node that is not live adds no flag.
  final bool? live = switch (text('live')) {
    'polite' || 'assertive' => true,
    _ => null,
  };
  return ExcludeSemantics(
    excluding: ComponentProps.asBoolean(read('hidden')) ?? false,
    child: Semantics(
      container: label != null || description != null || live != null,
      label: label,
      hint: description,
      liveRegion: live,
      // A type or catalog change keeps the instance id, so the implementation
      // keys the subtree.
      child: KeyedSubtree(
        key: ObjectKey(node.impl),
        child: node.impl!.builder(context, node, props, NodeView.new),
      ),
    ),
  );
}
