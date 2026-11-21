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
}
