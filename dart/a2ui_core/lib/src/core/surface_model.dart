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

  /// The id of the component this surface's tree is rooted at.
  ///
  /// `root` unless set otherwise. `NodeResolver` builds the tree from it, and
  /// `MessageProcessor` checks for it when `ValidationConfig.rootId` is null.
  final String rootId;

  /// The surface-level metadata from `createSurface`, holding at most an
  /// `extensions` object, or null when it carried none. Defined from v1.0
  /// only.
  Map<String, Object?>? metadata;

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
    this.rootId = 'root',
  })  : dataModel = DataModel(),
        componentsModel = SurfaceComponentsModel(catalog: catalog);

  /// Emits an agent-bound action from this surface on [onAction].
  ///
  /// The [payload] is either `{'event': {'name': ..., 'context': ...,
  /// 'userMessage': ...}}` or the same fields without the `event` wrapper.
  /// Its values must already be resolved against the data model.
  ///
  /// Any other payload, including a `functionCall` or `call` action, is
  /// ignored, as is an event whose `name` is missing, empty or not a string.
  /// Local function actions run in `GenericBinder`, which calls this method
  /// only for actions that go to the agent.
  Future<void> dispatchAction(
    Map<String, dynamic> payload,
    String sourceComponentId,
  ) async {
    final Map<String, dynamic> event;
    if (payload.containsKey('event') && payload['event'] is Map) {
      event = Map<String, dynamic>.from(payload['event'] as Map);
    } else if (payload.containsKey('name')) {
      event = payload;
    } else {
      return;
    }

    final Object? name = event['name'];
    if (name is! String || name.isEmpty) return;

    final Object? rawContext = event['context'];
    final Map<String, dynamic> context;
    if (rawContext is Map) {
      final Object? detached = _detach(rawContext);
      context = detached is Map<String, dynamic>
          ? detached
          : <String, dynamic>{
              for (final MapEntry<Object?, Object?> entry in rawContext.entries)
                entry.key.toString(): _detach(entry.value),
            };
    } else {
      context = const <String, dynamic>{};
    }

    final action = A2uiClientAction(
      name: name,
      surfaceId: id,
      sourceComponentId: sourceComponentId,
      timestamp: DateTime.now(),
      context: context,
      userMessage: event['userMessage'] is String
          ? event['userMessage'] as String
          : null,
    );
    _onAction.emit(action);
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
