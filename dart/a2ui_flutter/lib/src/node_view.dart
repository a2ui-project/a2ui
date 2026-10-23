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
/// semantics its `accessibility` attributes give. A pending node renders a
/// [LoadingPlaceholder], and an unknown-type or cyclic node a short
/// diagnostic.
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
  final List<void Function()> _accessibilityUnsubscribes = [];

  void _subscribe() {
    _unsubscribe = listenAfterFirst(widget.node.props, (_) {
      _subscribeAccessibility();
      signalChanged();
    });
    _subscribeAccessibility();
  }

  void _subscribeAccessibility() {
    _unsubscribeAccessibility();
    final ComponentContext? context = widget.node.context;
    final Object? attributes = ComponentProps(widget.node.props.peek())
        .value('accessibility');
    if (context == null || attributes is! Map) return;
    for (final Object? raw in attributes.values) {
      final Object? unwrapped = ComponentProps.unwrap(raw);
      if (unwrapped is Map) {
        _accessibilityUnsubscribes.add(
          listenAfterFirst(
            context.dataContext.resolveSignal(unwrapped),
            (_) => signalChanged(),
          ),
        );
      }
    }
  }

  void _unsubscribeAccessibility() {
    for (final void Function() dispose in _accessibilityUnsubscribes) {
      dispose();
    }
    _accessibilityUnsubscribes.clear();
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
      _unsubscribeAccessibility();
      _unsubscribe();
      _subscribe();
    }
  }

  @override
  void dispose() {
    _unsubscribeAccessibility();
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
  final String? label = _readAccessibilityString(node, attributes, 'label');
  final String? description = _readAccessibilityString(
    node,
    attributes,
    'description',
  );
  // Null rather than false, so a node that is not live adds no flag.
  final bool? live = switch (_readAccessibilityString(
    node,
    attributes,
    'live',
  )) {
    'polite' || 'assertive' => true,
    _ => null,
  };
  final bool hidden = _readAccessibilityBool(node, attributes, 'hidden');
  return ExcludeSemantics(
    excluding: hidden,
    child: Semantics(
      container: label != null || description != null || live != null || hidden,
      label: label,
      hint: description,
      liveRegion: live,
      hidden: hidden ? true : null,
      // A type or catalog change keeps the instance id, so the implementation
      // keys the subtree.
      child: KeyedSubtree(
        key: ObjectKey(node.impl),
        child: node.impl!.builder(context, node, props, NodeView.new),
      ),
    ),
  );
}

Object? _resolveAccessibilityValue(
  ComponentNode<ComponentImplementation> node,
  Object? raw,
) {
  final Object? unwrapped = ComponentProps.unwrap(raw);
  final ComponentContext? context = node.context;
  if (unwrapped is Map && context != null) {
    return context.dataContext.resolveDynamicValue(unwrapped);
  }
  return unwrapped;
}

String? _readAccessibilityString(
  ComponentNode<ComponentImplementation> node,
  Object? attributes,
  String key,
) {
  if (attributes is! Map) return null;
  final String? text = ComponentProps.asString(
    _resolveAccessibilityValue(node, attributes[key]),
  );
  return text == null || text.isEmpty ? null : text;
}

bool _readAccessibilityBool(
  ComponentNode<ComponentImplementation> node,
  Object? attributes,
  String key,
) {
  if (attributes is! Map) return false;
  return ComponentProps.asBoolean(
        _resolveAccessibilityValue(node, attributes[key]),
      ) ??
      false;
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
