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

import 'package:meta/meta.dart';

import '../primitives/errors.dart';
import '../primitives/event_notifier.dart';
import '../validation/component_graph.dart';
import '../validation/component_refs.dart';
import '../validation/validation_config.dart';
import 'catalog.dart';
import 'component_graph_bound.dart';

/// Represents the state model for an individual UI component.
///
/// [properties] holds the component's own properties only. The envelope
/// fields a component message carries, `id`, `component`, `catalogId` and
/// `metadata`, live in [id], [type], [catalog] and [metadata] instead.
class ComponentModel {
  final String id;
  final String type;

  /// The `catalogId` this component names for itself, or null when it uses
  /// its surface's catalog.
  ///
  /// A component whose catalog changes is recreated rather than updated, as
  /// for a change of [type].
  final String? catalog;

  /// The `metadata` this component carries, or null when it carries none.
  ///
  /// Updated with [properties], before [onUpdated] fires, so a listener sees
  /// both from the same message.
  Map<String, Object?>? metadata;

  Map<String, dynamic> _properties;
  final _onUpdated = EventNotifier<ComponentModel>();

  /// Fires whenever the component's properties are updated.
  EventSource<ComponentModel> get onUpdated => _onUpdated;

  ComponentModel(
    this.id,
    this.type,
    Map<String, dynamic> initialProperties, {
    this.catalog,
    this.metadata,
  }) : _properties = Map.from(initialProperties);

  /// The current properties of the component.
  Map<String, dynamic> get properties => _properties;

  set properties(Map<String, dynamic> newProperties) {
    _properties = Map.from(newProperties);
    _onUpdated.emit(this);
  }

  /// Disposes of the component and its resources.
  void dispose() {
    _onUpdated.dispose();
  }

  /// Returns the component as the message that would create it.
  Map<String, dynamic> toJson() {
    return {
      ..._properties,
      'id': id,
      'component': type,
      if (catalog != null) 'catalogId': catalog,
      if (metadata != null) 'metadata': metadata,
    };
  }
}

/// Manages the collection of components for a specific surface.
///
/// The graph queries ([getChildIds], [detectCycles], [validateTopology],
/// [validateReferences] and [validateComponentsUpdate]) find child references
/// through the reference properties the `catalog` passed to the constructor
/// declares. `MessageProcessor` widens that to every catalog the surface's
/// components draw on. A model built without a catalog finds no references.
class SurfaceComponentsModel {
  final Map<String, ComponentModel> _components = {};
  final _onCreated = EventNotifier<ComponentModel>();
  final _onDeleted = EventNotifier<String>();

  /// How many times a component has been added, removed or updated.
  int _changes = 0;

  /// What the last [checkComponentsUpdate] found about the graph, which
  /// holds for this model while [_changes] is [_boundAt].
  ComponentGraphBound? _bound;
  int _boundAt = -1;

  /// The batch [_bound] describes the graph with, once applied.
  List<Map<String, Object?>>? _boundBatch;

  /// The catalogs the components name, as [catalogIds] returns them, or null
  /// until asked for again after a component is removed.
  List<String?>? _catalogIds;

  /// The catalog [refFields] is derived from until it is set.
  final Catalog<ComponentApi, FunctionApi>? _catalog;

  Map<String, ComponentRefFields>? _refFields;

  /// Creates an empty model whose graph queries find child references through
  /// [catalog]'s reference properties, or find none when [catalog] is null.
  SurfaceComponentsModel({Catalog<ComponentApi, FunctionApi>? catalog})
      : _catalog = catalog;

  /// Which properties hold child references, per component type.
  ///
  /// Derived from the constructor's catalog on first use.
  @internal
  Map<String, ComponentRefFields> get refFields => _refFields ??=
      _catalog == null ? const {} : extractComponentRefFields(_catalog);

  @internal
  set refFields(Map<String, ComponentRefFields> value) => _refFields = value;

  /// Fires when a new component is added to the model.
  EventSource<ComponentModel> get onCreated => _onCreated;

  /// Fires when a component is removed, providing the ID of the deleted
  /// component.
  EventSource<String> get onDeleted => _onDeleted;

