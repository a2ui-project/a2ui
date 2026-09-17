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
import 'package:collection/collection.dart';
import 'package:flutter/widgets.dart';

import '../model/catalog.dart';
import '../model/catalog_item.dart';
import '../model/data_model.dart';
import '../model/ui_models.dart';
import '../primitives/logging.dart';
import '../primitives/simple_items.dart';
import 'fallback_widget.dart';
import 'surface.dart';

/// Experimental sibling of [Surface] backed by the a2ui_core node layer.
///
/// Where [Surface] rebuilds the whole widget tree from an immutable
/// [SurfaceDefinition] snapshot on every update, this widget renders the
/// live resolved tree from a [core.NodeResolver]: each node's subtree
/// rebuilds only when that node's own resolved properties change.
///
/// Catalog views are reused unchanged. They receive the component's raw
/// properties and bind dynamic values and dispatch actions themselves,
/// exactly as under [Surface]; the node layer contributes the children:
/// every child reference the resolver mounted arrives as a resolved node
/// (templates expanded one node per data item, missing components as
/// placeholders swapped in place, list changes reconciled with surviving
/// nodes reused). Child references the catalog schema does not mark, which
/// the resolver leaves as id strings, are rendered by walking the raw
/// definitions by id, as [Surface] does.
class NodeSurface extends StatefulWidget {
  /// Creates a [NodeSurface].
  const NodeSurface({
    super.key,
    required this.surface,
    required this.catalog,
    required this.onEvent,
    this.defaultBuilder,
    this.reportError,
  });

  /// The live surface model to resolve and render.
  final core.SurfaceModel<core.ComponentApi> surface;

  /// The catalog providing the widget builders.
  final Catalog catalog;

  /// Called with every UI event dispatched from this surface's widgets.
  final UiEventCallback onEvent;

  /// A builder for the widget to display before the root component arrives.
  final WidgetBuilder? defaultBuilder;

  /// Called when building a component fails. Defaults to logging.
  final void Function(Object error, StackTrace? stackTrace)? reportError;

  @override
  State<NodeSurface> createState() => _NodeSurfaceState();
}

class _NodeSurfaceState extends State<NodeSurface> {
  late core.NodeResolver<core.ComponentApi> _resolver;
  late InMemoryDataModel _dataModel;

  /// Component ids by the child tokens handed to catalog views. Layout views
  /// pass a child token back through `getComponent`; an instance id always
  /// names the same component, so one map serves every parent.
  final Map<String, String> _componentIdByToken = {};

  @override
  void initState() {
    super.initState();
    _attach();
  }

