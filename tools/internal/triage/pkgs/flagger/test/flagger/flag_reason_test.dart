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

import 'package:flagger/flagger.dart';
import 'package:shared/shared.dart';
import 'package:test/test.dart';

import '../support/fakes.dart';

/// Returns the reason for the item with number 1 in [github].
Future<ItemReason> reasonOf(FakeGitHub github) =>
    itemReason(github, 1, now, log: StringBuffer(), errorLog: StringBuffer());

void main() {
  group('parseItem', () {
    test('reads a number as an item in a2ui-project/a2ui', () {
      expect(parseItem('123'), (repository: a2uiRepository, number: 123));
      expect(parseItem('#123'), (repository: a2uiRepository, number: 123));
    });

    test('reads issue and PR URLs', () {
      expect(parseItem('https://github.com/a2ui-project/a2ui/issues/12'), (
        repository: 'a2ui-project/a2ui',
        number: 12,
      ));
      expect(parseItem('https://github.com/octo/genui/pull/34/'), (
        repository: 'octo/genui',
        number: 34,
      ));
    });

    test('rejects anything else', () {
      for (final arg in [
        '',
        'abc',
        '12a',
        'https://github.com/a2ui-project/a2ui/commit/12',
      ]) {
        expect(
          () => parseItem(arg),
          throwsA(
            isA<FormatException>().having(
              (e) => e.message,
              'message',
              contains('Not an issue or PR'),
            ),
          ),
          reason: arg,
        );
      }
    });
  });

  test('toSentence capitalizes the reason', () {
    expect(toSentence('this PR has no assignee.'), 'This PR has no assignee.');
  });

  group('itemReason', () {
    test('returns the reason for a flagged item, as a sentence', () async {
      expect(
        await reasonOf(FakeGitHub([externalIssue(createdAt: daysAgo(1))])),
        (
          url: 'https://github.com/a2ui-project/a2ui/issues/1',
          reason: 'This issue has no priority label.',
        ),
      );
    });

    test('returns null for an item that should not be flagged', () async {
      final ItemReason result = await reasonOf(
        FakeGitHub([
          issue(labels: ['P2'], createdAt: daysAgo(1)),
        ]),
      );
      expect(result.reason, isNull);
    });

    test('reads the comments', () async {
      final ItemReason result = await reasonOf(
        FakeGitHub(
          [
            issue(labels: ['P2'], createdAt: daysAgo(1), comments: 1),
          ],
          itemComments: {
            1: [externalComment(0)],
          },
        ),
      );
      expect(
        result.reason,
        startsWith('The latest comment is from an out-of-team contributor'),
      );
    });

    test('reads when the timed labels were added', () async {
      final ItemReason result = await reasonOf(
        FakeGitHub(
          [
            externalIssue(labels: [assignedForTriageLabel], assignees: 1),
          ],
          itemEvents: {
            1: [labeling(assignedForTriageLabel, 15)],
          },
        ),
      );
      expect(result.reason, contains('was added more than 14 days ago'));
    });

    test(
      'judges the item as if the answered waiting label were gone',
      () async {
        final ItemReason result = await reasonOf(
          FakeGitHub(
            [
              externalIssue(
                labels: [waitingForAuthorResponseLabel],
                createdAt: daysAgo(1),
                comments: 1,
              ),
            ],
            itemComments: {
              1: [externalComment(0)],
            },
            itemEvents: {
              1: [labeling(waitingForAuthorResponseLabel, 1)],
            },
          ),
        );
        expect(result.reason, 'This issue has no priority label.');
      },
    );

    test('builds the URL when the API does not return one', () async {
      final ItemReason result = await reasonOf(
        FakeGitHub([
          Item(
            number: 1,
            createdAt: daysAgo(1),
            authorAssociation: 'NONE',
            user: reporter,
          ),
        ]),
      );
      expect(result.url, 'https://github.com/a2ui-project/a2ui/issues/1');
    });
  });
}
