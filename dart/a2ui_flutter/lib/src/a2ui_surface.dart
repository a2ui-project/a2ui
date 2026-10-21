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

import 'component_implementation.dart';
import 'node_view.dart';
import 'signal_state.dart';
import 'surface_scope.dart';

/// Renders a [SurfaceModel] as widgets.
///
/// While mounted, the widget renders the root node of [surface]'s
/// [NodeResolver]. Until the root component arrives, and in place of a child
/// that has not arrived, it shows a small progress indicator.
///
/// The first widget to show a surface creates its resolver, every widget that
/// shows the surface later shares it, and the resolver is disposed with the
/// surface. The surface stays resolved, and its bindings keep evaluating,
/// while no widget shows it. Creating the resolver delivers the surface's
/// pending diagnostics to [SurfaceModel.onError] synchronously, so a listener
/// can run during that first widget's build.
///
/// The surface belongs to the caller. Remove this widget when the surface is
/// deleted. Until then it shows the progress indicator.
class A2uiSurface extends StatefulWidget {
  const A2uiSurface({super.key, required this.surface});

  /// The surface to render.
  final SurfaceModel<ComponentImplementation> surface;

  /// The surface rendered by the nearest enclosing [A2uiSurface], if any.
  static SurfaceModel<ComponentImplementation>? maybeOf(BuildContext context) =>
      SurfaceScope.maybeOf(context);

  /// The surface rendered by the nearest enclosing [A2uiSurface].
  static SurfaceModel<ComponentImplementation> of(BuildContext context) =>
      SurfaceScope.of(context);

  @override
  State<A2uiSurface> createState() => _A2uiSurfaceState();
}

/// The resolver of each surface that a widget has shown.
final Expando<NodeResolver<ComponentImplementation>> _resolvers = Expando(
  'surface resolver',
);

NodeResolver<ComponentImplementation> _resolverOf(
  SurfaceModel<ComponentImplementation> surface,
) {
  final NodeResolver<ComponentImplementation>? existing = _resolvers[surface];
  if (existing != null) return existing;
  // Creating the resolver delivers diagnostics, and a listener may dispose
  // the surface before the constructor returns.
  var surfaceDisposed = false;
  NodeResolver<ComponentImplementation>? created;
  surface.onDisposed.subscribe((_) {
    surfaceDisposed = true;
    created?.dispose();
  });
  final NodeResolver<ComponentImplementation> resolver = created =
      NodeResolver<ComponentImplementation>(surface);
  if (surfaceDisposed) resolver.dispose();
  return _resolvers[surface] = resolver;
}

class _A2uiSurfaceState extends State<A2uiSurface> with SignalState {
  late NodeResolver<ComponentImplementation> _resolver;
  late void Function() _unsubscribe;

  void _attach() {
    _resolver = _resolverOf(widget.surface);
    _unsubscribe = listenAfterFirst(_resolver.rootNode, (_) => signalChanged());
  }

  void _detach() {
    _unsubscribe();
  }

  @override
  void initState() {
    super.initState();
    _attach();
  }

  @override
  void didUpdateWidget(A2uiSurface oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.surface, widget.surface)) {
      _detach();
      _attach();
    }
  }

  @override
  void dispose() {
    _detach();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ComponentNode<ComponentImplementation>? root = _resolver.rootNode
        .peek();
    return SurfaceScope(
      surface: widget.surface,
      // A new surface starts from fresh state, even under the same root id.
      child: KeyedSubtree(
        key: ObjectKey(widget.surface),
        child: root == null ? const LoadingPlaceholder() : NodeView(root),
      ),
    );
  }
}
