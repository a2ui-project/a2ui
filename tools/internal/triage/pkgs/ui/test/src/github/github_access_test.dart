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

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared/shared.dart';
import 'package:ui/src/github/browser.dart';
import 'package:ui/src/github/github_access.dart';

final Uri _page = Uri.parse(
  'https://triage.test/?item=https://github.com/a2ui-project/a2ui/issues/1',
);

void main() {
  late List<http.Request> requests;
  late MemoryBrowser browser;

  /// A client that answers like the server, or like `flutter run` when
  /// [server] is null.
  http.Client fakeClient({Map<String, Object?>? server}) => MockClient((
    request,
  ) async {
    requests.add(request);
    final String path = request.url.path;
    if (request.url.host == 'api.github.com') {
      return request.headers['Authorization'] == 'Bearer good'
          ? http.Response(jsonEncode({'login': 'ann'}), 200)
          : http.Response(jsonEncode({'message': 'Bad credentials'}), 401);
    }
    if (server == null) return http.Response('<html></html>', 200);
    return switch (path) {
      '/auth/status' => http.Response(jsonEncode(server), 200),
      '/auth/token'
          when (jsonDecode(request.body) as Map<String, Object?>)['token'] ==
              'good' =>
        http.Response(jsonEncode({'login': 'ann'}), 200),
      '/auth/token' => http.Response(
        jsonEncode({'message': 'GitHub did not accept this token.'}),
        401,
      ),
      '/auth/logout' => http.Response('', 204),
      _ => http.Response(jsonEncode({'path': path}), 200),
    };
  });

  setUp(() {
    requests = [];
    browser = MemoryBrowser();
  });

  test('uses the preset token', () async {
    final access = GitHubAccess(
      page: _page,
      browser: browser,
      httpClient: fakeClient(),
      presetToken: 'good',
    );
    await access.check();
    expect(access.state, SignInState.signedIn);
    expect(requests, isEmpty);
  });

  group('with the server', () {
    test('calls GitHub through the server when signed in', () async {
      final access = GitHubAccess(
        page: _page,
        browser: browser,
        httpClient: fakeClient(
          server: {'oauth': true, 'signedIn': true, 'login': 'ann'},
        ),
      );
      await access.check();
      expect(access.state, SignInState.signedIn);
      expect(access.login, 'ann');

      await access.client().rest('GET', 'repos/o/r');
      final http.Request call = requests.last;
      expect(call.url.toString(), 'https://triage.test/github/repos/o/r');
      expect(call.headers['X-Requested-With'], 'triage-ui');
      expect(call.headers, isNot(contains('Authorization')));
    });

    test('signs in with GitHub, coming back to the same page', () async {
      final access = GitHubAccess(
        page: _page,
        browser: browser,
        httpClient: fakeClient(server: {'oauth': true, 'signedIn': false}),
      );
      await access.check();
      expect(access.state, SignInState.signedOut);
      expect(access.canSignInWithGitHub, isTrue);

      access.signInWithGitHub();
      final Uri login = browser.opened.single;
      expect(login.path, '/auth/login');
      expect(
        login.queryParameters['return'],
        '/?item=https://github.com/a2ui-project/a2ui/issues/1',
      );
    });

    test('gives a pasted token to the server', () async {
      final access = GitHubAccess(
        page: _page,
        browser: browser,
        httpClient: fakeClient(server: {'oauth': false, 'signedIn': false}),
      );
      await access.check();
      expect(access.canSignInWithGitHub, isFalse);

      await access.useToken('wrong');
      expect(access.state, SignInState.signedOut);
      expect(access.error, 'GitHub did not accept this token.');

      await access.useToken(' good ');
      expect(access.state, SignInState.signedIn);
      expect(access.login, 'ann');
      expect(browser.token, isNull);
    });

    test('signs out on the server, and reloads', () async {
      final access = GitHubAccess(
        page: _page,
        browser: browser,
        httpClient: fakeClient(
          server: {'oauth': true, 'signedIn': true, 'login': 'ann'},
        ),
      );
      await access.check();
      await access.signOut();
      expect(requests.last.url.path, '/auth/logout');
      expect(browser.reloads, 1);
    });
  });

  test('built for the server, does not fall back when it fails', () async {
    final access = GitHubAccess(
      page: _page,
      browser: browser..token = 'good',
      httpClient: MockClient((_) async => http.Response('Unavailable', 503)),
      expectServer: true,
    );
    await access.check();
    expect(access.state, SignInState.serverUnavailable);
    expect(access.hasServer, isFalse);
    expect(access.error, contains('Cannot reach'));
  });

  group('without the server', () {
    test('checks a pasted token with GitHub, and keeps it', () async {
      final access = GitHubAccess(
        page: _page,
        browser: browser,
        httpClient: fakeClient(),
      );
      await access.check();
      expect(access.state, SignInState.signedOut);
      expect(access.hasServer, isFalse);
      expect(access.canSignInWithGitHub, isFalse);

      await access.useToken('wrong');
      expect(access.error, contains('Bad credentials'));
      expect(browser.token, isNull);

      await access.useToken('good');
      expect(access.state, SignInState.signedIn);
      expect(browser.token, 'good');
      await access.client().rest('GET', 'user');
      expect(requests.last.url.toString(), 'https://api.github.com/user');
    });

    test('uses the token kept earlier', () async {
      browser.token = 'good';
      final access = GitHubAccess(
        page: _page,
        browser: browser,
        httpClient: fakeClient(),
      );
      await access.check();
      expect(access.state, SignInState.signedIn);
    });

    test('forgets the token on sign out', () async {
      browser.token = 'good';
      final access = GitHubAccess(
        page: _page,
        browser: browser,
        httpClient: fakeClient(),
      );
      await access.check();
      await access.signOut();
      expect(browser.token, isNull);
      expect(browser.reloads, 1);
    });
  });

  group('without a page, as on macOS', () {
    test('uses the preset token', () async {
      final access = GitHubAccess(
        page: null,
        browser: browser,
        httpClient: fakeClient(),
        presetToken: 'good',
      );
      await access.check();
      expect(access.state, SignInState.signedIn);
      expect(requests, isEmpty);
    });

    test('shows the sign-in without asking for a server', () async {
      final access = GitHubAccess(
        page: null,
        browser: browser,
        httpClient: fakeClient(),
      );
      await access.check();
      expect(access.state, SignInState.signedOut);
      expect(access.hasPage, isFalse);
      expect(access.canSignInWithGitHub, isFalse);
      expect(requests, isEmpty);
    });

    test('calls GitHub directly with a pasted token', () async {
      final access = GitHubAccess(
        page: null,
        browser: browser,
        httpClient: fakeClient(),
      );
      await access.check();
      await access.useToken('good');
      expect(access.state, SignInState.signedIn);
      expect(access.login, 'ann');
      await access.client().rest('GET', 'user');
      expect(requests.last.url.toString(), 'https://api.github.com/user');
    });

    test('signs out without reloading', () async {
      final access = GitHubAccess(
        page: null,
        browser: browser,
        httpClient: fakeClient(),
        presetToken: 'good',
      );
      await access.check();
      final GitHubClient client = access.client();

      await access.signOut();
      expect(access.state, SignInState.signedOut);
      expect(browser.reloads, 0);
      expect(access.client, throwsA(isA<GitHubException>()));
      await expectLater(
        client.rest('GET', 'user'),
        throwsA(isA<GitHubException>()),
      );
      expect(requests, isEmpty);
    });
  });

  group('when GitHub stops accepting the sign-in', () {
    test('shows the sign-in, and goes on with the next token', () async {
      browser.token = 'revoked';
      final access = GitHubAccess(
        page: _page,
        browser: browser,
        httpClient: fakeClient(),
      );
      await access.check();
      expect(access.state, SignInState.signedIn);
      final GitHubClient client = access.client();

      await expectLater(
        client.rest('GET', 'user'),
        throwsA(
          isA<GitHubException>().having((e) => e.statusCode, 'status', 401),
        ),
      );
      expect(access.state, SignInState.signedOut);
      expect(access.error, contains('Sign in again'));
      expect(browser.token, isNull);
      expect(browser.reloads, 0);

      await access.useToken('good');
      expect(access.state, SignInState.signedIn);
      expect(await client.rest('GET', 'user'), {'login': 'ann'});
      expect(requests.last.headers['Authorization'], 'Bearer good');
    });

    test('shows the sign-in when the server session ends', () async {
      final access = GitHubAccess(
        page: _page,
        browser: browser,
        httpClient: MockClient((request) async {
          return switch (request.url.path) {
            '/auth/status' => http.Response(
              jsonEncode({'oauth': true, 'signedIn': true, 'login': 'ann'}),
              200,
            ),
            _ => http.Response(jsonEncode({'message': 'Sign in again.'}), 401),
          };
        }),
      );
      await access.check();
      await expectLater(
        access.client().rest('GET', 'user'),
        throwsA(isA<GitHubException>()),
      );
      expect(access.state, SignInState.signedOut);
      expect(access.canSignInWithGitHub, isTrue);
    });
  });
}
