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
import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart' as core;
import 'package:collection/collection.dart';
import 'package:flutter/foundation.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../interfaces/a2ui_message_sink.dart';
import '../interfaces/surface_context.dart';
import '../interfaces/surface_host.dart';
import '../model/a2ui_client_capabilities.dart';
import '../model/a2ui_exceptions.dart';
import '../model/catalog.dart';
import '../model/chat_message.dart';
import '../model/data_model.dart';
import '../model/schema_validation.dart' as schema_validation;
import '../model/ui_models.dart';
import '../primitives/a2ui_validation_exception.dart';
import '../primitives/constants.dart';
import '../primitives/embedded_schemas.g.dart';
import '../primitives/logging.dart';

import 'surface_registry.dart' as surface_reg;

// TODO: Reconsider the Flutter-specific workarounds and, if preserved,
//  move them upstream into a2ui_core as #811 is commpleted.
//  See https://github.com/flutter/genui/pull/974#discussion_r3464921658
/// The runtime controller for the GenUI system.
///
/// Wraps [core.MessageProcessor] and adds Flutter-side concerns: holding
/// updates whose target surface does not exist yet and replaying them once it
/// is created, catalog-schema validation, and a [SurfaceUpdate] stream for the
/// widget layer.
interface class SurfaceController implements SurfaceHost, A2uiMessageSink {
  SurfaceController({
    required this.catalogs,
    this.pendingUpdateTimeout = const Duration(minutes: 1),
  }) {
    _processor = core.MessageProcessor<core.ComponentApi>(
      catalogs: catalogs.expand(allCoreCatalogsFor).toList(),
      protocolVersion: core.A2uiProtocolVersion.v0_9,
      // A surface reaches this controller one message at a time, and updates
      // buffered for a surface replay while its createSurface is still being
      // processed, so the per-payload graph checks (root present, references
      // resolved, no orphans) would run against partial surfaces. Schema,
      // duplicate-id, cycle and depth checks still apply.
      validationConfig: core.ValidationConfig.relaxed,
    );
    _processor.groupModel.onSurfaceCreated.addListener(_onCoreSurfaceCreated);
    _processor.groupModel.onSurfaceDeleted.addListener(_onCoreSurfaceDeleted);
  }

  /// The catalogs available to surfaces in this engine.
  final Iterable<Catalog> catalogs;

  /// The timeout for buffered updates waiting for a surface creation.
  final Duration pendingUpdateTimeout;

  late final core.MessageProcessor<core.ComponentApi> _processor;
  late final surface_reg.SurfaceRegistry _registry =
      surface_reg.SurfaceRegistry();
  final Map<String, DataModel> _liveDataModels = {};
  static final Schema _commonTypesSchema = Schema.fromMap(
    jsonDecode(commonTypesSchemaJson) as Map<String, Object?>,
  );

  SchemaRegistry _createSchemaRegistry(Catalog catalog) {
    final registry = SchemaRegistry();
    registry.addSchema(Uri.parse(commonTypesSchemaId), _commonTypesSchema);
    registry.addSchema(
      Uri.parse('https://a2ui.org/specification/v0_9/catalog.json'),
      catalog.fullSchema,
    );
    return registry;
  }

  final _onSubmit = StreamController<ChatMessage>.broadcast();
  final _pendingUpdates = <String, List<core.AgentToRendererMessage>>{};
  final _pendingUpdateTimers = <String, Timer>{};

  @override
  Stream<SurfaceUpdate> get surfaceUpdates => _registry.events.map(
    (e) => switch (e) {
      surface_reg.SurfaceAdded(:final surfaceId, :final surface) =>
        SurfaceAdded.fromCore(surfaceId, surface),
      surface_reg.SurfaceUpdated(:final surfaceId, :final surface) =>
        ComponentsUpdated.fromCore(surfaceId, surface),
      surface_reg.SurfaceRemoved(:final surfaceId) => SurfaceRemoved(surfaceId),
    },
  );

