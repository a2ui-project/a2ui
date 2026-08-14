// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import 'dart:async';

import '../primitives/event_notifier.dart';
import 'catalog.dart';
import 'common.dart';
import 'component_model.dart';
import 'contexts.dart';
import 'data_model.dart';
import 'messages.dart';

/// The state model for a single UI surface.
class SurfaceModel<T extends ComponentApi> {
  final String id;
  final Catalog<T> catalog;
  final Map<String, dynamic> theme;
  final bool sendDataModel;

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
  }) : dataModel = DataModel(),
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
        context: Map<String, dynamic>.from(
          (event['context'] ?? <String, dynamic>{}) as Map,
        ),
      );
      _onAction.emit(action);
    } else if (payload.containsKey('functionCall')) {
      final callJson = payload['functionCall'] as Map<String, dynamic>;
      final call = FunctionCall.fromJson(callJson);
      catalog.invoke(
        call.call,
        Map<String, dynamic>.from(call.args),
        DataContext(dataModel, catalog.invoke, '/'),
      );
    }
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
