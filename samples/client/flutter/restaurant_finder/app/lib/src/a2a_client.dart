// Copyright 2026 Google LLC
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
import 'dart:convert';

import 'package:http/http.dart' as http;

/// A failed request to an A2A agent.
class A2aException implements Exception {
  A2aException(this.message);

  final String message;

  @override
  String toString() => 'A2aException: $message';
}

/// Sends messages to an A2A agent with the JSON-RPC `message/stream` method
/// and reads the server-sent events of its reply.
class A2aClient {
  A2aClient({
    required this.url,
    this.extensions = const [],
    http.Client? httpClient,
  }) : _httpClient = httpClient ?? http.Client();

  final Uri url;

  /// The A2A extensions the client activates, sent in the
  /// `X-A2A-Extensions` header.
  final List<String> extensions;

  final http.Client _httpClient;
  int _requestId = 0;

  /// Sends [message], an A2A `Message` as JSON, and returns the `result` of
  /// each event the agent streams back.
  ///
  /// Throws [A2aException] when the request fails or the agent returns a
  /// JSON-RPC error.
  Stream<Map<String, Object?>> sendMessageStream(
    Map<String, Object?> message,
  ) async* {
    final request = http.Request('POST', url)
      ..headers.addAll({
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        if (extensions.isNotEmpty) 'X-A2A-Extensions': extensions.join(','),
      })
      ..body = jsonEncode({
        'jsonrpc': '2.0',
        'id': _requestId++,
        'method': 'message/stream',
        'params': {'message': message},
      });

    final http.StreamedResponse response;
    try {
      response = await _httpClient.send(request);
    } on http.ClientException catch (e) {
      throw A2aException(e.message);
    }
    if (response.statusCode >= 400) {
      final String body = await response.stream.bytesToString();
      throw A2aException('HTTP ${response.statusCode}: $body');
    }

    final data = <String>[];
    await for (final String line
        in response.stream
            .transform(utf8.decoder)
            .transform(const LineSplitter())) {
      if (line.startsWith('data:')) {
        data.add(line.substring(5).trim());
      } else if (line.isEmpty && data.isNotEmpty) {
        final Map<String, Object?>? result = _parseEvent(data.join('\n'));
        data.clear();
        if (result != null) yield result;
      }
    }
    if (data.isNotEmpty) {
      final Map<String, Object?>? result = _parseEvent(data.join('\n'));
      if (result != null) yield result;
    }
  }

  Map<String, Object?>? _parseEvent(String data) {
    final Object? event;
    try {
      event = jsonDecode(data);
    } on FormatException catch (e) {
      throw A2aException('Invalid event from the agent: ${e.message}');
    }
    if (event is! Map<String, Object?>) {
      throw A2aException('Invalid event from the agent: $data');
    }
    if (event['error'] case final Map<String, Object?> error) {
      throw A2aException(
        'JSON-RPC error ${error['code']}: ${error['message']}',
      );
    }
    return switch (event['result']) {
      final Map<String, Object?> result => result,
      _ => null,
    };
  }

  /// Closes the HTTP client.
  void close() => _httpClient.close();
}
