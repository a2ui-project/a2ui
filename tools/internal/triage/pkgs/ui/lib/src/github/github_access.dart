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

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared/shared.dart';

import 'browser.dart';

/// Where the app is in signing the triager in to GitHub.
enum SignInState {
  /// Asking the server whether the triager is signed in.
  checking,

  /// The triager has to sign in.
  signedOut,

  /// The app was built for the server, but the server did not answer.
  serverUnavailable,

  /// The app can call GitHub.
  signedIn,
}

/// The triager's GitHub access: signing in with GitHub or a pasted token,
/// through the server when there is one. The steps are in
/// `pkgs/server/README.md`.
class GitHubAccess extends ChangeNotifier {
  /// [page] is the URL of the app's page, or null outside the web, where
  /// there is neither a page nor a server. [presetToken] is the token to
  /// start with, or empty to show the sign-in. [expectServer] is
  /// `--dart-define=TRIAGE_SERVER=true`, which the server's build sets: then
  /// a failed call to the server is an error, not a sign that `flutter run`
  /// serves the app, so the token never goes to the page's local storage on
  /// the hosted site.
  GitHubAccess({
    required Uri? page,
    required Browser browser,
    http.Client? httpClient,
    String presetToken = '',
    bool expectServer = false,
  }) : _page = page,
       _browser = browser,
       _http = httpClient ?? http.Client(),
       _presetToken = presetToken,
       _expectServer = expectServer;

  /// The header that the server requires on the app's requests.
  static const Map<String, String> serverHeaders = {
    'X-Requested-With': 'triage-ui',
  };

  final Uri? _page;
  final Browser _browser;
  final http.Client _http;
  final String _presetToken;
  final bool _expectServer;

  SignInState _state = SignInState.checking;
  SignInState get state => _state;

  /// Whether the app runs in a page, which it can reload to sign out.
  bool get hasPage => _page != null;

  /// Whether the app was served by the server, rather than by `flutter run`.
  bool get hasServer => _hasServer;
  bool _hasServer = false;

  /// Whether the server offers "Sign in with GitHub".
  bool get canSignInWithGitHub => _canSignInWithGitHub;
  bool _canSignInWithGitHub = false;

  /// The triager's GitHub login, when the server knows it.
  String? get login => _login;
  String? _login;

  /// Why the last sign-in failed, or null.
  String? get error => _error;
  String? _error;

  /// Whether a pasted token is being checked.
  bool get busy => _busy;
  bool _busy = false;

  /// The token the app calls GitHub with directly, or null when it calls
  /// GitHub through the server.
  String? _token;

  Uri _server(String path) => _page!.resolve(path);

  /// Finds out whether the triager is signed in: steps 4 and 14 of the
  /// README, or a preset token or one pasted earlier.
  Future<void> check() async {
    if (_presetToken.isNotEmpty) return _signIn(token: _presetToken);
    if (_page == null) {
      // Outside the web, there is no server to ask, and nothing kept from
      // an earlier run.
      _state = SignInState.signedOut;
      notifyListeners();
      return;
    }

    _state = SignInState.checking;
    _error = null;
    notifyListeners();
    final Object? status = await _getJson(_server('/auth/status'));
    if (status case {
      'signedIn': final bool signedIn,
      'oauth': final bool oauth,
    }) {
      _hasServer = true;
      _canSignInWithGitHub = oauth;
      if (signedIn) return _signIn(login: status['login'] as String?);
    } else if (_expectServer) {
      _state = SignInState.serverUnavailable;
      _error = 'Cannot reach the triage UI server. Try again in a moment.';
      notifyListeners();
      return;
    } else if (_browser.readToken() case final String token) {
      // `flutter run` serves the app, so there is no server.
      return _signIn(token: token);
    }
    _state = SignInState.signedOut;
    notifyListeners();
  }

  /// Step 6: leaves the app for the server's sign-in, which comes back to
  /// this page.
  void signInWithGitHub() {
    final Uri page = _page!;
    final String returnPath = page.hasQuery
        ? '${page.path}?${page.query}'
        : page.path;
    _browser.go(
      _server('/auth/login').replace(queryParameters: {'return': returnPath}),
    );
  }

