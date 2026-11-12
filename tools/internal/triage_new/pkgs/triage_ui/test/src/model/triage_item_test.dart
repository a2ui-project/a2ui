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

import 'package:flutter_test/flutter_test.dart';
import 'package:triage_ui/src/model/triage_item.dart';

import '../../support/fake_github.dart';

void main() {
  final String suggestion = suggestionComment(
    'root = TriageSuggestion(summary="A crash.", suggestion="Set P1.", '
    'added_labels=["P1"])',
  );

  TriageItem read(Map<String, Object?> node) => TriageItem.fromGraphQL(node);

  test('reads an issue', () {
    final TriageItem item = read(
      itemNode(
        12,
        title: 'Crash',
        labels: [needsTriageLabel, 'type: bug'],
        assignees: ['octocat'],
        linked: [13],
      ),
    );

    expect(item.number, 12);
    expect(item.title, 'Crash');
    expect(item.isPullRequest, isFalse);
    expect(item.isOpen, isTrue);
    expect(item.needsTriage, isTrue);
    expect(item.labels, [needsTriageLabel, 'type: bug']);
    expect(item.assignees, ['octocat']);
    expect(item.linkedItems, [13]);
    expect(item.author, 'author12');
    expect(item.name, 'Issue #12');
    expect(item.suggestionStatus, SuggestionStatus.none);
  });

  test('reads the description and the comments, without the suggestion '
      'comments', () {
    final TriageItem item = read(
      itemNode(
        12,
        body: 'Line 1\r\nLine 2',
        comments: [
          commentNode('First', at: day(2), login: 'reporter'),
          commentNode(suggestion, at: day(3)),
          commentNode('Second\r\nline', at: day(4)),
        ],
      ),
    );

    expect(item.body, 'Line 1\nLine 2');
    expect(
      [for (final c in item.comments) (c.author, c.createdAt, c.body)],
      [('reporter', day(2), 'First'), ('octocat', day(4), 'Second\nline')],
    );
  });

  test('reads a pull request and the issues it closes', () {
    final TriageItem item = read(itemNode(13, pr: true, linked: [12]));

    expect(item.isPullRequest, isTrue);
    expect(item.name, 'PR #13');
    expect(item.linkedItems, [12]);
  });

  test('reads a current suggestion', () {
    final TriageItem item = read(
      itemNode(
        12,
        comments: [
          commentNode('I see this too.', at: day(2), association: 'NONE'),
          commentNode(suggestion, at: day(3)),
        ],
        timeline: [labeledEvent('type: bug', day(2))],
      ),
    );

    expect(item.suggestionStatus, SuggestionStatus.current);
    expect(item.suggestion!.suggestion.addedLabels, ['P1']);
    expect(item.suggestionUrl, isNotNull);
  });

  group('the suggestion is outdated after', () {
    final cases = <String, Map<String, Object?>>{
      'a comment': itemNode(
        12,
        comments: [
          commentNode(suggestion, at: day(3)),
          commentNode('More details.', at: day(4), association: 'NONE'),
        ],
      ),
      'a label change': itemNode(
        12,
        comments: [commentNode(suggestion, at: day(3))],
        timeline: [labeledEvent('P2', day(4))],
      ),
      'a description edit': itemNode(
        12,
        lastEditedAt: day(4),
        comments: [commentNode(suggestion, at: day(3))],
      ),
      'a PR review': itemNode(
        12,
        pr: true,
        comments: [commentNode(suggestion, at: day(3))],
        reviews: [
          {'submittedAt': day(4).toIso8601String()},
        ],
      ),
      'a commit': itemNode(
        12,
        pr: true,
        comments: [commentNode(suggestion, at: day(3))],
        timeline: [
          {
            '__typename': 'PullRequestCommit',
            'commit': {'committedDate': day(4).toIso8601String()},
          },
        ],
      ),
    };
    cases.forEach((String what, Map<String, Object?> node) {
      test(what, () {
        expect(read(node).suggestionStatus, SuggestionStatus.outdated);
      });
    });
  });

  test('the suggestion stays current after changes of needs-triage, other '
      'triage bot comments, and its own edit', () {
    final TriageItem item = read(
      itemNode(
        12,
        comments: [
          commentNode(suggestion, at: day(3), editedAt: day(6)),
          commentNode('**From triage bot:**\n\nPing.', at: day(5)),
        ],
        timeline: [
          labeledEvent(needsTriageLabel, day(5)),
          labeledEvent('P1', day(5)),
        ],
      ),
    );

    expect(item.suggestionStatus, SuggestionStatus.current);
  });

  test('ignores a suggestion posted by someone outside the team', () {
    final TriageItem item = read(
      itemNode(
        12,
        comments: [commentNode(suggestion, at: day(3), association: 'NONE')],
      ),
    );

    expect(item.suggestionStatus, SuggestionStatus.none);
  });

  test('accepts a suggestion posted by a bot', () {
    final TriageItem item = read(
      itemNode(
        12,
        comments: [
          commentNode(suggestion, at: day(3), association: 'NONE', type: 'Bot'),
        ],
      ),
    );

    expect(item.suggestionStatus, SuggestionStatus.current);
  });

  test('reports an invalid suggestion', () {
    final TriageItem item = read(
      itemNode(
        12,
        comments: [
          commentNode(
            suggestionComment('root = TriageSuggestion(summary="A")'),
            at: day(3),
          ),
        ],
      ),
    );

    expect(item.suggestionStatus, SuggestionStatus.invalid);
    expect(item.suggestion, isNull);
    expect(item.suggestionError, isNotEmpty);
  });

  test('reads the latest comment for team discussion from a team member', () {
    final TriageItem item = read(
      itemNode(
        12,
        comments: [
          commentNode('${teamNoteHeading}Is this a P0?', at: day(2)),
          commentNode(
            '${teamNoteHeading}Or a P1?\r\n',
            at: day(3),
            login: 'hubot',
          ),
          commentNode(
            '${teamNoteHeading}Not from the team.',
            at: day(4),
            association: 'NONE',
          ),
          commentNode(suggestion, at: day(5)),
        ],
      ),
    );

    expect(item.teamNote?.text, 'Or a P1?');
    expect(item.teamNote?.author, 'hubot');
    expect(item.suggestionStatus, SuggestionStatus.current);
  });

  test('has no comment for team discussion without the heading', () {
    final TriageItem item = read(
      itemNode(12, comments: [commentNode('Is this a P0?', at: day(2))]),
    );

    expect(item.teamNote, isNull);
  });
}
