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

/// Where the web app is in signing the triager in to GitHub.
enum SignInState {
  /// Asking the server whether the triager is signed in.
  checking,

  /// The triager has to sign in.
  signedOut,

  /// The app can call GitHub.
  signedIn,
}

/// The triager's GitHub access in the web app: signing in with GitHub or a
/// pasted token, through the server when there is one. The steps are in
/// `pkgs/server/README.md`.
class GitHubAccess extends ChangeNotifier {
  /// [page] is the URL of the app's page. [compiledToken] is the token from
  /// `--dart-define=GITHUB_TOKEN`, or empty.
  GitHubAccess({
    required Uri page,
    required Browser browser,
    http.Client? httpClient,
    String compiledToken = '',
  }) : _page = page,
       _browser = browser,
       _http = httpClient ?? http.Client(),
       _compiledToken = compiledToken;

  /// The header that the server requires on the app's requests.
  static const Map<String, String> serverHeaders = {
    'X-Requested-With': 'triage-ui',
  };

  final Uri _page;
  final Browser _browser;
  final http.Client _http;
  final String _compiledToken;

  SignInState _state = SignInState.checking;
  SignInState get state => _state;

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

  Uri _server(String path) => _page.resolve(path);

  /// Finds out whether the triager is signed in: steps 4 and 14 of the
  /// README, or a token from `--dart-define` or pasted earlier.
  Future<void> check() async {
    if (_compiledToken.isNotEmpty) return _signIn(token: _compiledToken);

    final Object? status = await _getJson(_server('/auth/status'));
    if (status case {
      'signedIn': final bool signedIn,
      'oauth': final bool oauth,
    }) {
      _hasServer = true;
      _canSignInWithGitHub = oauth;
      if (signedIn) return _signIn(login: status['login'] as String?);
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
    final String returnPath = _page.hasQuery
        ? '${_page.path}?${_page.query}'
        : _page.path;
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
  Future<void> signOut() async {
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
  GitHubClient client() {
    if (_state != SignInState.signedIn) {
      throw const GitHubException('Sign in to GitHub first.');
    }
    return _token == null
        ? GitHubClient(
            token: null,
            baseUrl: _server('/github/'),
            headers: serverHeaders,
            httpClient: _http,
          )
        : GitHubClient(token: _token, httpClient: _http);
  }

  void _signIn({String? token, String? login}) {
    _token = token;
    _login = login;
    _error = null;
    _state = SignInState.signedIn;
    notifyListeners();
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
