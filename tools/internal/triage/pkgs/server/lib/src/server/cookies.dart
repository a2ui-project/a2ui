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

import 'package:shelf/shelf.dart';

import 'config.dart';
import 'sealer.dart';

/// The triager's GitHub sign-in, as the session cookie holds it.
final class Session {
  const Session({required this.token, required this.login});

  /// The triager's GitHub token.
  final String token;

  /// The triager's GitHub login.
  final String login;
}

/// The header that every request to `/auth/` (except the redirects) and to
/// `/github/` must have.
///
/// A page on another site can make the browser send a form or a simple
/// request with the triager's cookies, but cannot add a header without the
/// browser asking this server first, and this server never allows it.
const String requiredHeader = 'x-requested-with';

/// Whether [request] has the [requiredHeader].
bool hasRequiredHeader(Request request) =>
    request.headers[requiredHeader]?.isNotEmpty ?? false;

/// Reads and writes the cookies: the session, and the short-lived state of a
/// sign-in in progress.
final class Cookies {
  Cookies(this._config, this._sealer);

  final ServerConfig _config;
  final Sealer _sealer;

  static const String _sessionName = 'triage_session';
  static const String _signInName = 'triage_sign_in';
  static const String _sessionPurpose = 'session';
  static const String _signInPurpose = 'sign_in';

  /// How long a sign-in lasts.
  static const Duration sessionMaxAge = Duration(days: 30);

  /// How long the triager has to finish signing in on GitHub.
  static const Duration signInMaxAge = Duration(minutes: 10);

  /// The triager's session, or null if the triager is not signed in.
  Future<Session?> session(Request request) async {
    final String? sealed = _read(request, _sessionName);
    if (sealed == null) return null;
    return switch (await _sealer.open(_sessionPurpose, sealed)) {
      {'token': final String token, 'login': final String login} => Session(
        token: token,
        login: login,
      ),
      _ => null,
    };
  }

  /// The `Set-Cookie` header value that stores [session].
  Future<String> setSession(Session session) async => _cookie(
    _sessionName,
    await _sealer.seal(_sessionPurpose, {
      'token': session.token,
      'login': session.login,
    }, maxAge: sessionMaxAge),
    path: '/',
    maxAge: sessionMaxAge,
  );

  /// The `Set-Cookie` header value that deletes the session.
  String clearSession() =>
      _cookie(_sessionName, '', path: '/', maxAge: Duration.zero);

  /// The state of the sign-in in progress, or null if there is none, or it
  /// expired.
  Future<Map<String, Object?>?> signIn(Request request) async {
    final String? sealed = _read(request, _signInName);
    if (sealed == null) return null;
    return _sealer.open(_signInPurpose, sealed);
  }

  /// The `Set-Cookie` header value that stores the state of a sign-in.
  Future<String> setSignIn(Map<String, Object?> state) async => _cookie(
    _signInName,
    await _sealer.seal(_signInPurpose, state, maxAge: signInMaxAge),
    path: '/auth/',
    maxAge: signInMaxAge,
  );

  /// The `Set-Cookie` header value that deletes the state of a sign-in.
  String clearSignIn() =>
      _cookie(_signInName, '', path: '/auth/', maxAge: Duration.zero);

  String _cookie(
    String name,
    String value, {
    required String path,
    required Duration maxAge,
  }) => [
    '$name=$value',
    'Path=$path',
    'Max-Age=${maxAge.inSeconds}',
    'HttpOnly',
    // Lax: the browser sends the cookie when GitHub redirects back to the
    // callback, but not with requests that other sites start.
    'SameSite=Lax',
    if (_config.secureCookies) 'Secure',
  ].join('; ');

  static String? _read(Request request, String name) {
    final String? header = request.headers['cookie'];
    if (header == null) return null;
    for (final String part in header.split(';')) {
      final int equals = part.indexOf('=');
      if (equals < 0) continue;
      if (part.substring(0, equals).trim() == name) {
        final String value = part.substring(equals + 1).trim();
        return value.isEmpty ? null : value;
      }
    }
    return null;
  }
}