  /// Retrieves a component by its ID.
  ComponentModel? get(String id) => _components[id];

  /// Returns an iterator over the components in the model.
  Iterable<ComponentModel> get all => _components.values;

  /// Every component in the model, in insertion order.
  List<ComponentModel> getAll() => _components.values.toList();

  /// Whether the model holds a component with [id].
  bool has(String id) => _components.containsKey(id);

  /// How many components the model holds.
  int get size => _components.length;

  /// The components keyed by id, in insertion order.
  Iterable<MapEntry<String, ComponentModel>> get entries => _components.entries;

  /// The component ids, in insertion order.
  Iterable<String> get keys => _components.keys;

  /// The components, in insertion order.
  Iterable<ComponentModel> get values => _components.values;

  /// The distinct catalogs the components name, null for the surface's own,
  /// in the order the first component naming each was added.
  @internal
  List<String?> get catalogIds => _catalogIds ??= {
        for (final ComponentModel component in _components.values)
          component.catalog,
      }.toList();

  /// Adds a component to the model.
  void addComponent(ComponentModel component) {
    if (_components.containsKey(component.id)) {
      throw A2uiStateError(
        "Component with id '${component.id}' already exists.",
      );
    }
    _components[component.id] = component;
    _changes++;
    component.onUpdated.subscribe((_) => _changes++);
    if (_catalogIds case final List<String?> catalogIds
        when !catalogIds.contains(component.catalog)) {
      catalogIds.add(component.catalog);
    }
    _onCreated.emit(component);
  }

  /// Removes a component from the model by its ID.
  void removeComponent(String id) {
    final ComponentModel? component = _components.remove(id);
    if (component != null) {
      _changes++;
      _catalogIds = null;
      component.dispose();
      _onDeleted.emit(id);
    }
  }

  /// The ids the component with [id] references as children, in property
  /// order, including ids the model does not hold.
  ///
  /// Empty when the model holds no component with [id].
  List<String> getChildIds(String id) => [
        for (final ComponentReference reference in _referencesOf(id))
          reference.id,
      ];

  Iterable<ComponentReference> _referencesOf(String id) {
    final ComponentModel? component = _components[id];
    if (component == null) return const <ComponentReference>[];
    return componentReferences(
      component.properties,
      refFields[component.type],
    );
  }

  /// Checks for self-references, cycles and over-deep chains, and returns the
  /// ids reachable from [rootId].
  ///
  /// When [allowMissingRoot] is true every component is a starting point and
  /// every id is returned. [maxDepth] defaults to 50.
  ///
  /// Throws [A2uiIntegrityError] for a self-reference or a cycle, and
  /// [A2uiRecursionError] for an over-deep chain.
  Set<String> detectCycles({
    String rootId = 'root',
    int? maxDepth,
    bool allowMissingRoot = false,
  }) =>
      detectComponentCycles(
        _components.keys.toSet(),
        _referencesOf,
        rootId: rootId,
        allowMissingRoot: allowMissingRoot,
        maxDepth: maxDepth,
      );

  /// Checks the model as a surface's component graph against [config].
  ///
  /// The root is [ValidationConfig.rootId], or `root` when that is null. An
  /// empty model passes.
  ///
  /// Throws [A2uiIntegrityError] for a missing root, a dangling reference,
  /// a self-reference, a cycle or an unreachable component, and
  /// [A2uiRecursionError] for an over-deep chain.
  void validateTopology([ValidationConfig config = ValidationConfig.strict]) =>
      checkComponentGraph(_components.keys.toSet(), _referencesOf, config);

  /// Runs [validateTopology] and returns the error it throws, if any, rather
  /// than throwing it.
  ///
  /// The checks stop at the first failure, so the list holds at most one
  /// error.
  List<A2uiValidationError> validateReferences([
    ValidationConfig config = ValidationConfig.strict,
  ]) {
    try {
      validateTopology(config);
    } on A2uiValidationError catch (error) {
      return [error];
    }
    return const [];
  }

