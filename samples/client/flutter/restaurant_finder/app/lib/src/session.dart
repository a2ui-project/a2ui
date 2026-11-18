// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import 'dart:async';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/v0_9/basic_catalog.dart';
import 'package:flutter/foundation.dart';
import 'package:logging/logging.dart';

import 'a2a/a2a_connector.dart';
import 'primitives.dart';

const String defaultServerUrl = 'http://localhost:10002';

class RestaurantSession extends ChangeNotifier {
  RestaurantSession({String serverUrl = defaultServerUrl}) {
    final CatalogImplementation catalog = basicCatalog();
    _connector = A2uiAgentConnector(url: Uri.parse(serverUrl));
    _processor = MessageProcessor<ComponentImplementation>(
      catalogs: [catalog],
      defaultVersion: A2uiProtocolVersion.v0_9,
    );
    _capabilities = _processor
        .getRendererCapabilities(
          const CapabilitiesOptions(versions: [A2uiProtocolVersion.v0_9]),
        )
        .toJson();
    _actionSub = _processor.model.onAction.subscribe(_handleActionFromSurface);
    _createdSub = _processor.model.onSurfaceCreated.subscribe(
      (_) => notifyListeners(),
    );
    _deletedSub = _processor.model.onSurfaceDeleted.subscribe(
      (_) => notifyListeners(),
    );
  }

  late final A2uiAgentConnector _connector;
  late final MessageProcessor<ComponentImplementation> _processor;
  late final Map<String, Object?> _capabilities;

  bool _isRequesting = false;
  bool get isRequesting => _isRequesting;

  bool _isDisposed = false;

  bool _hasSentMessage = false;
  bool get hasSentMessage => _hasSentMessage;

  final LoadingTexts _loadingTexts = LoadingTexts();
  String get loadingText => _loadingTexts.current;

  String? _error;
  String? get error => _error;

  Iterable<String> get activeSurfaceIds =>
      _processor.model.allSurfaces.map((s) => s.id);

  SurfaceModel<ComponentImplementation>? surfaceFor(String surfaceId) =>
      _processor.model.getSurface(surfaceId);

  final Logger _logger = Logger('RestaurantSession');
  Timer? _loadingTimer;

  StreamIterator<AgentToRendererMessage>? _activeIterator;
  late final Subscription _actionSub;
  late final Subscription _createdSub;
  late final Subscription _deletedSub;

  void _handleActionFromSurface(A2uiRendererAction action) {
    final Map<String, Object?> payload = ActionMessage(
      version: A2uiProtocolVersion.v0_9.jsonValue,
      action: action,
    ).toJson();
    unawaited(
      _sendToAgent(
        () => _connector.sendData(payload, clientCapabilities: _capabilities),
      ),
    );
  }

  void _startLoadingAnimation() {
    _loadingTexts.reset();
    _loadingTimer = Timer.periodic(const Duration(seconds: 2), (_) {
      _loadingTexts.advance();
      notifyListeners();
    });
  }

  void _stopLoadingAnimation() {
    _loadingTimer?.cancel();
    _loadingTimer = null;
  }

  Future<void> sendMessage(String text) async {
    if (text.isEmpty) return;
    await _sendToAgent(
      () => _connector.sendText(text, clientCapabilities: _capabilities),
      clearSurfaces: true,
    );
  }

  Future<void> _sendToAgent(
    Stream<AgentToRendererMessage> Function() send, {
    bool clearSurfaces = false,
  }) async {
    if (_isRequesting) return;
    _isRequesting = true;
    _hasSentMessage = true;
    _error = null;
    _startLoadingAnimation();

    // Clear existing surfaces on each new text request.
    if (clearSurfaces && activeSurfaceIds.isNotEmpty) {
      _processor.processMessages([
        for (final String id in [...activeSurfaceIds])
          DeleteSurfaceMessage(
            version: A2uiProtocolVersion.v0_9.jsonValue,
            surfaceId: id,
          ),
      ]);
    }

    notifyListeners();
    final StreamIterator<AgentToRendererMessage> iterator = StreamIterator(
      send(),
    );
    _activeIterator = iterator;
    try {
      while (await iterator.moveNext()) {
        _processor.processMessages(
          AgentToRendererMessagePayload.of(iterator.current),
        );
      }
    } catch (e, st) {
      _error = e.toString();
      _logger.severe('Error sending message', e, st);
    } finally {
      _activeIterator = null;
      unawaited(iterator.cancel());
      _isRequesting = false;
      _stopLoadingAnimation();
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _isDisposed = true;
    unawaited(_activeIterator?.cancel());
    _actionSub.unsubscribe();
    _createdSub.unsubscribe();
    _deletedSub.unsubscribe();
    _loadingTimer?.cancel();
    _processor.dispose();
    super.dispose();
  }

  @override
  void notifyListeners() {
    if (_isDisposed) return;
    super.notifyListeners();
  }
}
