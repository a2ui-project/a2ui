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

import 'dart:convert';

import 'package:http/http.dart' as http;

/// The team's Google Chat space.
abstract interface class TeamChat {
  /// Sends a message with [text], in the Google Chat format.
  Future<void> send(String text);
}

/// A [TeamChat] that sends messages through an incoming webhook.
final class WebhookTeamChat implements TeamChat {
  WebhookTeamChat(this._url, {http.Client? httpClient})
    : _http = httpClient ?? http.Client();

  final Uri _url;
  final http.Client _http;

  @override
  Future<void> send(String text) async {
    final http.Response response = await _http.post(
      _url,
      headers: {'Content-Type': 'application/json; charset=UTF-8'},
      body: jsonEncode({'text': text}),
    );
    if (response.statusCode >= 300) {
      throw http.ClientException(
        'Google Chat answered ${response.statusCode}: ${response.body}',
        _url,
      );
    }
  }

  void close() => _http.close();
}

/// Reads the map from GitHub logins to Google Chat user IDs, as JSON. An
/// empty or missing [json] is an empty map.
///
/// Throws a [FormatException] if [json] is not a JSON object of strings.
Map<String, String> parseChatUsers(String? json) {
  if (json == null || json.trim().isEmpty) return const {};
  final Object? decoded = jsonDecode(json);
  if (decoded is! Map<String, Object?> ||
      decoded.values.any((Object? id) => id is! String)) {
    throw const FormatException(
      'Expected a JSON object that maps GitHub logins to Google Chat user '
      'IDs.',
    );
  }
  return decoded.cast<String, String>();
}