  @override
  void didUpdateWidget(NodeSurface oldWidget) {
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

  void _attach() {
    genUiLogger.info(
      'NodeSurface attached to surface ${widget.surface.id}; rendering '
      'through the node layer',
    );
    _dataModel = InMemoryDataModel.wrap(widget.surface.dataModel);
    _resolver = core.NodeResolver<core.ComponentApi>(widget.surface);
  }

  void _detach() {
    _resolver.dispose();
    _dataModel.dispose();
    _componentIdByToken.clear();
  }

  @override
  Widget build(BuildContext context) {
    return _SignalBuilder<core.ComponentNode?>(
      signal: _resolver.rootNode,
      builder: (context, root) {
        if (root == null) {
          return widget.defaultBuilder?.call(context) ??
              const SizedBox.shrink();
        }
        return _buildNode(root);
      },
    );
  }

  Widget _buildNode(core.ComponentNode node) {
    return _SignalBuilder<core.NodeProps>(
      // Keyed by node identity: when the resolver replaces a node (a
      // placeholder upgrade, an id change), the old element's subscription
      // is disposed with it.
      key: ObjectKey(node),
      signal: node.props,
      builder: (context, resolvedProps) =>
          _buildNodeWidget(context, node, resolvedProps),
    );
  }

  Widget _buildNodeWidget(
    BuildContext context,
    core.ComponentNode node,
    core.NodeProps resolvedProps,
  ) {
    if (node.isPlaceholder) {
      // The parent re-emits with the real node when the definition arrives.
      return const SizedBox.shrink();
    }
    try {
      final core.ComponentModel? model = widget.surface.componentsModel.get(
        node.componentId,
      );
      if (model == null) {
        return const SizedBox.shrink();
      }

      final JsonMap data = JsonMap.from(model.properties);
      final childByToken = <String, core.ComponentNode>{};

      String adopt(core.ComponentNode child) {
        // Instance ids are distinct among siblings, so a token never repeats
        // within one parent.
        final String token = child.instanceId;
        assert(
          !childByToken.containsKey(token),
          'Sibling nodes share the instance id $token',
        );
        childByToken[token] = child;
        _componentIdByToken[token] = child.componentId;
        return token;
      }

      // Swap every mounted child reference for a token the catalog view hands
      // back to `buildChild`. Everything else stays as authored: the views
      // bind dynamic values and dispatch actions themselves.
      for (final MapEntry<String, Object?> entry in resolvedProps.entries) {
        final Object? value = entry.value;
        if (value is core.ComponentNode) {
          data[entry.key] = adopt(value);
        } else if (value is List && value.any(_holdsNode)) {
          final Object? raw = model.properties[entry.key];
          data[entry.key] = [
            for (final (int index, Object? item) in value.indexed)
              if (item is core.ComponentNode)
                adopt(item)
              else if (item is Map)
                _withTokens(
                  item,
                  raw is List && index < raw.length ? raw[index] : null,
                  adopt,
                )
              else
                item,
          ];
        }
      }

      final dataContext = DataContext(
        _dataModel,
        DataPath(node.dataPath),
        functions: widget.catalog.functions,
      );

      return _buildCatalogWidget(
        context: context,
        componentId: node.componentId,
        type: node.type,
        data: data,
        dataContext: dataContext,
        buildChild: (String id, [DataContext? childDataContext]) {
          final core.ComponentNode? child = childByToken[id];
          if (child != null) {
            return _buildNode(child);
          }
          // The schema did not mark this property as a child reference, so
          // the resolver produced no node for it; walk the raw definition
          // the way [Surface] does.
          return _buildFromDefinition(
            context,
            id,
            childDataContext ?? dataContext,
          );
        },
      );
    } catch (exception, stackTrace) {
      _reportError(exception, stackTrace);
      return FallbackWidget(error: exception, stackTrace: stackTrace);
    }
  }

  /// Whether a resolved list item carries a mounted child node, directly or
  /// as a field of an object item (`items[].child`).
  static bool _holdsNode(Object? item) =>
      item is core.ComponentNode ||
      (item is Map && item.values.any((value) => value is core.ComponentNode));

  /// The authored object item with its mounted child fields replaced by
  /// tokens. The resolved item's other fields are binding objects the views
  /// do not read, so the authored values are kept instead.
  static Map<String, Object?> _withTokens(
    Map<Object?, Object?> resolved,
    Object? raw,
    String Function(core.ComponentNode child) adopt,
  ) {
    final Map<String, Object?> result = raw is Map
        ? JsonMap.from(raw)
        : <String, Object?>{};
    for (final MapEntry<Object?, Object?> entry in resolved.entries) {
      final Object? value = entry.value;
      if (value is core.ComponentNode) {
        result[entry.key! as String] = adopt(value);
      } else if (raw is! Map) {
        result[entry.key! as String] = value;
      }
    }
    return result;
  }

  /// Renders a component and its descendants directly from the raw
  /// definitions, bypassing the node layer. Used for child references the
  /// resolver could not classify from the schema.
  Widget _buildFromDefinition(
    BuildContext context,
    String componentId,
    DataContext dataContext,
  ) {
    try {
      final core.ComponentModel? model = widget.surface.componentsModel.get(
        componentId,
      );
      if (model == null) {
        return const SizedBox.shrink();
      }
      return _buildCatalogWidget(
        context: context,
        componentId: componentId,
        type: model.type,
        data: JsonMap.from(model.properties),
        dataContext: dataContext,
        buildChild: (String id, [DataContext? childDataContext]) =>
            _buildFromDefinition(context, id, childDataContext ?? dataContext),
      );
    } catch (exception, stackTrace) {
      _reportError(exception, stackTrace);
      return FallbackWidget(error: exception, stackTrace: stackTrace);
    }
  }

  Widget _buildCatalogWidget({
    required BuildContext context,
    required String componentId,
    required String type,
    required JsonMap data,
    required DataContext dataContext,
    required ChildBuilderCallback buildChild,
  }) {
    return widget.catalog.buildWidget(
      CatalogItemContext(
        id: componentId,
        type: type,
        data: data,
        buildChild: buildChild,
        dispatchEvent: _dispatchEvent,
        buildContext: context,
        dataContext: dataContext,
        getComponent: _getComponent,
        getCatalogItem: (String type) =>
            widget.catalog.items.firstWhereOrNull((item) => item.name == type),
        surfaceId: widget.surface.id,
        reportError: _reportError,
      ),
    );
  }

  /// Resolves both raw component ids and child tokens (which layout views
  /// receive as children and pass back for weight lookups).
  Component? _getComponent(String id) {
    final String componentId = _componentIdByToken[id] ?? id;
    final core.ComponentModel? model = widget.surface.componentsModel.get(
      componentId,
    );
    return model == null ? null : Component.fromCore(model);
  }

  void _dispatchEvent(UiEvent event) {
    final Map<String, Object?> eventMap = {
      ...event.toMap(),
      surfaceIdKey: widget.surface.id,
    };
    final UiEvent newEvent = event.isUserAction
        ? UserActionEvent.fromMap(eventMap)
        : UiEvent.fromMap(eventMap);
    widget.onEvent(newEvent);
  }

  void _reportError(Object error, StackTrace? stackTrace) {
    if (widget.reportError != null) {
      widget.reportError!(error, stackTrace);
      return;
    }
    genUiLogger.severe(
      'Error building node surface ${widget.surface.id}',
      error,
      stackTrace,
    );
  }
}

/// Rebuilds when a [core.ReadonlySignal] emits a new value.
class _SignalBuilder<T> extends StatefulWidget {
  const _SignalBuilder({
    super.key,
    required this.signal,
    required this.builder,
  });

  final core.ReadonlySignal<T> signal;
  final Widget Function(BuildContext context, T value) builder;

  @override
  State<_SignalBuilder<T>> createState() => _SignalBuilderState<T>();
}

class _SignalBuilderState<T> extends State<_SignalBuilder<T>> {
  late T _value;
  void Function()? _unsubscribe;

  @override
  void initState() {
    super.initState();
    _subscribe();
  }

  @override
  void didUpdateWidget(_SignalBuilder<T> oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.signal, widget.signal)) {
      _unsubscribe?.call();
      _subscribe();
    }
  }

  @override
  void dispose() {
    _unsubscribe?.call();
    super.dispose();
  }

  void _subscribe() {
    _value = widget.signal.peek();
    // subscribe fires synchronously with the current value; the identity
    // check absorbs that first call so no setState happens during
    // initState/didUpdateWidget.
    _unsubscribe = widget.signal.subscribe((value) {
      if (identical(value, _value)) {
        return;
      }
      _value = value;
      if (mounted) {
        setState(() {});
      }
    });
  }

  @override
  Widget build(BuildContext context) => widget.builder(context, _value);
}
