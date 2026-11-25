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
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:server/server.dart';
import 'package:shelf/shelf.dart';
import 'package:test/test.dart';

final Uri _githubWeb = Uri.parse('https://github.test/');
final Uri _githubApi = Uri.parse('https://api.github.test/');
final Uri _server = Uri.parse('https://triage.test/');

/// GitHub's OAuth and API endpoints, as the tests need them.
final class FakeGitHub {
  /// The tokens GitHub accepts, with their owners.
  final Map<String, String> tokens = {'gho_oauth': 'ann', 'ghp_pasted': 'bob'};

  /// The PKCE challenge of the last authorize URL the test opened.
  String? challenge;

  /// The API requests other than `GET /user`.
  final List<http.Request> apiRequests = [];

  /// The requests that revoked a token.
  final List<http.Request> revocations = [];

  /// Whether GitHub cannot be reached.
  bool down = false;

  late final MockClient client = MockClient((request) async {
    if (down) throw http.ClientException('Connection refused');
    final Uri url = request.url;
    if (url == _githubApi.resolve('applications/client-id/token')) {
      revocations.add(request);
      return http.Response('', 204);
    }
    if (url == _githubWeb.resolve('login/oauth/access_token')) {
      final Map<String, String> form = request.bodyFields;
      final String verifier = form['code_verifier']!;
      final String expected = base64Url
          .encode(sha256.convert(ascii.encode(verifier)).bytes)
          .replaceAll('=', '');
      if (form['code'] != 'good-code' ||
          form['client_secret'] != 'secret' ||
          expected != challenge) {
        return http.Response(
          jsonEncode({'error': 'bad_verification_code'}),
          200,
        );
      }
      return http.Response(jsonEncode({'access_token': 'gho_oauth'}), 200);
    }

    final String? token = request.headers['authorization']?.replaceFirst(
      'Bearer ',
      '',
    );
    final String? login = tokens[token];
    if (login == null) {
      return http.Response(jsonEncode({'message': 'Bad credentials'}), 401);
    }
    if (url == _githubApi.resolve('user')) {
      return http.Response(jsonEncode({'login': login}), 200);
    }
    apiRequests.add(request);
    if (url.path == '/repos/a2ui-project/a2ui/issues/301') {
      return http.Response(
        '',
        301,
        headers: {'location': '${_githubApi}repositories/1/issues/301'},
      );
    }
    return http.Response(
      jsonEncode({'method': request.method, 'body': request.body}),
      200,
      headers: {
        'content-type': 'application/json',
        'link': '<${_githubApi}repos/o/r/issues?page=2>; rel="next"',
        'x-ratelimit-remaining': '4999',
        'set-cookie': 'not=passed',
      },
    );
  });
}

