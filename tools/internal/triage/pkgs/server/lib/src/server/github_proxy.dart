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
import 'package:shelf/shelf.dart';

import 'auth.dart';
import 'config.dart';
import 'cookies.dart';

/// Handles `/github/`: passes the app's GitHub API calls to GitHub with the
/// triager's token from the session cookie (steps 15 to 17 in the README).
final class GitHubProxy {
  GitHubProxy(this._config, this._cookies, this._http);

  final ServerConfig _config;
  final Cookies _cookies;
  final http.Client _http;

  /// The request headers that the proxy passes to GitHub.
  static const List<String> _requestHeaders = [
    'accept',
    'content-type',
    'x-github-api-version',
  ];

  /// The response headers that the proxy passes back to the app.
  static const List<String> _responseHeaders = [
    'content-type',
    'retry-after',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'x-ratelimit-resource',
    'x-ratelimit-used',
  ];

  /// Handles a request whose path is `github` or starts with `github/`.
  Future<Response> handle(Request request) async {
    if (!hasRequiredHeader(request)) {
      return _json(403, 'The request must have the "$requiredHeader" header.');
    }
    final Session? session = await _cookies.session(request);
    if (session == null) {
      return _json(401, 'You are not signed in. Reload the page to sign in.');
    }

    final String path = request.url.path.substring('github'.length);
    final Uri target = _config.githubApi
        .resolve(path.startsWith('/') ? path.substring(1) : path)
        .replace(query: request.url.hasQuery ? request.url.query : null);
    final upstream = http.Request(request.method, target)
      ..followRedirects = false
      ..headers.addAll({
        for (final String name in _requestHeaders)
          if (request.headers[name] case final String value) name: value,
        'authorization': 'Bearer ${session.token}',
        'user-agent': userAgent,
      })
      ..bodyBytes = await request.read().expand((chunk) => chunk).toList();

    final http.Response response;
    try {
      response = await http.Response.fromStream(await _http.send(upstream));
    } on http.ClientException catch (e) {
      return _json(502, 'Cannot reach GitHub: ${e.message}');
    }

    return Response(
      response.statusCode,
      body: response.bodyBytes,
      headers: {
        for (final String name in _responseHeaders)
          if (response.headers[name] case final String value) name: value,
        if (response.headers['link'] case final String link)
          'link': _rewriteLink(link),
        'cache-control': 'no-store',
        // GitHub no longer accepts the token, for example because the
        // triager revoked it, so the app asks the triager to sign in again.
        if (response.statusCode == 401) 'set-cookie': _cookies.clearSession(),
      },
    );
  }

  /// Points the pagination links in a `Link` header at the proxy, so that
  /// the app's next requests also go through it.
  String _rewriteLink(String link) =>
      link.replaceAll(_config.githubApi.toString(), '/github/');
}

Response _json(int status, String message) => Response(
  status,
  body: jsonEncode({'message': message}),
  headers: {'content-type': 'application/json', 'cache-control': 'no-store'},
);
