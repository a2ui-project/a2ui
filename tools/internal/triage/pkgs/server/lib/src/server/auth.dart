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
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:shelf/shelf.dart';

import 'config.dart';
import 'cookies.dart';

/// The OAuth scope the app asks for: write access to public repositories,
/// for comments, labels, assignees, milestones and closing.
const String oauthScope = 'public_repo';

/// The `User-Agent` of the server's requests to GitHub, which GitHub
/// requires.
const String userAgent = 'a2ui-triage-ui';

/// Handles `/auth/`: signing in with GitHub, signing in with a pasted token,
/// signing out, and telling the app who is signed in. The README describes
/// the steps.
final class Auth {
  Auth(this._config, this._cookies, this._http);

  final ServerConfig _config;
  final Cookies _cookies;
  final http.Client _http;
  final Random _random = Random.secure();

  /// Handles a request whose path starts with `auth/`.
  Future<Response> handle(Request request) async =>
      switch ((request.method, request.url.path)) {
        ('GET', 'auth/status') => _status(request),
        ('GET', 'auth/login') => _login(request),
        ('GET', 'auth/callback') => _callback(request),
        ('POST', 'auth/token') => _token(request),
        ('POST', 'auth/logout') => _logout(request),
        _ => Response.notFound('Not found.'),
      };

  /// Step 4 and 14: whether the triager is signed in, and as whom.
  Future<Response> _status(Request request) async {
    if (!hasRequiredHeader(request)) return _missingHeader();
    final Session? session = await _cookies.session(request);
    return _json(200, {
      'oauth': _config.oauthEnabled,
      'signedIn': session != null,
      'login': ?session?.login,
    });
  }

  /// Step 7: starts signing in with GitHub, and sends the browser to GitHub.
  Future<Response> _login(Request request) async {
    if (!_config.oauthEnabled) {
      return Response.notFound('"Sign in with GitHub" is off.');
    }
    final String state = _randomString();
    final String verifier = _randomString();
    final String challenge = base64Url
        .encode(sha256.convert(ascii.encode(verifier)).bytes)
        .replaceAll('=', '');
    final Uri authorize = _config.githubWeb
        .resolve('login/oauth/authorize')
        .replace(
          queryParameters: {
            'client_id': _config.oauthClientId!,
            'redirect_uri': _config.callbackUrl.toString(),
            'scope': oauthScope,
            'state': state,
            'code_challenge': challenge,
            'code_challenge_method': 'S256',
            'allow_signup': 'false',
          },
        );
    return Response.found(
      authorize,
      headers: {
        'set-cookie': await _cookies.setSignIn({
          'state': state,
          'verifier': verifier,
          'return': safeReturnPath(request.url.queryParameters['return']),
        }),
        'cache-control': 'no-store',
      },
    );
  }

  /// Steps 10 to 13: GitHub sent the triager back. Checks the state,
  /// exchanges the code for the token, and stores it in the session cookie.
  Future<Response> _callback(Request request) async {
    final Map<String, String> query = request.url.queryParameters;
    final Map<String, Object?>? signIn = await _cookies.signIn(request);
    if (query['error'] case final String error) {
      return _errorPage(
        'GitHub did not sign you in: ${query['error_description'] ?? error}',
      );
    }
    if (signIn == null) {
      return _errorPage(
        'The sign-in took more than ${Cookies.signInMaxAge.inMinutes} '
        'minutes, or started in another browser.',
      );
    }
    final String? code = query['code'];
    if (code == null || query['state'] != signIn['state']) {
      return _errorPage('The sign-in did not start in this browser.');
    }

    final http.Response response;
    final String? login;
    final Object? json;
    try {
      response = await _http.post(
        _config.githubWeb.resolve('login/oauth/access_token'),
        headers: {'accept': 'application/json', 'user-agent': userAgent},
        body: {
          'client_id': _config.oauthClientId!,
          'client_secret': _config.oauthClientSecret!,
          'code': code,
          'redirect_uri': _config.callbackUrl.toString(),
          'code_verifier': '${signIn['verifier']}',
        },
      );
      json = _decode(response.body);
      login = switch (json) {
        {'access_token': final String token} => await fetchLogin(token),
        _ => null,
      };
    } on http.ClientException catch (e) {
      return _errorPage('Cannot reach GitHub: ${e.message}');
    } on GitHubUnavailableException catch (e) {
      return _errorPage(e.message);
    }
    if (json case {'access_token': final String token}) {
      if (login == null) return _errorPage('GitHub did not accept the token.');
      return Response.found(
        '${signIn['return']}',
        headers: {
          'set-cookie': [
            await _cookies.setSession(
              Session(token: token, login: login, fromOAuth: true),
            ),
            _cookies.clearSignIn(),
          ],
          'cache-control': 'no-store',
        },
      );
    }
    final String reason = switch (json) {
      {'error_description': final String description} => description,
      {'error': final String error} => error,
      _ => 'GitHub answered ${response.statusCode}.',
    };
    return _errorPage('GitHub did not sign you in: $reason');
  }