void main() {
  late FakeGitHub github;
  late Directory web;
  late Handler handler;

  setUp(() {
    github = FakeGitHub();
    web = Directory.systemTemp.createTempSync('triage_web_');
    File('${web.path}/index.html').writeAsStringSync('<p>app</p>');
    handler = createHandler(
      ServerConfig(
        port: 8080,
        publicUrl: _server,
        webDir: web.path,
        sessionKey: List.filled(32, 7),
        oauthClientId: 'client-id',
        oauthClientSecret: 'secret',
        githubWeb: _githubWeb,
        githubApi: _githubApi,
      ),
      httpClient: github.client,
    );
  });

  tearDown(() => web.deleteSync(recursive: true));

  Future<Response> send(
    String method,
    String path, {
    String? cookie,
    bool header = true,
    Object? body,
  }) async => handler(
    Request(
      method,
      _server.resolve(path),
      headers: {if (header) 'x-requested-with': 'triage-ui', 'cookie': ?cookie},
      body: body == null ? null : jsonEncode(body),
    ),
  );

  Future<Map<String, Object?>> json(Response response) async =>
      jsonDecode(await response.readAsString()) as Map<String, Object?>;

  /// Signs in with a pasted token, and returns the session cookie.
  Future<String> signInWithToken() async {
    final Response response = await send(
      'POST',
      '/auth/token',
      body: {'token': 'ghp_pasted'},
    );
    expect(response.statusCode, 200);
    return _cookies(response).single;
  }

  group('status', () {
    test('says that the triager is not signed in', () async {
      final Response response = await send('GET', '/auth/status');
      expect(response.statusCode, 200);
      expect(await json(response), {'oauth': true, 'signedIn': false});
    });

    test('requires the header', () async {
      expect(
        (await send('GET', '/auth/status', header: false)).statusCode,
        403,
      );
    });
  });

  group('sign in with GitHub', () {
    Future<(Uri, String)> startSignIn(String returnPath) async {
      final Response response = await send(
        'GET',
        '/auth/login?return=${Uri.encodeQueryComponent(returnPath)}',
        header: false,
      );
      expect(response.statusCode, 302);
      final Uri authorize = Uri.parse(response.headers['location']!);
      github.challenge = authorize.queryParameters['code_challenge'];
      return (authorize, _cookies(response).single);
    }

    test('sends the triager to GitHub, and back with a session', () async {
      final (Uri authorize, String signInCookie) = await startSignIn(
        '/?item=https://github.com/a2ui-project/a2ui/issues/1',
      );
      expect(
        authorize.replace(query: ''),
        _githubWeb.resolve('login/oauth/authorize?'),
      );
      expect(authorize.queryParameters, {
        'client_id': 'client-id',
        'redirect_uri': 'https://triage.test/auth/callback',
        'scope': 'public_repo',
        'state': isNotEmpty,
        'code_challenge': isNotEmpty,
        'code_challenge_method': 'S256',
        'allow_signup': 'false',
      });

      final Response callback = await send(
        'GET',
        '/auth/callback?code=good-code&state=${authorize.queryParameters['state']}',
        cookie: signInCookie,
        header: false,
      );
      expect(callback.statusCode, 302);
      expect(
        callback.headers['location'],
        '/?item=https://github.com/a2ui-project/a2ui/issues/1',
      );
      final List<String> setCookies = callback.headersAll['set-cookie']!;
      expect(setCookies, hasLength(2));
      expect(setCookies.first, startsWith('__Host-triage_session='));
      expect(setCookies.first, contains('Path=/;'));
      expect(setCookies.first, contains('HttpOnly'));
      expect(setCookies.first, contains('Secure'));
      expect(setCookies.first, contains('SameSite=Lax'));
      expect(setCookies.first, isNot(contains('Domain')));
      expect(setCookies.last, startsWith('__Host-triage_sign_in=;'));
      expect(setCookies.last, contains('Path=/;'));
      expect(setCookies.last, contains('Max-Age=0'));

      final Response status = await send(
        'GET',
        '/auth/status',
        cookie: _cookies(callback).first,
      );
      expect(await json(status), {
        'oauth': true,
        'signedIn': true,
        'login': 'ann',
      });
    });

    test('shows an error page when GitHub cannot be reached', () async {
      final (Uri authorize, String signInCookie) = await startSignIn('/');
      github.down = true;
      final Response callback = await send(
        'GET',
        '/auth/callback?code=good-code&state=${authorize.queryParameters['state']}',
        cookie: signInCookie,
        header: false,
      );
      expect(callback.statusCode, 400);
      expect(await callback.readAsString(), contains('Cannot reach GitHub'));
    });

    test('revokes the token on sign out', () async {
      final (Uri authorize, String signInCookie) = await startSignIn('/');
      final Response callback = await send(
        'GET',
        '/auth/callback?code=good-code&state=${authorize.queryParameters['state']}',
        cookie: signInCookie,
        header: false,
      );
      final Response logout = await send(
        'POST',
        '/auth/logout',
        cookie: _cookies(callback).first,
      );
      expect(logout.statusCode, 204);
      final http.Request revocation = github.revocations.single;
      expect(revocation.method, 'DELETE');
      expect(
        revocation.headers['authorization'],
        'Basic ${base64.encode(utf8.encode('client-id:secret'))}',
      );
      expect(jsonDecode(revocation.body), {'access_token': 'gho_oauth'});
    });

    test('rejects a callback with another state', () async {
      final (_, String signInCookie) = await startSignIn('/');
      final Response callback = await send(
        'GET',
        '/auth/callback?code=good-code&state=other',
        cookie: signInCookie,
        header: false,
      );
      expect(callback.statusCode, 400);
      expect(await callback.readAsString(), contains('did not start'));
    });

    test('rejects a callback without the sign-in cookie', () async {
      final (Uri authorize, _) = await startSignIn('/');
      final Response callback = await send(
        'GET',
        '/auth/callback?code=good-code&state=${authorize.queryParameters['state']}',
        header: false,
      );
      expect(callback.statusCode, 400);
    });

    test('shows the reason when the triager declines', () async {
      final (Uri authorize, String signInCookie) = await startSignIn('/');
      final Response callback = await send(
        'GET',
        '/auth/callback?error=access_denied&error_description=Denied%3Cb%3E'
            '&state=${authorize.queryParameters['state']}',
        cookie: signInCookie,
        header: false,
      );
      expect(callback.statusCode, 400);
      expect(await callback.readAsString(), contains('Denied&lt;b&gt;'));
    });

    test('does not show the error text of another state', () async {
      final (_, String signInCookie) = await startSignIn('/');
      final Response callback = await send(
        'GET',
        '/auth/callback?error=x&error_description=Call+us&state=other',
        cookie: signInCookie,
        header: false,
      );
      expect(callback.statusCode, 400);
      final String page = await callback.readAsString();
      expect(page, contains('did not start'));
      expect(page, isNot(contains('Call us')));
    });

    test('does not show the error text without the sign-in cookie', () async {
      final Response callback = await send(
        'GET',
        '/auth/callback?error=x&error_description=Call+us&state=s',
        header: false,
      );
      expect(callback.statusCode, 400);
      expect(await callback.readAsString(), isNot(contains('Call us')));
    });

    test('rejects a callback without a code', () async {
      final (Uri authorize, String signInCookie) = await startSignIn('/');
      final Response callback = await send(
        'GET',
        '/auth/callback?state=${authorize.queryParameters['state']}',
        cookie: signInCookie,
        header: false,
      );
      expect(callback.statusCode, 400);
      expect(await callback.readAsString(), contains('no code'));
    });

    test('shows the reason when GitHub rejects the code', () async {
      final (Uri authorize, String signInCookie) = await startSignIn('/');
      final Response callback = await send(
        'GET',
        '/auth/callback?code=bad-code&state=${authorize.queryParameters['state']}',
        cookie: signInCookie,
        header: false,
      );
      expect(callback.statusCode, 400);
      expect(await callback.readAsString(), contains('bad_verification_code'));
    });
  });

  test('return paths stay on the server', () {
    expect(safeReturnPath('/?item=x'), '/?item=x');
    expect(safeReturnPath('//evil.test/'), '/');
    expect(safeReturnPath(r'/\evil.test/'), '/');
    expect(safeReturnPath('https://evil.test/'), '/');
    expect(safeReturnPath('/\t/evil.test/'), '/');
    expect(safeReturnPath('/\n/evil.test/'), '/');
    expect(safeReturnPath('/\r/evil.test/'), '/');
    expect(safeReturnPath(null), '/');
  });

  group('use a token', () {
    test('signs in with a token that GitHub accepts', () async {
      final String cookie = await signInWithToken();
      final Response status = await send('GET', '/auth/status', cookie: cookie);
      expect((await json(status))['login'], 'bob');
    });

    test('rejects a token that GitHub does not accept', () async {
      final Response response = await send(
        'POST',
        '/auth/token',
        body: {'token': 'wrong'},
      );
      expect(response.statusCode, 401);
      expect(response.headers['set-cookie'], isNull);
    });

    test('says when GitHub cannot be reached', () async {
      github.down = true;
      final Response response = await send(
        'POST',
        '/auth/token',
        body: {'token': 'ghp_pasted'},
      );
      expect(response.statusCode, 502);
      expect((await json(response))['message'], contains('Cannot reach'));
    });

    test('reads a session cookie in double quotes', () async {
      final String cookie = await signInWithToken();
      final int equals = cookie.indexOf('=');
      final Response status = await send(
        'GET',
        '/auth/status',
        cookie:
            '${cookie.substring(0, equals)}="${cookie.substring(equals + 1)}"',
      );
      expect((await json(status))['login'], 'bob');
    });

    test('reads the session cookie behind one of the same name', () async {
      final String cookie = await signInWithToken();
      final String name = cookie.substring(0, cookie.indexOf('='));
      final Response status = await send(
        'GET',
        '/auth/status',
        cookie: '$name=from-another-service; $cookie',
      );
      expect((await json(status))['login'], 'bob');
    });

    test('requires the header', () async {
      final Response response = await send(
        'POST',
        '/auth/token',
        header: false,
        body: {'token': 'ghp_pasted'},
      );
      expect(response.statusCode, 403);
    });
  });

  test('names the cookies without __Host- over HTTP', () async {
    final Handler local = createHandler(
      ServerConfig(
        port: 8080,
        publicUrl: Uri.parse('http://localhost:8080'),
        webDir: web.path,
        sessionKey: List.filled(32, 7),
        githubApi: _githubApi,
      ),
      httpClient: github.client,
    );
    final Response response = await local(
      Request(
        'POST',
        Uri.parse('http://localhost:8080/auth/token'),
        headers: {'x-requested-with': 'triage-ui'},
        body: jsonEncode({'token': 'ghp_pasted'}),
      ),
    );
    final String setCookie = response.headers['set-cookie']!;
    expect(setCookie, startsWith('triage_session='));
    expect(setCookie, isNot(contains('Secure')));
  });

  test('sign out deletes the session, and keeps a pasted token', () async {
    final Response response = await send(
      'POST',
      '/auth/logout',
      cookie: await signInWithToken(),
    );
    expect(response.statusCode, 204);
    expect(response.headers['set-cookie'], contains('Max-Age=0'));
    expect(github.revocations, isEmpty);
  });

  group('GitHub proxy', () {
    test('adds the token and passes the answer back', () async {
      final Response response = await send(
        'POST',
        '/github/repos/a2ui-project/a2ui/issues/1/comments?x=1',
        cookie: await signInWithToken(),
        body: {'body': 'Hi'},
      );

      expect(response.statusCode, 200);
      final http.Request upstream = github.apiRequests.single;
      expect(
        upstream.url.toString(),
        'https://api.github.test/repos/a2ui-project/a2ui/issues/1/comments?x=1',
      );
      expect(upstream.method, 'POST');
      expect(upstream.headers['authorization'], 'Bearer ghp_pasted');
      expect(upstream.headers, isNot(contains('cookie')));
      expect(await json(response), {'method': 'POST', 'body': '{"body":"Hi"}'});
      expect(
        response.headers['link'],
        '</github/repos/o/r/issues?page=2>; rel="next"',
      );
      expect(response.headers['x-ratelimit-remaining'], '4999');
      expect(response.headers['set-cookie'], isNull);
    });

    for (final path in [
      '/github/http://evil.test/steal',
      '/github///evil.test/steal',
      '/github/foo:bar',
      '/github/https:foo',
    ]) {
      test('sends the token only to GitHub: $path', () async {
        final Response response = await send(
          'POST',
          path,
          cookie: await signInWithToken(),
          body: {'body': 'Hi'},
        );
        expect(response.statusCode, 400);
        expect(github.apiRequests, isEmpty);
      });
    }

    for (final (String method, String path) in [
      ('POST', 'repos/a2ui-project/a2ui/issues/1/labels'),
      ('DELETE', 'repos/a2ui-project/a2ui/issues/1/labels/P1'),
      ('POST', 'repos/flutter/genui/issues/2/assignees'),
      ('DELETE', 'repos/flutter/genui/issues/2/assignees'),
      ('PATCH', 'repos/flutter/genui/issues/2'),
    ]) {
      test('passes on the call $method /$path', () async {
        final Response response = await send(
          method,
          '/github/$path',
          cookie: await signInWithToken(),
          body: {},
        );
        expect(response.statusCode, 200);
        expect(github.apiRequests.single.url.path, '/$path');
      });
    }

    for (final (String method, String path) in [
      ('GET', 'user'),
      ('DELETE', 'repos/a2ui-project/a2ui'),
      ('POST', 'repos/other/repo/issues/1/comments'),
      ('PATCH', 'repos/a2ui-project/a2ui/issues/1/comments'),
      ('GET', 'repos/a2ui-project/a2ui/issues/1'),
      ('PATCH', 'repos/a2ui-project/a2ui/issues/1/../../../../user'),
      ('POST', 'repos/a2ui-project%2Fa2ui/issues/1/comments'),
    ]) {
      test('rejects a call the app does not make: $method /$path', () async {
        final Response response = await send(
          method,
          '/github/$path',
          cookie: await signInWithToken(),
          body: {},
        );
        expect(response.statusCode, 403);
        expect(github.apiRequests, isEmpty);
      });
    }

    for (final query in [
      'query { viewer { login } }',
      '{ viewer { login } }',
      r'mutation($id: ID!) { closePullRequest(input: {pullRequestId: $id}) '
          '{ pullRequest { state } } }',
      'mutation { done: closeIssue(input: {issueId: "1"}) '
          '{ issue { ...F } } } fragment F on Issue { state }',
      'mutation @a { closeIssue(input: {}) @b(if: true) { issue { state } } }',
    ]) {
      test('passes on the GraphQL call: $query', () async {
        final Response response = await send(
          'POST',
          '/github/graphql',
          cookie: await signInWithToken(),
          body: {'query': query, 'variables': <String, Object?>{}},
        );
        expect(response.statusCode, 200);
        expect(github.apiRequests, hasLength(1));
      });
    }

    for (final query in [
      'mutation { deleteIssue(input: {issueId: "1"}) { clientMutationId } }',
      'mutation { closeIssue(input: {}) { issue { state } } '
          'addComment(input: {}) { clientMutationId } }',
      'mutation { closeIssue: addComment(input: {}) { clientMutationId } }',
      'mutation { ...F } fragment F on Mutation { addComment(input: {}) '
          '{ clientMutationId } }',
      'mutation { ... on Mutation { addComment(input: {}) '
          '{ clientMutationId } } }',
      'query Q { viewer { login } } mutation M { addComment(input: {}) '
          '{ clientMutationId } }',
      'subscription { issue { id } }',
      'mutation { closeIssue(input: {body: "}"}) { issue { state } } '
          'addComment(input: {}) { clientMutationId } }',
      'mutation { closeIssue(input: {}) { issue { state } } # }\n'
          'addComment(input: {}) { clientMutationId } }',
      'mutation { ~ }',
    ]) {
      test('rejects a GraphQL call the app does not make: $query', () async {
        final Response response = await send(
          'POST',
          '/github/graphql',
          cookie: await signInWithToken(),
          body: {'query': query},
        );
        expect(response.statusCode, 403);
        expect(github.apiRequests, isEmpty);
      });
    }

    for (final Object body in [
      'not json',
      ['query'],
      {'variables': <String, Object?>{}},
    ]) {
      test('rejects a GraphQL request without a query: $body', () async {
        final Response response = await handler(
          Request(
            'POST',
            _server.resolve('/github/graphql'),
            headers: {
              'x-requested-with': 'triage-ui',
              'cookie': await signInWithToken(),
            },
            body: body is String ? body : jsonEncode(body),
          ),
        );
        expect(response.statusCode, 400);
        expect(github.apiRequests, isEmpty);
      });
    }

    test('passes redirects on through the proxy', () async {
      final Response response = await send(
        'PATCH',
        '/github/repos/a2ui-project/a2ui/issues/301',
        cookie: await signInWithToken(),
        body: {},
      );
      expect(response.statusCode, 301);
      expect(response.headers['location'], '/github/repositories/1/issues/301');
    });

    test('rejects requests without a session', () async {
      final Response response = await send(
        'POST',
        '/github/graphql',
        body: {'query': '{ viewer { login } }'},
      );
      expect(response.statusCode, 401);
      expect(github.apiRequests, isEmpty);
    });

    test('requires the header', () async {
      final Response response = await send(
        'POST',
        '/github/graphql',
        cookie: await signInWithToken(),
        header: false,
        body: {'query': '{ viewer { login } }'},
      );
      expect(response.statusCode, 403);
      expect(github.apiRequests, isEmpty);
    });

    test('signs the triager out when GitHub rejects the token', () async {
      final String cookie = await signInWithToken();
      github.tokens.remove('ghp_pasted');
      final Response response = await send(
        'POST',
        '/github/graphql',
        cookie: cookie,
        body: {'query': '{ viewer { login } }'},
      );
      expect(response.statusCode, 401);
      expect(response.headers['set-cookie'], contains('Max-Age=0'));
    });

    test('rejects a changed session cookie', () async {
      final String cookie = await signInWithToken();
      final Response response = await send(
        'POST',
        '/github/graphql',
        cookie: '${cookie.substring(0, cookie.length - 2)}xx',
        body: {'query': '{ viewer { login } }'},
      );
      expect(response.statusCode, 401);
    });
  });

  group('web app', () {
    test('serves the files without caching them unchecked', () async {
      final Response response = await send('GET', '/', header: false);
      expect(response.statusCode, 200);
      expect(await response.readAsString(), '<p>app</p>');
      expect(response.headers['cache-control'], 'no-cache');
    });

    test('rejects other methods', () async {
      expect((await send('POST', '/', header: false)).statusCode, 405);
    });

    test('answers the health check', () async {
      expect((await send('GET', '/healthz', header: false)).statusCode, 200);
    });
  });

  group('config', () {
    test('reads the environment', () {
      final (
        config: ServerConfig config,
        warnings: List<String> warnings,
      ) = ServerConfig.fromEnvironment({
        'PORT': '9000',
        'PUBLIC_URL': 'https://triage.test',
        'SESSION_SECRET': 's',
        'GITHUB_OAUTH_CLIENT_ID': 'id',
        'GITHUB_OAUTH_CLIENT_SECRET': 'secret',
        'K_SERVICE': 'a2ui-triage',
      });
      expect(config.port, 9000);
      expect(
        config.callbackUrl.toString(),
        'https://triage.test/auth/callback',
      );
      expect(config.oauthEnabled, isTrue);
      expect(config.secureCookies, isTrue);
      expect(config.listenOnAllInterfaces, isTrue);
      expect(warnings, isEmpty);
    });

    test('runs locally without settings, with warnings', () {
      final (config: ServerConfig config, warnings: List<String> warnings) =
          ServerConfig.fromEnvironment({});
      expect(config.publicUrl.toString(), 'http://localhost:8080');
      expect(config.oauthEnabled, isFalse);
      expect(config.secureCookies, isFalse);
      expect(config.listenOnAllInterfaces, isFalse);
      expect(warnings, hasLength(2));
    });

    test('requires SESSION_SECRET on Cloud Run', () {
      expect(
        () => ServerConfig.fromEnvironment({'K_SERVICE': 'a2ui-triage'}),
        throwsA(
          isA<ConfigException>().having(
            (e) => e.message,
            'message',
            contains('SESSION_SECRET'),
          ),
        ),
      );
    });

    test('requires both OAuth settings', () {
      expect(
        () => ServerConfig.fromEnvironment({'GITHUB_OAUTH_CLIENT_ID': 'id'}),
        throwsA(isA<ConfigException>()),
      );
    });
  });
}

/// The `name=value` parts of the `Set-Cookie` headers of [response].
List<String> _cookies(Response response) => [
  for (final String header in response.headersAll['set-cookie'] ?? const [])
    header.split(';').first,
];
