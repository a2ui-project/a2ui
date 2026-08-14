// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import '../primitives/errors.dart';
import '../primitives/event_notifier.dart';

/// Represents the state model for an individual UI component.
class ComponentModel {
  final String id;
  final String type;
  Map<String, dynamic> _properties;
  final _onUpdated = EventNotifier<ComponentModel>();

  /// Fires whenever the component's properties are updated.
  EventListenable<ComponentModel> get onUpdated => _onUpdated;

  ComponentModel(this.id, this.type, Map<String, dynamic> initialProperties)
    : _properties = Map.from(initialProperties);

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

  /// Returns a JSON representation of the component tree.
  Map<String, dynamic> toJson() {
    return {'id': id, 'component': type, ..._properties};
  }
}

/// Manages the collection of components for a specific surface.
class SurfaceComponentsModel {
  final Map<String, ComponentModel> _components = {};
  final _onCreated = EventNotifier<ComponentModel>();
  final _onDeleted = EventNotifier<String>();

  /// Fires when a new component is added to the model.
  EventListenable<ComponentModel> get onCreated => _onCreated;

  /// Fires when a component is removed, providing the ID of the deleted
  /// component.
  EventListenable<String> get onDeleted => _onDeleted;

  /// Retrieves a component by its ID.
  ComponentModel? get(String id) => _components[id];

  /// Returns an iterator over the components in the model.
  Iterable<ComponentModel> get all => _components.values;

  /// Adds a component to the model.
  void addComponent(ComponentModel component) {
    if (_components.containsKey(component.id)) {
      throw A2uiStateError(
        "Component with id '${component.id}' already exists.",
      );
    }
    _components[component.id] = component;
    _onCreated.emit(component);
  }

  /// Removes a component from the model by its ID.
  void removeComponent(String id) {
    final ComponentModel? component = _components.remove(id);
    if (component != null) {
      component.dispose();
      _onDeleted.emit(id);
    }
  }

  /// Disposes of the model and all its components.
  void dispose() {
    for (final ComponentModel component in _components.values) {
      component.dispose();
    }
    _components.clear();
    _onCreated.dispose();
    _onDeleted.dispose();
  }
}
