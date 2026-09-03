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

import '../primitives/clock.dart';
import '../primitives/event_notifier.dart';
import 'catalog.dart';
import 'messages.dart';
import 'surface_model.dart';

/// The root state model for the A2UI system.
class SurfaceGroupModel<T extends ComponentApi> {
  final Clock clock;
  final Map<String, SurfaceModel<T>> _surfaces = {};
  final Map<String, void Function(A2uiClientAction)> _actionForwarders = {};

  SurfaceGroupModel({Clock? clock}) : clock = clock ?? systemClock;

  final _onSurfaceCreated = EventNotifier<SurfaceModel<T>>();
  final _onSurfaceDeleted = EventNotifier<String>();
  final _onAction = EventNotifier<A2uiClientAction>();

  /// Fires when a new surface is added.
  EventListenable<SurfaceModel<T>> get onSurfaceCreated => _onSurfaceCreated;

  /// Fires when a surface is removed.
  EventListenable<String> get onSurfaceDeleted => _onSurfaceDeleted;

  /// Fires when an action is dispatched from ANY surface in the group.
  EventListenable<A2uiClientAction> get onAction => _onAction;

  /// Adds a surface to the group.
  void addSurface(SurfaceModel<T> surface) {
    if (_surfaces.containsKey(surface.id)) {
      return;
    }
    _surfaces[surface.id] = surface;
    void forwarder(A2uiClientAction action) {
      _onAction.emit(action);
    }

    surface.onAction.addListener(forwarder);
    _actionForwarders[surface.id] = forwarder;
    _onSurfaceCreated.emit(surface);
  }

  /// Removes a surface from the group by its ID.
  void deleteSurface(String id) {
    final SurfaceModel<T>? surface = _surfaces.remove(id);
    if (surface != null) {
      final void Function(A2uiClientAction)? forwarder = _actionForwarders
          .remove(id);
      if (forwarder != null) {
        surface.onAction.removeListener(forwarder);
      }
      surface.dispose();
      _onSurfaceDeleted.emit(id);
    }
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
