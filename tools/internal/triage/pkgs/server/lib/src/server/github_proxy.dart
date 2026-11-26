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
import 'graphql_mutations.dart';

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

  /// The repositories whose items the app changes.
  static const List<String> _repositories = [
    'a2ui-project/a2ui',
    'flutter/genui',
  ];

  /// The calls that the app makes, as the method and the path relative to
  /// the GitHub API. The proxy passes on no others, so that a token that
  /// allows more, such as the one of `gh`, is only used for triage.
  static final List<(String, RegExp)> _allowedCalls = () {
    final repository =
        'repos/(?:${_repositories.map(RegExp.escape).join('|')})';
    final issue = '$repository/issues/[0-9]+';
    return [
      ('POST', RegExp(r'^graphql$')),
      ('PATCH', RegExp('^$issue\$')),
      ('POST', RegExp('^$issue/comments\$')),
      ('POST', RegExp('^$issue/labels\$')),
      ('DELETE', RegExp('^$issue/labels/[^/]+\$')),
      ('POST', RegExp('^$issue/assignees\$')),
      ('DELETE', RegExp('^$issue/assignees\$')),
      ('POST', RegExp('^$repository/pulls/[0-9]+/requested_reviewers\$')),
    ];
  }();

  /// The GraphQL mutations that the app makes. It also makes queries, which
  /// change nothing.
  static const Set<String> _allowedMutations = {
    'closeIssue',
    'closePullRequest',
  };

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

    final Uri? target = _target(request);
    if (target == null) return _json(400, 'Not a GitHub API path.');
    final String apiPath = target.path.substring(_config.githubApi.path.length);
    if (!_allowedCalls.any(
      ((String, RegExp) call) =>
          call.$1 == request.method && call.$2.hasMatch(apiPath),
    )) {
      return _json(
        403,
        'The triage UI does not make this call: ${request.method} /$apiPath',
      );
    }

    final upstream = http.Request(request.method, target)
      ..followRedirects = false
      ..headers.addAll({
        for (final String name in _requestHeaders)
          if (request.headers[name] case final String value) name: value,
        'authorization': 'Bearer ${session.token}',
        'user-agent': userAgent,
      });
    if (request.method != 'GET' && request.method != 'HEAD') {
      upstream.bodyBytes = await request
          .read()
          .expand((chunk) => chunk)
          .toList();
    }
    if (apiPath == 'graphql') {
      if (_graphQLError(upstream.bodyBytes) case final Response error) {
        return error;
      }
    }

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
        // A redirect, for example of a renamed repository, goes through the
        // proxy too.
        if (response.headers['location'] case final String location)
          'location': _rewriteLink(location),
        'cache-control': 'no-store',
        // GitHub no longer accepts the token, for example because the
        // triager revoked it, so the app asks the triager to sign in again.
        if (response.statusCode == 401) 'set-cookie': _cookies.clearSession(),
      },
    );
  }

  /// The GitHub API URL that [request] is for, or null if it is not one.
  ///
  /// A path such as `http://evil.example/` or `//evil.example/` would
  /// replace the host, and the token must only go to GitHub.
  Uri? _target(Request request) {
    final String path = request.url.path.substring('github'.length);
    final Uri target;
    try {
      target = _config.githubApi
          .resolve(path.startsWith('/') ? path.substring(1) : path)
          .replace(query: request.url.hasQuery ? request.url.query : null);
    } on FormatException {
      return null;
    }
    // Checked before `origin`, which throws for other URLs, such as the
    // `foo:bar` that `/github/foo:bar` resolves to.
    if (!(target.isScheme('http') || target.isScheme('https')) ||
        !target.hasAuthority ||
        target.origin != _config.githubApi.origin ||
        !target.path.startsWith(_config.githubApi.path)) {
      return null;
    }
    return target;
  }

  /// A 400 or 403 response if [body] is not a GraphQL request whose
  /// mutations are in [_allowedMutations], or else null.
  Response? _graphQLError(List<int> body) {
    final Object? json;
    try {
      json = jsonDecode(utf8.decode(body));
    } on FormatException {
      return _json(400, 'Expected {"query": "<GraphQL query>"}.');
    }
    if (json case {'query': final String query}) {
      final Set<String>? fields = mutationFields(query);
      if (fields == null || !_allowedMutations.containsAll(fields)) {
        return _json(
          403,
          'The triage UI does not make this GraphQL call. Its mutations are '
          '${_allowedMutations.join(' and ')}.',
        );
      }
      return null;
    }
    return _json(400, 'Expected {"query": "<GraphQL query>"}.');
  }

  /// Points the GitHub API URLs in a `Link` or `Location` header at the
  /// proxy, so that the app's next requests also go through it.
  String _rewriteLink(String link) =>
      link.replaceAll(_config.githubApi.toString(), '/github/');
}

Response _json(int status, String message) => Response(
  status,
  body: jsonEncode({'message': message}),
  headers: {'content-type': 'application/json', 'cache-control': 'no-store'},
);
