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
import 'package:http/testing.dart';
import 'package:shared/shared.dart';
import 'package:test/test.dart';

void main() {
  test('restPages follows the next links', () async {
    final requested = <Uri>[];
    final client = GitHubClient(
      token: 'token',
      httpClient: MockClient((request) async {
        requested.add(request.url);
        final int page = int.parse(request.url.queryParameters['page'] ?? '1');
        return http.Response(
          jsonEncode([page]),
          200,
          headers: {
            if (page < 3)
              'link':
                  '<https://api.github.com/items?page=${page + 1}>; '
                  'rel="next", <https://api.github.com/items?page=3>; '
                  'rel="last"',
          },
        );
      }),
    );

    expect(await client.restPages('items'), [
      [1],
      [2],
      [3],
    ]);
    expect(requested.map((url) => url.toString()), [
      'https://api.github.com/items',
      'https://api.github.com/items?page=2',
      'https://api.github.com/items?page=3',
    ]);
  });

  test('restPages throws when a page fails', () async {
    final client = GitHubClient(
      token: 'token',
      httpClient: MockClient(
        (_) async => http.Response('{"message": "Not Found"}', 404),
      ),
    );

    expect(
      client.restPages('items'),
      throwsA(
        isA<GitHubException>()
            .having((e) => e.statusCode, 'statusCode', 404)
            .having((e) => e.message, 'message', contains('Not Found')),
      ),
    );
  });

  test('an HTML error page is a GitHubException', () async {
    final client = GitHubClient(
      token: 'token',
      httpClient: MockClient(
        (_) async => http.Response(
          '<html>Bad Gateway</html>',
          502,
          reasonPhrase: 'Bad Gateway',
        ),
      ),
    );

    expect(
      client.rest('GET', 'items'),
      throwsA(
        isA<GitHubException>()
            .having((e) => e.statusCode, 'statusCode', 502)
            .having((e) => e.message, 'message', contains('Bad Gateway')),
      ),
    );
  });

  test('a successful response that is not JSON is a GitHubException', () {
    final client = GitHubClient(
      token: 'token',
      httpClient: MockClient((_) async => http.Response('<html>', 200)),
    );

    expect(
      client.rest('GET', 'items'),
      throwsA(
        isA<GitHubException>().having(
          (e) => e.message,
          'message',
          contains('invalid JSON'),
        ),
      ),
    );
  });

  test('a request that does not finish in time is a GitHubException', () {
    final client = GitHubClient(
      token: 'token',
      timeout: const Duration(milliseconds: 10),
      httpClient: MockClient(
        (_) => Future.delayed(
          const Duration(seconds: 1),
          () => http.Response('{}', 200),
        ),
      ),
    );

    expect(
      client.rest('GET', 'items'),
      throwsA(
        isA<GitHubException>().having(
          (e) => e.message,
          'message',
          contains('did not answer'),
        ),
      ),
    );
  });

  test('GraphQL errors and missing data are GitHubExceptions', () async {
    GitHubClient answering(Object? json) => GitHubClient(
      token: 'token',
      httpClient: MockClient((_) async => http.Response(jsonEncode(json), 200)),
    );

    await expectLater(
      answering({
        'data': null,
        'errors': [
          {'message': 'Field missing'},
        ],
      }).graphql('{ viewer { login } }'),
      throwsA(
        isA<GitHubException>().having(
          (e) => e.message,
          'message',
          'Field missing',
        ),
      ),
    );
    await expectLater(
      answering({'data': null}).graphql('{ viewer { login } }'),
      throwsA(isA<GitHubException>()),
    );
    expect(
      await answering({
        'data': {'viewer': null},
      }).graphql('{ viewer { login } }'),
      {'viewer': null},
    );
  });

  test(
    'calls a proxy without a token, and follows its rewritten links',
    () async {
      final requests = <http.BaseRequest>[];
      final client = GitHubClient(
        token: null,
        baseUrl: Uri.parse('https://triage.example/github/'),
        headers: {'X-Requested-With': 'triage-ui'},
        httpClient: MockClient((request) async {
          requests.add(request);
          final int page = int.parse(
            request.url.queryParameters['page'] ?? '1',
          );
          return http.Response(
            jsonEncode([page]),
            200,
            headers: {
              if (page < 2) 'link': '</github/items?page=2>; rel="next"',
            },
          );
        }),
      );

      expect(await client.restPages('items'), [
        [1],
        [2],
      ]);
      expect(requests.map((r) => r.url.toString()), [
        'https://triage.example/github/items',
        'https://triage.example/github/items?page=2',
      ]);
      for (final r in requests) {
        expect(r.headers, isNot(contains('Authorization')));
        expect(r.headers['X-Requested-With'], 'triage-ui');
      }
    },
  );
}