  /// A stream of messages to be submitted to the AI service.
  Stream<ChatMessage> get onSubmit => _onSubmit.stream;

  /// The IDs of the currently active surfaces.
  Iterable<String> get activeSurfaceIds => _registry.surfaceOrder;

  /// Evaluates and returns the client capabilities for the catalogs managed
  /// by this controller.
  A2UiClientCapabilities get clientCapabilities =>
      A2UiClientCapabilities.fromCatalogs(catalogs);

  @override
  SurfaceContext contextFor(String surfaceId) {
    return _ControllerContext(this, surfaceId);
  }

  /// The registry of surfaces managed by this controller.
  surface_reg.SurfaceRegistry get registry => _registry;

  /// The live core surface model for [surfaceId], or null if the surface
  /// does not exist. Experimental: exists to construct a `NodeSurface`,
  /// which renders from the live model instead of [SurfaceContext.definition]
  /// snapshots.
  core.SurfaceModel<core.ComponentApi>? liveSurfaceFor(String surfaceId) =>
      _registry.getLiveSurface(surfaceId);

  DataModel _dataModelFor(String surfaceId) {
    final DataModel? live = _liveDataModels[surfaceId];
    if (live != null) return live;
    final core.SurfaceModel? surface = _registry.getLiveSurface(surfaceId);
    if (surface == null) {
      throw StateError(
        "Surface '$surfaceId' does not exist; create it before accessing its "
        'data model.',
      );
    }
    final DataModel wrapped = InMemoryDataModel.wrap(surface.dataModel);
    _liveDataModels[surfaceId] = wrapped;
    return wrapped;
  }

  /// Processes a message from the AI service.
  @override
  void handleMessage(core.AgentToRendererMessage message) {
    genUiLogger.info(
      'SurfaceController.handleMessage received: ${message.runtimeType}',
    );
    _handleCoreMessage(message);
  }

  void _handleCoreMessage(core.AgentToRendererMessage coreMessage) {
    // Reject an empty surfaceId on any message that carries one. CreateSurface
    // would otherwise create a surface with id ""; updates and deletes would
    // buffer under "" until they time out, since a surface "" can never exist.
    final String? surfaceId = _surfaceIdOf(coreMessage);
    if (surfaceId != null && surfaceId.isEmpty) {
      reportError(
        A2uiValidationException(
          'Surface ID cannot be empty',
          surfaceId: '',
          path: 'surfaceId',
        ),
        StackTrace.current,
      );
      return;
    }

    final String? bufferSurfaceId = _bufferSurfaceIdIfNoSurface(coreMessage);
    if (bufferSurfaceId != null) {
      _bufferMessage(bufferSurfaceId, coreMessage);
      return;
    }

    // Tolerate unknown catalogIds by registering an empty stub rather than
    // rejecting the surface.
    if (coreMessage is core.CreateSurfaceMessage) {
      final core.CreateSurfaceMessage createMessage = coreMessage;
      if (!_processor.catalogs.any((c) => c.id == createMessage.catalogId)) {
        _processor.catalogs.add(
          core.Catalog<core.ComponentApi, core.FunctionImplementation>(
            id: createMessage.catalogId,
            components: const [],
          ),
        );
      }
    }

    try {
      _processor.processMessages([coreMessage]);
    } on core.A2uiStateError catch (e) {
      genUiLogger.warning('State error from MessageProcessor: ${e.message}');
      reportError(
        A2uiValidationException(
          e.message,
          surfaceId: _surfaceIdOf(coreMessage),
        ),
        StackTrace.current,
      );
      return;
    } on core.A2uiValidationError catch (e) {
      genUiLogger.warning(
        'Validation error from MessageProcessor: ${e.message}',
      );
      reportError(
        A2uiValidationException(
          e.message,
          surfaceId: _surfaceIdOf(coreMessage),
        ),
        StackTrace.current,
      );
      return;
    } on core.A2uiDataError catch (e) {
      genUiLogger.warning('Data error from MessageProcessor: ${e.message}');
      reportError(
        A2uiValidationException(
          e.message,
          surfaceId: _surfaceIdOf(coreMessage),
          path: e.path,
        ),
        StackTrace.current,
      );
      return;
    } on core.A2uiError catch (e) {
      genUiLogger.warning(
        '${e.runtimeType} from MessageProcessor: ${e.message}',
      );
      reportError(
        A2uiValidationException(
          e.message,
          surfaceId: _surfaceIdOf(coreMessage),
        ),
        StackTrace.current,
      );
      return;
    } on A2uiValidationException catch (e) {
      genUiLogger.warning('Validation failed for surface ${e.surfaceId}: $e');
      reportError(e, StackTrace.current);
      return;
    } catch (exception, stackTrace) {
      genUiLogger.severe(
        'Error handling message: $coreMessage',
        exception,
        stackTrace,
      );
      reportError(exception, stackTrace);
      return;
    }

    if (coreMessage is core.UpdateComponentsMessage) {
      final core.SurfaceModel<core.ComponentApi>? surface = _processor
          .groupModel
          .getSurface(coreMessage.surfaceId);
      if (surface != null) {
        _registry.notifyUpdated(surface);
        // Validation does not roll back the mutation; we surface the error
        // and let the caller decide.
        final Catalog? genuiCatalog = catalogs.firstWhereOrNull(
          (c) => c.matchesId(surface.catalog.id),
        );
        if (genuiCatalog != null) {
          _validateComponents(
            coreMessage.surfaceId,
            surface,
            genuiCatalog,
          ).catchError((Object error, StackTrace stack) {
            if (_onSubmit.isClosed) return;
            if (error is A2uiValidationException) {
              genUiLogger.warning(
                'Schema validation failed for surface '
                '${error.surfaceId}: $error',
              );
              reportError(error, stack);
            } else {
              genUiLogger.severe(
                'Unexpected error during surface validation',
                error,
                stack,
              );
            }
          });
        }
      }
    }
  }