  /// Checks the graph this model would hold with [components] applied,
  /// without changing the model.
  ///
  /// Each entry in [components] replaces the component with its id. An entry
  /// that omits `component` keeps the existing component's type, and its
  /// `catalogId` when it omits that too. A duplicate id within [components]
  /// is an error.
  ///
  /// Throws [A2uiValidationError] for an entry with no id, or with no type and
  /// no existing component; otherwise throws as [validateTopology] does.
  void validateComponentsUpdate(
    List<Map<String, Object?>> components, [
    ValidationConfig config = ValidationConfig.strict,
  ]) {
    checkComponentsUpdate(components, config, refFields);
  }

  /// [validateComponentsUpdate] with [refFields] in place of this model's,
  /// for a batch that draws on catalogs the model has not seen, and
  /// [defaultRootId] as the root when [ValidationConfig.rootId] is null.
  ///
  /// Under a [config] that checks neither references nor reachability, the
  /// model keeps what the last check found about its graph, and once that
  /// batch is applied and reported to [componentsUpdateApplied], the next
  /// check walks only the part of the graph its batch reaches when that
  /// shows the graph passes. Otherwise, or when it cannot show that, the
  /// whole graph is walked, so a batch the graph rejects fails as it would
  /// have without the shortcut.
  ///
  /// Returns what the check found about the graph with the batch applied
  /// when it started from what the check before found, which means nothing
  /// changed the model since the batch before was checked and applied, or
  /// null when it walked the whole graph.
  @internal
  ComponentGraphBound? checkComponentsUpdate(
    List<Map<String, Object?>> components,
    ValidationConfig config,
    Map<String, ComponentRefFields> refFields, {
    String defaultRootId = 'root',
  }) {
    checkDuplicateComponentIds(components);
    // Each component of the batch as its type and the map its references are
    // read from.
    final batch = <String, (String, Map<String, Object?>)>{};
    for (final component in components) {
      final Object? id = component['id'];
      if (id is! String) {
        throw A2uiValidationError(
          "Component missing an 'id'.",
        );
      }
      final Object? type = component['component'];
      final ComponentModel? existing = _components[id];
      if (type is String) {
        batch[id] = (type, component);
      } else if (existing != null) {
        batch[id] = (existing.type, component);
      } else {
        throw A2uiValidationError(
          "Cannot create component $id without a 'component' type.",
        );
      }
    }

    final bool bounded = config.allowDanglingReferences &&
        (config.allowOrphanComponents || config.allowMissingRoot);
    final ComponentGraphBound? bound = _bound;
    final bool current = bound != null && _boundAt == _changes;
    // The bound changes with the batch, and holds for the model again only
    // once the batch is applied.
    _bound = null;
    _boundAt = -1;
    if (bounded &&
        current &&
        (config.allowMissingRoot ||
            batch.containsKey(config.rootId ?? defaultRootId) ||
            has(config.rootId ?? defaultRootId)) &&
        bound.admits(
          batch,
          refFields,
          config.maxDepth ?? maxComponentDepth,
          has,
        )) {
      _bound = bound;
      _boundBatch = components;
      return bound;
    }

    // Each component as its type and the map its references are read from.
    // Existing components lend their properties map rather than a copy.
    final candidate = <String, (String, Map<String, Object?>)>{
      for (final MapEntry<String, ComponentModel> entry in _components.entries)
        entry.key: (entry.value.type, entry.value.properties),
      ...batch,
    };
    checkComponentGraph(candidate.keys.toSet(), (String id) {
      final (String type, Map<String, Object?> source) = candidate[id]!;
      return componentReferences(source, refFields[type]);
    }, config, defaultRootId: defaultRootId);
    if (bounded) {
      _bound = ComponentGraphBound.of(candidate, refFields);
      _boundBatch = components;
    }
    return null;
  }

  /// Reports that [components], the batch the last [checkComponentsUpdate]
  /// passed, has been applied, so that the next check may start from what
  /// that one found.
  @internal
  void componentsUpdateApplied(List<Map<String, Object?>> components) {
    if (_bound != null && identical(components, _boundBatch)) {
      _boundAt = _changes;
    }
    _boundBatch = null;
  }

  /// Disposes of the model and all its components.
  void dispose() {
    for (final ComponentModel component in _components.values) {
      component.dispose();
    }
    _components.clear();
    _bound = null;
    _onCreated.dispose();
    _onDeleted.dispose();
  }
}
