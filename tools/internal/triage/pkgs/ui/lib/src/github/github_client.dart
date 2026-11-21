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

/// A request to GitHub that failed, with the reason in [message].
final class GitHubException implements Exception {
  const GitHubException(this.message, {this.statusCode});

  final String message;

  /// The HTTP status of GitHub's response, or null if there was none.
  final int? statusCode;

  @override
  String toString() => message;
}

/// Calls the GitHub REST and GraphQL APIs with a token.
class GitHubClient {
  GitHubClient({required String token, http.Client? httpClient})
    : _token = token,
      _http = httpClient ?? http.Client();

  final String _token;
  final http.Client _http;

  static final Uri _api = Uri.parse('https://api.github.com/');

  /// Runs a GraphQL [query] and returns its `data`.
  ///
  /// Throws a [GitHubException] if GitHub returns errors.
  Future<Map<String, Object?>> graphql(
    String query, [
    Map<String, Object?> variables = const {},
  ]) async {
    final response =
        await _send('POST', 'graphql', {'query': query, 'variables': variables})
            as Map<String, Object?>;
    if (response['errors'] case final List<Object?> errors
        when errors.isNotEmpty) {
      throw GitHubException(
        errors
            .map((Object? e) => (e! as Map<String, Object?>)['message'])
            .join(' '),
      );
    }
    return response['data']! as Map<String, Object?>;
  }

  /// Sends a REST request and returns the decoded JSON response, or null if
  /// the response has no body.
  ///
  /// [path] is relative to `https://api.github.com/`, with its parts already
  /// encoded. Throws a [GitHubException] if the request fails.
  Future<Object?> rest(String method, String path, [Object? body]) =>
      _send(method, path, body);

  Future<Object?> _send(String method, String path, Object? body) async {
    final request = http.Request(method, _api.resolve(path))
      ..headers.addAll({
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer $_token',
        'X-GitHub-Api-Version': '2022-11-28',
      });
    if (body != null) {
      request
        ..headers['Content-Type'] = 'application/json'
        ..body = jsonEncode(body);
    }

    final http.Response response;
    try {
      response = await http.Response.fromStream(await _http.send(request));
    } on http.ClientException catch (e) {
      throw GitHubException('Cannot reach GitHub: ${e.message}');
    }

    final Object? json = response.body.isEmpty
        ? null
        : jsonDecode(response.body);
    if (response.statusCode >= 300) {
      final String reason = switch (json) {
        {'message': final String message} => message,
        _ => response.reasonPhrase ?? 'no reason given',
      };
      throw GitHubException(
        'GitHub answered ${response.statusCode}: $reason',
        statusCode: response.statusCode,
      );
    }
    return json;
  }

  void close() => _http.close();
}
