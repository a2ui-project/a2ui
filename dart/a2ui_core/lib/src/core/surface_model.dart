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

import 'dart:async';

import '../primitives/event_notifier.dart';
import 'catalog.dart';
import 'component_model.dart';
import 'data_model.dart';
import 'messages.dart';

/// The state model for a single UI surface.
class SurfaceModel<T extends ComponentApi> {
  final String id;
  final Catalog<T, FunctionImplementation> catalog;
  final Map<String, dynamic> theme;
  final bool sendDataModel;
  final String? protocolVersion;

  final DataModel dataModel;
  final SurfaceComponentsModel componentsModel;

  final _onAction = EventNotifier<A2uiClientAction>();
  final _onError = EventNotifier<A2uiClientError>();

  /// Fires whenever an action is dispatched from this surface.
  EventListenable<A2uiClientAction> get onAction => _onAction;

  /// Fires whenever an error occurs on this surface.
  EventListenable<A2uiClientError> get onError => _onError;

  SurfaceModel(
    this.id, {
    required this.catalog,
    this.theme = const {},
    this.sendDataModel = false,
    this.protocolVersion,
  })  : dataModel = DataModel(),
        componentsModel = SurfaceComponentsModel();

  /// Dispatches an action from this surface.
  Future<void> dispatchAction(
    Map<String, dynamic> payload,
    String sourceComponentId,
  ) async {
    if (payload.containsKey('event')) {
      final event = payload['event'] as Map<String, dynamic>;
      final action = A2uiClientAction(
        name: (event['name'] as String?) ?? 'unknown',
        surfaceId: id,
        sourceComponentId: sourceComponentId,
        timestamp: DateTime.now(),
        context: _detach((event['context'] ?? <String, dynamic>{}) as Map)
            as Map<String, dynamic>,
      );
      _onAction.emit(action);
    }
    // Only event payloads are emitted; functionCall payloads are not
    // dispatched here.
  }

  /// Dispatches an error from this surface.
  Future<void> dispatchError(A2uiClientError error) async {
    _onError.emit(error);
  }

  /// Disposes of the surface and its resources.
  void dispose() {
    dataModel.dispose();
    componentsModel.dispose();
    _onAction.dispose();
    _onError.dispose();
  }
}

/// Copies maps and lists, so an action listener cannot reach the component or
/// data model the payload was resolved from.
Object? _detach(Object? value) => switch (value) {
      Map() when value.keys.every((key) => key is String) => <String, dynamic>{
          for (final MapEntry<Object?, Object?> entry in value.entries)
            entry.key as String: _detach(entry.value),
        },
      Map() => <Object?, Object?>{
          for (final MapEntry<Object?, Object?> entry in value.entries)
            entry.key: _detach(entry.value),
        },
      List() => <Object?>[for (final Object? item in value) _detach(item)],
      _ => value,
    };
