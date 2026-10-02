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

import '../catalog/component_implementation.dart';
import '../nodes/fallback_views.dart';
import '../nodes/node_view.dart';
import '../theme/theme_adapter.dart';
import 'surface_scope.dart';

/// The root Flutter widget for rendering an A2UI surface.
///
/// Accepts a [SurfaceModel] directly as its sole input, manages the lifecycle
/// of the underlying [NodeResolver], and renders the resolved component tree.
class A2uiSurface extends StatefulWidget {
  /// The living Core SDK surface model managing state, catalog(s), theme,
  /// and event channels.
  final SurfaceModel<FlutterComponentImplementation> surface;

  const A2uiSurface({super.key, required this.surface});

  @override
  State<A2uiSurface> createState() => _A2uiSurfaceState();
}

class _A2uiSurfaceState extends State<A2uiSurface> {
  late NodeResolver<FlutterComponentImplementation> _resolver;
  void Function()? _unsubscribeRoot;

  @override
  void initState() {
    super.initState();
    _initResolver();
  }

  void _initResolver() {
    _resolver = NodeResolver<FlutterComponentImplementation>(widget.surface);
    _unsubscribeRoot = _resolver.rootNode.subscribe((_) {
      if (mounted) {
        setState(() {});
      }
    });
  }

  @override
  void didUpdateWidget(A2uiSurface oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.surface != widget.surface) {
      _unsubscribeRoot?.call();
      _resolver.dispose();
      _initResolver();
    }
  }

  @override
  void dispose() {
    _unsubscribeRoot?.call();
    _unsubscribeRoot = null;
    _resolver.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ComponentNode<FlutterComponentImplementation>? root =
        _resolver.rootNode.value;

    final Widget content = A2uiSurfaceScope(
      surface: widget.surface,
      resolver: _resolver,
      child: root == null
          ? const A2uiLoadingPlaceholder(componentId: 'root')
          : NodeView(key: ValueKey(root.instanceId), node: root),
    );

    if (widget.surface.theme.isEmpty) {
      return content;
    }

    final ThemeData baseTheme = Theme.of(context);
    final ThemeData adaptedTheme = A2uiThemeAdapter.applyThemeTokens(
      baseTheme,
      widget.surface.theme,
    );

    return Theme(data: adaptedTheme, child: content);
  }
}
