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

import '../primitives/errors.dart';
import '../primitives/event_notifier.dart';
import 'catalog.dart';
import 'messages.dart';
import 'surface_model.dart';

/// The root state model for the A2UI system.
class SurfaceGroupModel<T extends ComponentApi> {
  final Map<String, SurfaceModel<T>> _surfaces = {};
  final Map<String, Subscription> _actionSubscriptions = {};

  final _onSurfaceCreated = EventNotifier<SurfaceModel<T>>();
  final _onSurfaceDeleted = EventNotifier<String>();
  final _onAction = EventNotifier<A2uiRendererAction>();

  /// Fires when a new surface is added.
  EventSource<SurfaceModel<T>> get onSurfaceCreated => _onSurfaceCreated;

  /// Fires when a surface is removed.
  EventSource<String> get onSurfaceDeleted => _onSurfaceDeleted;

  /// Fires when an action is dispatched from ANY surface in the group.
  EventSource<A2uiRendererAction> get onAction => _onAction;

  /// Adds a surface to the group.
  ///
  /// Throws [A2uiStateError] when the group already holds a surface with the
  /// same id.
  void addSurface(SurfaceModel<T> surface) {
    if (_surfaces.containsKey(surface.id)) {
      throw A2uiStateError(
        "Surface '${surface.id}' already exists in this group.",
      );
    }
    _surfaces[surface.id] = surface;
    _actionSubscriptions[surface.id] = surface.onAction.subscribe(
      _onAction.emit,
    );
    _onSurfaceCreated.emit(surface);
  }

  /// Removes a surface from the group by its ID.
  void deleteSurface(String id) {
    final SurfaceModel<T>? surface = _remove(id);
    if (surface != null) {
      surface.dispose();
      _onSurfaceDeleted.emit(id);
    }
  }

  /// Removes a surface from the group by its ID without disposing of it, and
  /// returns it, or null when the group holds no surface with [id].
  ///
  /// To the group's listeners this is the same as [deleteSurface]:
  /// [onSurfaceDeleted] fires, and the surface's actions no longer reach
  /// [onAction]. The caller then owns the surface. It can put the same object
  /// back with [addSurface], which fires [onSurfaceCreated], as when a
  /// deletion is undone, or must dispose of it.
  SurfaceModel<T>? detachSurface(String id) {
    final SurfaceModel<T>? surface = _remove(id);
    if (surface != null) _onSurfaceDeleted.emit(id);
    return surface;
  }

  SurfaceModel<T>? _remove(String id) {
    final SurfaceModel<T>? surface = _surfaces.remove(id);
    if (surface != null) _actionSubscriptions.remove(id)?.unsubscribe();
    return surface;
  }

  /// Retrieves a surface by its ID.
  SurfaceModel<T>? getSurface(String id) => _surfaces[id];

  /// Returns all active surfaces.
  Iterable<SurfaceModel<T>> get allSurfaces => _surfaces.values;

  /// Disposes of the group and all its surfaces.
  void dispose() {
    for (final id in List<String>.from(_surfaces.keys)) {
      deleteSurface(id);
    }
    _onSurfaceCreated.dispose();
    _onSurfaceDeleted.dispose();
    _onAction.dispose();
  }
}
