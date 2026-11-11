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
import 'package:url_launcher/url_launcher.dart';

import 'a2a_client.dart';
import 'primitives.dart';

const String defaultServerUrl = 'http://localhost:10002';

/// The A2UI extension of A2A, which the client activates on every request.
const String _a2uiExtensionUri = 'https://a2ui.org/a2a-extension/a2ui/v0.9';

class RestaurantSession extends ChangeNotifier {
  RestaurantSession({String serverUrl = defaultServerUrl})
    : _client = A2aClient(
        url: Uri.parse(serverUrl),
        extensions: const [_a2uiExtensionUri],
      ) {
    _subscriptions = [
      processor.model.onSurfaceCreated.subscribe(_onSurfaceCreated),
      processor.model.onSurfaceDeleted.subscribe(_onSurfaceDeleted),
      processor.model.onAction.subscribe(_onAction),
      processor.model.onError.subscribe(_onRendererError),
    ];
  }

  static final String _version = A2uiProtocolVersion.v0_9.jsonValue;

  /// Applies the agent's messages. The v0.9 basic catalog is the catalog the
  /// agent advertises (see the Python `BasicCatalog` provider).
  final MessageProcessor<ComponentImplementation> processor = MessageProcessor(
    catalogs: [basicCatalog(openUrl: launchUrl)],
    defaultVersion: A2uiProtocolVersion.v0_9,
    validationConfig: ValidationConfig.relaxed,
    reportErrorsOnly: true,
  );

  final A2aClient _client;
  late final List<Subscription> _subscriptions;

  /// The A2A task and context of the conversation, as the agent last
  /// reported them.
  String? _taskId;
  String? _contextId;
  int _messageCount = 0;

  bool _isRequesting = false;
  bool get isRequesting => _isRequesting;

  bool _isDisposed = false;

  bool _hasSentMessage = false;
  bool get hasSentMessage => _hasSentMessage;

  final LoadingTexts _loadingTexts = LoadingTexts();
  String get loadingText => _loadingTexts.current;

  String? _error;
  String? get error => _error;

  final List<SurfaceModel<ComponentImplementation>> _surfaces = [];

  /// The surfaces the agent has created, in creation order.
  List<SurfaceModel<ComponentImplementation>> get surfaces =>
      List.unmodifiable(_surfaces);

  Iterable<String> get activeSurfaceIds => _surfaces.map((s) => s.id);

  final _logger = Logger('RestaurantSession');
  Timer? _loadingTimer;

  void _onSurfaceCreated(SurfaceModel<ComponentImplementation> surface) {
    _surfaces.add(surface);
    notifyListeners();
  }

  void _onSurfaceDeleted(String surfaceId) {
    _surfaces.removeWhere((s) => s.id == surfaceId);
    notifyListeners();
  }

  void _onAction(A2uiRendererAction action) {
    _sendMessageToAgent([
      _dataPart(ActionMessage(version: _version, action: action).toJson()),
    ]);
  }

  void _onRendererError(A2uiRendererError error) {
    _logger.warning('Renderer error ${error.code}: ${error.message}');
    _sendMessageToAgent([
      _dataPart(ErrorMessage(version: _version, error: error).toJson()),
    ]);
  }

  void _handleStatusUpdate(Map<String, Object?> event) {
    _taskId = event['taskId'] as String? ?? _taskId;
    _contextId = event['contextId'] as String? ?? _contextId;
    final Object? status = event['status'];
    if (status is! Map<String, Object?>) return;

    final Object? message = status['message'];
    if (status['state'] case 'failed' || 'canceled' || 'rejected') {
      _error = 'A2A Error: ${status['state']}: $message';
      _logger.severe(_error);
      notifyListeners();
      return;
    }
    if (message is Map<String, Object?>) _handleAgentMessage(message);
  }

  void _handleAgentMessage(Map<String, Object?> message) {
    final Object? parts = message['parts'];
    if (parts is! List<Object?>) return;
    for (final Object? part in parts) {
      if (part is! Map<String, Object?>) continue;
      switch (part['kind']) {
        case 'data':
          final Object? data = part['data'];
          if (data is Map<String, Object?> && _isA2uiMessage(data)) {
            processor.processMessages(data);
          } else {
            _logger.warning('A2A data part holds no A2UI message.');
          }
        case 'text':
          final String text = (part['text'] as String? ?? '').trim();
          if (text.isNotEmpty) _logger.info('Text from agent: $text');
      }
    }
  }

  static bool _isA2uiMessage(Map<String, Object?> data) =>
      data.containsKey('createSurface') ||
      data.containsKey('updateComponents') ||
      data.containsKey('updateDataModel') ||
      data.containsKey('deleteSurface');

  static Map<String, Object?> _dataPart(Map<String, Object?> data) => {
    'kind': 'data',
    'data': data,
  };

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
    await _sendMessageToAgent([
      {'kind': 'text', 'text': text},
    ]);
  }

  Future<void> _sendMessageToAgent(List<Map<String, Object?>> parts) async {
    if (_isRequesting) return;
    _isRequesting = true;
    _hasSentMessage = true;
    _error = null;
    _startLoadingAnimation();

    // Clear existing surfaces on each new request.
    for (final String id in [...activeSurfaceIds]) {
      processor.processMessages({
        'version': _version,
        'deleteSurface': {'surfaceId': id},
      });
    }

    notifyListeners();
    try {
      final Map<String, Object?> capabilities = processor
          .getRendererCapabilities(
            const CapabilitiesOptions(versions: [A2uiProtocolVersion.v0_9]),
          )
          .toJson();
      final Map<String, Object?> message = {
        'kind': 'message',
        'messageId':
            '${DateTime.now().microsecondsSinceEpoch}-${_messageCount++}',
        'role': 'user',
        'parts': parts,
        'contextId': ?_contextId,
        if (_taskId case final String taskId) 'referenceTaskIds': [taskId],
        'metadata': {'a2uiClientCapabilities': capabilities},
      };
      await for (final Map<String, Object?> event in _client.sendMessageStream(
        message,
      )) {
        if (event['kind'] == 'status-update') _handleStatusUpdate(event);
      }
    } catch (e, st) {
      _error = e.toString();
      _logger.severe('Error sending message', e, st);
    } finally {
      _isRequesting = false;
      _stopLoadingAnimation();
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _isDisposed = true;
    for (final Subscription subscription in _subscriptions) {
      subscription.unsubscribe();
    }
    _loadingTimer?.cancel();
    processor.dispose();
    _client.close();
    super.dispose();
  }

  @override
  void notifyListeners() {
    if (_isDisposed) return;
    super.notifyListeners();
  }
}