  /// If [message] targets a surface that does not yet exist, returns that
  /// surfaceId so the caller can buffer the message. Otherwise returns null.
  String? _bufferSurfaceIdIfNoSurface(core.AgentToRendererMessage message) {
    final String? targetId = switch (message) {
      core.UpdateComponentsMessage(:final surfaceId) => surfaceId,
      core.UpdateDataModelMessage(:final surfaceId) => surfaceId,
      _ => null,
    };
    if (targetId == null) return null;
    if (_processor.groupModel.getSurface(targetId) != null) return null;
    return targetId;
  }

  String? _surfaceIdOf(core.AgentToRendererMessage message) =>
      switch (message) {
        core.CreateSurfaceMessage(:final surfaceId) => surfaceId,
        core.UpdateComponentsMessage(:final surfaceId) => surfaceId,
        core.UpdateDataModelMessage(:final surfaceId) => surfaceId,
        core.DeleteSurfaceMessage(:final surfaceId) => surfaceId,
        _ => null,
      };

  void _onCoreSurfaceCreated(core.SurfaceModel<core.ComponentApi> surface) {
    _registry.addSurface(surface);
    final List<core.AgentToRendererMessage>? pending = _pendingUpdates.remove(
      surface.id,
    );
    _pendingUpdateTimers.remove(surface.id)?.cancel();
    if (pending != null) {
      for (final core.AgentToRendererMessage message in pending) {
        _handleCoreMessage(message);
      }
    }
  }

  void _onCoreSurfaceDeleted(String surfaceId) {
    _pendingUpdates.remove(surfaceId);
    _pendingUpdateTimers.remove(surfaceId)?.cancel();
    _liveDataModels.remove(surfaceId)?.dispose();
    _registry.removeSurface(surfaceId);
  }

  /// Reports an error to the AI service.
  void reportError(Object error, StackTrace? stack) {
    final Map<String, Object> errorMsg = {
      'version': 'v0.9',
      'error': _errorToMap(error),
    };
    if (!_onSubmit.isClosed) {
      _onSubmit.add(
        ChatMessage.user(
          '',
          parts: [UiInteractionPart.create(jsonEncode(errorMsg))],
        ),
      );
    }
  }