  /// "Use a token": checks [token] and signs in with it. The server keeps it
  /// in the session cookie. Without the server, the browser keeps it.
  Future<void> useToken(String token) async {
    token = token.trim();
    if (token.isEmpty) return;
    _busy = true;
    _error = null;
    notifyListeners();
    try {
      if (_hasServer) {
        final http.Response response = await _http.post(
          _server('/auth/token'),
          headers: {...serverHeaders, 'Content-Type': 'application/json'},
          body: jsonEncode({'token': token}),
        );
        final Object? json = _decode(response.body);
        if (response.statusCode == 200 && json is Map<String, Object?>) {
          return _signIn(login: json['login'] as String?);
        }
        _error = switch (json) {
          {'message': final String message} => message,
          _ => 'The server answered ${response.statusCode}.',
        };
      } else {
        final client = GitHubClient(token: token, httpClient: _http);
        final Object? user = await client.rest('GET', 'user');
        _browser.writeToken(token);
        return _signIn(
          token: token,
          login: switch (user) {
            {'login': final String login} => login,
            _ => null,
          },
        );
      }
    } on GitHubException catch (e) {
      _error = e.message;
    } on http.ClientException catch (e) {
      _error = 'Cannot reach the server: ${e.message}';
    } finally {
      _busy = false;
      notifyListeners();
    }
  }

  /// Step 19: signs out, and loads the page again to show the sign-in.
  /// Without a page, as on macOS, it shows the sign-in at once.
  Future<void> signOut() async {
    if (_page == null) return _signOut();
    if (_hasServer) {
      try {
        await _http.post(_server('/auth/logout'), headers: serverHeaders);
      } on http.ClientException {
        // Reloading shows whether the triager is still signed in.
      }
    }
    _browser
      ..writeToken(null)
      ..reload();
  }

  /// The client that calls GitHub as the signed-in triager.
  ///
  /// It keeps working after the triager signs in again: it calls GitHub
  /// with the token of the latest sign-in.
  GitHubClient client() {
    if (_state != SignInState.signedIn) {
      throw const GitHubException('Sign in to GitHub first.');
    }
    return _token == null
        ? GitHubClient(
            token: null,
            baseUrl: _server('/github/'),
            headers: serverHeaders,
            httpClient: _SignedInClient(this, direct: false),
          )
        : GitHubClient(
            token: null,
            httpClient: _SignedInClient(this, direct: true),
          );
  }

  void _signIn({String? token, String? login}) {
    _token = token;
    _login = login;
    _error = null;
    _state = SignInState.signedIn;
    notifyListeners();
  }

  void _signOut({String? error}) {
    _token = null;
    _login = null;
    _error = error;
    _state = SignInState.signedOut;
    notifyListeners();
  }

  /// GitHub, or the server for it, answered 401: the token expired or was
  /// revoked, or the server's session ended. The server has already deleted
  /// its session cookie.
  void _rejected() {
    if (_state != SignInState.signedIn) return;
    _browser.writeToken(null);
    _signOut(error: 'GitHub no longer accepts your sign-in. Sign in again.');
  }

  /// Gets [url] from the server and decodes it, or returns null if there is
  /// no server, as when `flutter run` answers with the app's page.
  Future<Object?> _getJson(Uri url) async {
    try {
      final http.Response response = await _http.get(
        url,
        headers: serverHeaders,
      );
      return response.statusCode == 200 ? _decode(response.body) : null;
    } on http.ClientException {
      return null;
    }
  }
}

Object? _decode(String body) {
  try {
    return jsonDecode(body);
  } on FormatException {
    return null;
  }
}

/// Calls GitHub for [GitHubAccess.client]. When [direct], it adds the token
/// of the latest sign-in, since the server adds none. It signs the triager
/// out when GitHub answers 401.
final class _SignedInClient extends http.BaseClient {
  _SignedInClient(this._access, {required this.direct});

  final GitHubAccess _access;
  final bool direct;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (direct) {
      final String? token = _access._token;
      if (token == null) {
        throw const GitHubException('Sign in to GitHub first.');
      }
      request.headers['Authorization'] = 'Bearer $token';
    }
    final http.StreamedResponse response = await _access._http.send(request);
    if (response.statusCode == 401) _access._rejected();
    return response;
  }
}