  /// "Use a token": checks the pasted token with GitHub, and stores it in the
  /// session cookie.
  Future<Response> _token(Request request) async {
    if (!hasRequiredHeader(request)) return _missingHeader();
    final String? token = switch (_decode(await request.readAsString())) {
      {'token': final String token} when token.trim().isNotEmpty =>
        token.trim(),
      _ => null,
    };
    if (token == null) {
      return _json(400, {'message': 'Expected {"token": "<GitHub token>"}.'});
    }
    final String? login;
    try {
      login = await fetchLogin(token);
    } on GitHubUnavailableException catch (e) {
      return _json(502, {'message': e.message});
    }
    if (login == null) {
      return _json(401, {'message': 'GitHub did not accept this token.'});
    }
    return _json(
      200,
      {'login': login},
      headers: {
        'set-cookie': await _cookies.setSession(
          Session(token: token, login: login),
        ),
      },
    );
  }

  /// Step 19: signs out by deleting the session cookie, and revokes a token
  /// from "Sign in with GitHub", so that a copy of the cookie stops working
  /// too. A pasted token is the triager's own, such as the one of `gh`, so
  /// it stays valid.
  Future<Response> _logout(Request request) async {
    if (!hasRequiredHeader(request)) return _missingHeader();
    final Session? session = await _cookies.session(request);
    if (session != null && session.fromOAuth && _config.oauthEnabled) {
      await _revoke(session.token);
    }
    return Response(204, headers: {'set-cookie': _cookies.clearSession()});
  }

  /// Revokes [token], a token of the OAuth App. Signing out goes on if this
  /// fails: the cookie is deleted anyway.
  Future<void> _revoke(String token) async {
    final String credentials = base64.encode(
      utf8.encode('${_config.oauthClientId}:${_config.oauthClientSecret}'),
    );
    try {
      await _http.delete(
        _config.githubApi.resolve(
          'applications/${Uri.encodeComponent(_config.oauthClientId!)}/token',
        ),
        headers: {
          'accept': 'application/vnd.github+json',
          'authorization': 'Basic $credentials',
          'content-type': 'application/json',
          'user-agent': userAgent,
        },
        body: jsonEncode({'access_token': token}),
      );
    } on http.ClientException {
      // The token stays valid until the triager revokes it on GitHub.
    }
  }

  /// The login of the owner of [token], or null if GitHub does not accept
  /// it.
  ///
  /// Throws a [GitHubUnavailableException] if GitHub cannot be reached or
  /// answers with another error.
  Future<String?> fetchLogin(String token) async {
    final http.Response response;
    try {
      response = await _http.get(
        _config.githubApi.resolve('user'),
        headers: {
          'accept': 'application/vnd.github+json',
          'authorization': 'Bearer $token',
          'user-agent': userAgent,
        },
      );
    } on http.ClientException catch (e) {
      throw GitHubUnavailableException('Cannot reach GitHub: ${e.message}');
    }
    if (response.statusCode == 401) return null;
    return switch (_decode(response.body)) {
      {'login': final String login} when response.statusCode == 200 => login,
      _ => throw GitHubUnavailableException(
        'GitHub answered ${response.statusCode}.',
      ),
    };
  }

  String _randomString() => base64Url
      .encode([for (var i = 0; i < 32; i++) _random.nextInt(256)])
      .replaceAll('=', '');

  Response _errorPage(String message) => Response(
    400,
    body:
        '<!DOCTYPE html><meta charset="utf-8"><title>A2UI triage</title>'
        '<p>${const HtmlEscape().convert(message)}</p>'
        '<p><a href="/">Back to the triage UI</a></p>',
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'set-cookie': _cookies.clearSignIn(),
      'cache-control': 'no-store',
    },
  );
}

/// [path] if it is a path on this server, such as `/?item=…`, or else `/`,
/// so that the sign-in cannot send the triager to another site.
///
/// Browsers remove tabs and newlines from a URL before they parse it, so
/// `/<tab>/evil.example` would be followed as `//evil.example`: control
/// characters are rejected too.
String safeReturnPath(String? path) {
  if (path == null ||
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.contains(r'\') ||
      path.codeUnits.any((int c) => c < 0x20 || c == 0x7f)) {
    return '/';
  }
  final Uri? uri = Uri.tryParse(path);
  if (uri == null || uri.hasScheme || uri.hasAuthority) return '/';
  return path;
}

/// GitHub cannot be reached, or answered with an unexpected error.
final class GitHubUnavailableException implements Exception {
  const GitHubUnavailableException(this.message);

  final String message;

  @override
  String toString() => message;
}

Response _missingHeader() => _json(403, {
  'message': 'The request must have the "$requiredHeader" header.',
});

Response _json(
  int status,
  Map<String, Object?> body, {
  Map<String, Object> headers = const {},
}) => Response(
  status,
  body: jsonEncode(body),
  headers: {
    ...headers,
    'content-type': 'application/json',
    'cache-control': 'no-store',
  },
);

Object? _decode(String body) {
  try {
    return jsonDecode(body);
  } on FormatException {
    return null;
  }
}