  Map<String, Object> _errorToMap(Object error) {
    var errorCode = 'INTERNAL_ERROR';
    var message = 'An unexpected system error occurred.';
    String? surfaceId;
    String? path;
    String? functionName;

    if (error is A2uiValidationException) {
      errorCode = 'VALIDATION_FAILED';
      message = error.message;
      surfaceId = error.surfaceId;
      path = error.path;
    } else if (error is A2uiFunctionException) {
      errorCode = 'FUNCTION_EXECUTION_FAILED';
      message = error.message;
      functionName = error.functionName;
    }

    return {
      'code': errorCode,
      'surfaceId': ?surfaceId,
      'path': ?path,
      'functionName': ?functionName,
      'message': message,
    };
  }

  void _bufferMessage(String surfaceId, core.AgentToRendererMessage message) {
    _pendingUpdates.putIfAbsent(surfaceId, () => []).add(message);
    if (!_pendingUpdateTimers.containsKey(surfaceId)) {
      _pendingUpdateTimers[surfaceId] = Timer(pendingUpdateTimeout, () {
        _pendingUpdates.remove(surfaceId);
        _pendingUpdateTimers.remove(surfaceId);
      });
    }
  }

  /// Sends a [UserActionEvent] to [onSubmit] as a [ChatMessage]. No-op for
  /// non-action [UiEvent]s.
  void handleUiEvent(UiEvent event) {
    if (!event.isUserAction) return;
    _onSubmit.add(
      ChatMessage.user(
        '',
        parts: [
          UiInteractionPart.create(
            jsonEncode({'version': 'v0.9', 'action': event.toMap()}),
          ),
        ],
      ),
    );
  }

  Catalog? _findCatalogForSurface(String surfaceId) {
    final core.SurfaceModel<core.ComponentApi>? surface = _registry
        .getLiveSurface(surfaceId);
    if (surface == null) return null;
    return catalogs.firstWhereOrNull((c) => c.matchesId(surface.catalog.id));
  }

  /// Validates the components currently in [surface] against [catalog]'s
  /// schema. Throws [A2uiValidationException] on the first failing component.
  Future<void> _validateComponents(
    String surfaceId,
    core.SurfaceModel<core.ComponentApi> surface,
    Catalog catalog,
  ) async {
    final SchemaRegistry registry = _createSchemaRegistry(catalog);
    await schema_validation.validateComponents(
      surfaceId: surfaceId,
      components: surface.componentsModel.all.map(
        (c) => (id: c.id, type: c.type, json: c.toJson()),
      ),
      schema: catalog.definition,
      registry: registry,
    );
  }

  /// Disposes of the controller and releases all resources.
  void dispose() {
    _processor.groupModel.onSurfaceCreated.removeListener(
      _onCoreSurfaceCreated,
    );
    _processor.groupModel.onSurfaceDeleted.removeListener(
      _onCoreSurfaceDeleted,
    );
    _processor.groupModel.dispose();
    for (final DataModel model in _liveDataModels.values) {
      model.dispose();
    }
    _registry.dispose();
    _onSubmit.close();
    for (final Timer timer in _pendingUpdateTimers.values) {
      timer.cancel();
    }
  }
}

class _ControllerContext implements SurfaceContext {
  _ControllerContext(this._controller, this.surfaceId);
  final SurfaceController _controller;

  @override
  final String surfaceId;

  @override
  ValueListenable<SurfaceDefinition?> get definition =>
      _controller.registry.watchSurface(surfaceId);

  @override
  DataModel get dataModel => _controller._dataModelFor(surfaceId);

  @override
  Catalog? get catalog => _controller._findCatalogForSurface(surfaceId);

  @override
  void handleUiEvent(UiEvent event) => _controller.handleUiEvent(event);

  @override
  void reportError(Object error, StackTrace? stack) =>
      _controller.reportError(error, stack);
}
