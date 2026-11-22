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

/// A [RestItemReader] whose GitHub answers each request with [respond], and
/// records the requests in [requests].
RestItemReader restReader(
  List<http.Request> requests,
  Object? Function(http.Request request) respond,
) => RestItemReader(
  GitHubClient(
    token: 'token',
    httpClient: MockClient((request) async {
      requests.add(request);
      final Object? body = respond(request);
      return http.Response(body == null ? '' : jsonEncode(body), 200);
    }),
  ),
  'a2ui-project/a2ui',
);

void main() {
  group('itemFromJson', () {
    test('reads an issue as the REST API returns it', () {
      final Item item = itemFromJson({
        'number': 7,
        'title': 'Crash',
        'state': 'open',
        'html_url': 'https://github.com/a2ui-project/a2ui/issues/7',
        'created_at': '2026-06-01T10:00:00Z',
        'author_association': 'NONE',
        'user': {'login': 'reporter', 'type': 'User'},
        'labels': [
          {'name': 'P1'},
          'type: bug',
        ],
        'assignees': [
          {'login': 'dev'},
        ],
        'milestone': {'number': 3},
        'comments': 2,
      });
      expect(item.number, 7);
      expect(item.title, 'Crash');
      expect(item.createdAt, DateTime.utc(2026, 6, 1, 10));
      expect(item.user?.login, 'reporter');
      expect(item.labels, ['P1', 'type: bug']);
      expect(item.assignees, ['dev']);
      expect(item.hasMilestone, isTrue);
      expect(item.isPullRequest, isFalse);
      expect(item.commentCount, 2);
    });

    test('reads a draft PR from a deleted account', () {
      final Item item = itemFromJson({
        'number': 8,
        'created_at': '2026-06-01T10:00:00Z',
        'author_association': 'NONE',
        'user': null,
        'assignees': null,
        'milestone': null,
        'pull_request': {'url': 'x'},
        'draft': true,
      });
      expect(item.user, isNull);
      expect(item.assigneeCount, 0);
      expect(item.hasMilestone, isFalse);
      expect(item.isPullRequest, isTrue);
      expect(item.isDraft, isTrue);
    });
  });

  test('contributionFromJson reads reviews, and skips pending ones', () {
    final Contribution? review = contributionFromJson({
      'submitted_at': '2026-06-02T10:00:00Z',
      'author_association': 'MEMBER',
      'user': {'login': 'maintainer', 'type': 'User'},
      'body': null,
    });
    expect(review?.createdAt, DateTime.utc(2026, 6, 2, 10));
    expect(review?.body, isNull);
    expect(
      contributionFromJson({'author_association': 'MEMBER', 'user': null}),
      isNull,
    );
  });
  group('RestItemReader', () {
    test('lists the open items, 100 per page', () async {
      final requests = <http.Request>[];
      final RestItemReader github = restReader(requests, (_) => []);
      await github.openItems();
      expect(
        requests.single.url.toString(),
        'https://api.github.com/repos/a2ui-project/a2ui/issues'
        '?state=open&per_page=100',
      );
    });

    test('reads the contributions and the history of an item', () async {
      final requests = <http.Request>[];
      final RestItemReader github = restReader(requests, (_) => []);
      await github.comments(7);
      await github.reviews(7);
      await github.reviewComments(7);
      await github.events(7);
      expect(requests.map((r) => '${r.method} ${r.url.path}'), [
        'GET /repos/a2ui-project/a2ui/issues/7/comments',
        'GET /repos/a2ui-project/a2ui/pulls/7/reviews',
        'GET /repos/a2ui-project/a2ui/pulls/7/comments',
        'GET /repos/a2ui-project/a2ui/issues/7/events',
      ]);
    });
}
