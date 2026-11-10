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
import 'package:triage/triage.dart';
import 'package:triage_ui/src/github/github_client.dart';
import 'package:triage_ui/src/github_item.dart';
import 'package:triage_ui/src/model/genui_pull_request.dart';
import 'package:triage_ui/src/model/triage_controller.dart';
import 'package:triage_ui/src/model/triage_item.dart';

import '../../support/fake_github.dart';

void main() {
  late FakeGitHub github;
  late TriageController controller;

  setUp(() {
    github = FakeGitHub([
      itemNode(21, pr: true, createdAt: day(1)),
      itemNode(20, pr: true, createdAt: day(1), linked: [11]),
      // Opened before 10, but updated after it.
      itemNode(11, createdAt: day(1), updatedAt: day(3), linked: [20]),
      itemNode(10, createdAt: day(2)),
      itemNode(30, labels: ['P1'], createdAt: day(1)),
      itemNode(
        40,
        labels: [needsTriageLabel, needsTeamInputLabel],
        createdAt: day(5),
      ),
      itemNode(41, pr: true, labels: [needsTeamInputLabel], createdAt: day(4)),
    ]);
    controller = TriageController(connect: () async => github.service());
  });

  tearDown(() => controller.dispose());

  List<int> numbers(List<TriageItem> items) => [
    for (final i in items) i.number,
  ];

  GitHubItem url(String path) =>
      GitHubItem.tryParse('https://github.com/a2ui-project/a2ui/$path')!;

  test('loads the queue in groups: issues with PRs, issues without PRs, PRs '
      'with issues, then PRs without issues, least recently updated '
      'first', () async {
    await controller.start();

    expect(controller.isConnected, isTrue);
    expect(numbers(controller.newItems), [11, 10, 20, 21]);
    expect(numbers(controller.teamInputItems), [40, 41]);
    expect(numbers(controller.orderedItems), [11, 10, 20, 21, 40, 41]);
    expect(controller.selected, isNull);
    expect(controller.remaining, 6);
    expect(controller.repositoryInfo.labels, contains('P1'));
    expect(numbers(controller.relatedInQueue(controller.item(11)!)), [20]);
  });

  test('loads the PRs on genui, least recently updated first, and loads '
      'them again on refresh', () async {
    github.genuiPullRequests = [
      genuiPullRequestNode(7, updatedAt: day(3), author: 'octocat'),
      genuiPullRequestNode(5, updatedAt: day(2)),
    ];

    await controller.start();

    expect([for (final pr in controller.genuiPullRequests) pr.number], [5, 7]);
    final GenuiPullRequest pr = controller.genuiPullRequests.last;
    expect(pr.title, 'Genui PR 7');
    expect(pr.url, 'https://github.com/flutter/genui/pull/7');
    expect(pr.author, 'octocat');
    // They are not in the queue.
    expect(controller.remaining, 6);
    expect(controller.item(7), isNull);

    // Selecting a PR on genui and an item of the queue replace each other.
    controller.select(10);
    controller.selectGenuiPullRequest(7);
    expect(controller.selected, isNull);
    expect(controller.selectedGenuiPullRequest!.title, 'Genui PR 7');
    controller.select(10);
    expect(controller.selectedGenuiPullRequest, isNull);
    controller.selectGenuiPullRequest(7);

    github.genuiPullRequests = [genuiPullRequestNode(8)];
    await controller.refresh();

    expect([for (final pr in controller.genuiPullRequests) pr.number], [8]);
    // The selected PR no longer needs triage.
    expect(controller.selectedGenuiPullRequest, isNull);
  });

  test('lists the items with a suggestion first', () async {
    github.items[12] = itemNode(
      12,
      createdAt: day(9),
      comments: [
        commentNode(
          suggestionComment(
            'root = TriageSuggestion(summary="S", '
            'suggestion="T")',
          ),
          at: day(9),
        ),
      ],
    );

    await controller.start();

    // 12 is the most recently updated issue without PRs, but the only one
    // with a suggestion.
    expect(numbers(controller.newItems), [11, 12, 10, 20, 21]);
  });

  test('deselects the selected item', () async {
    await controller.start();
    controller.select(11);

    controller.deselect();

    expect(controller.selected, isNull);
  });

  test('groups an item with all its linked items, loading the ones that '
      'are not in the queue', () async {
    // The PR closes the issue, but does not need triage.
    github
      ..items[12] = itemNode(12, createdAt: day(5), linked: [31])
      ..items[31] = itemNode(31, pr: true, labels: [], linked: [12]);
    await controller.start();
    final TriageItem issue = controller.item(12)!;

    expect(numbers(controller.group(issue)), [12]);
    await controller.loadLinked(issue);
    expect(numbers(controller.group(issue)), [12, 31]);
    // Item 11 is linked to PR 20, which is in the queue.
    expect(numbers(controller.group(controller.item(11)!)), [11, 20]);
  });

  test('reports a failure to connect, and can try again', () async {
    var fail = true;
    controller = TriageController(
      connect: () async {
        if (fail) throw const GitHubException('No token.');
        return github.service();
      },
    );

    await controller.start();
    expect(controller.isConnected, isFalse);
    expect(controller.error, 'No token.');

    fail = false;
    await controller.start();
    expect(controller.isConnected, isTrue);
    expect(controller.error, isNull);
  });

  test('opens an item requested before the items loaded', () async {
    await controller.open(url('issues/11'));
    await controller.start();

    expect(controller.selected!.number, 11);
  });

  test('opens an item that is not in the queue', () async {
    await controller.start();
    await controller.open(url('issues/30'));

    expect(controller.selected!.number, 30);
    expect(numbers(controller.opened), [30]);
    expect(controller.remaining, 6);
  });

  test('applies the draft, then selects the next item', () async {
    await controller.start();
    controller.select(10);
    final TriageItem item = controller.selected!;
    controller.draftFor(item, const TriageSuggestion(addedLabels: ['P2']));

    await controller.apply(item);

    expect(controller.lastResult(10)!.succeeded, isTrue);
    expect(controller.session.isApplied(10), isTrue);
    expect(controller.selected!.number, 20);
    expect(controller.remaining, 5);
    // The item shows its new labels, and stays in its place until a refresh.
    expect(controller.item(10)!.labels, contains('P2'));
    expect(numbers(controller.newItems), [11, 10, 20, 21]);
  });

  test('keeps a failed item selected, and posts its reply once', () async {
    github.unassignable.add('stranger');
    await controller.start();
    controller.select(10);
    final TriageItem item = controller.selected!;
    controller.draftFor(
      item,
      const TriageSuggestion(reply: 'Thanks!', newAssignees: ['stranger']),
    );

    await controller.apply(item);
    expect(controller.lastResult(10)!.succeeded, isFalse);
    expect(controller.selected!.number, 10);
    expect(controller.session.isApplied(10), isFalse);

    controller.draftFor(item, const TriageSuggestion()).newAssignees = [];
    await controller.apply(controller.item(10)!);

    expect(controller.lastResult(10)!.succeeded, isTrue);
    expect(github.calls.where((c) => c.contains('comments')), hasLength(1));
  });

  test('refresh drops triaged items and resets the drafts of changed '
      'items', () async {
    await controller.start();
    controller
      ..draftFor(controller.item(10)!, const TriageSuggestion(reply: 'A'))
      ..draftFor(controller.item(11)!, const TriageSuggestion(reply: 'B'));
    github
      ..change(10, (item) => item['title'] = 'Renamed')
      ..change(20, (item) => item['labels'] = {'nodes': <Object?>[]})
      ..items[50] = itemNode(50, createdAt: day(4));

    await controller.refresh();

    // Item 10 was updated last, so it moves after 50.
    expect(numbers(controller.newItems), [11, 50, 10, 21]);
    expect(controller.changedOnGitHub(10), isTrue);
    expect(controller.changedOnGitHub(11), isFalse);
    expect(controller.item(10)!.title, 'Renamed');
    const empty = TriageSuggestion();
    expect(controller.draftFor(controller.item(10)!, empty).reply.text, '');
    expect(controller.draftFor(controller.item(11)!, empty).reply.text, 'B');
  });

  test('refresh does not take the triager own changes for others', () async {
    await controller.start();
    controller.draftFor(
      controller.item(10)!,
      const TriageSuggestion(addedLabels: ['P2']),
    );
    await controller.apply(controller.item(10)!);

    await controller.refresh();

    expect(controller.changedOnGitHub(10), isFalse);
  });

  test('applying to an item that needs team input removes the label, and '
      'keeps the item in its group', () async {
    await controller.start();
    controller.draftFor(
      controller.item(40)!,
      const TriageSuggestion(addedLabels: ['P2']),
    );

    await controller.apply(controller.item(40)!);

    expect(github.calls, [
      'DELETE issues/40/labels/status%3A%20needs-team-input',
      'POST issues/40/labels {"labels":["P2"]}',
    ]);
    expect(controller.item(40)!.needsTeamInput, isFalse);
    expect(numbers(controller.teamInputItems), [40, 41]);
    expect(controller.session.isApplied(40), isTrue);
    expect(controller.report(), contains('removed status: needs-team-input'));
  });

  test('applying a suggestion that adds the label keeps it', () async {
    await controller.start();
    controller.draftFor(
      controller.item(40)!,
      const TriageSuggestion(addedLabels: [needsTeamInputLabel]),
    );

    await controller.apply(controller.item(40)!);

    expect(github.calls, [
      'POST issues/40/labels {"labels":["status: needs-team-input"]}',
    ]);
    expect(controller.session.isSentToTeam(40), isTrue);
  });

  test('sends an item to the team', () async {
    await controller.start();
    controller.select(10);

    await controller.sendToTeam(controller.item(10)!, comment: 'Thoughts.');

    expect(github.calls, [
      'POST issues/10/labels {"labels":["status: needs-team-input"]}',
      'POST issues/10/comments {"body":"Thoughts."}',
    ]);
    expect(numbers(controller.newItems), [11, 20, 21]);
    expect(numbers(controller.teamInputItems), [10, 40, 41]);
    expect(controller.selected!.number, 20);
    expect(controller.remaining, 5);
    expect(controller.session.isSentToTeam(10), isTrue);
    expect(controller.report(), contains('Sent 1 issue to the team.'));
  });

  test('sends an item opened by URL to the team', () async {
    await controller.start();
    await controller.open(url('issues/30'));

    await controller.sendToTeam(controller.item(30)!);

    expect(github.calls, [
      'POST issues/30/labels {"labels":["status: needs-team-input"]}',
    ]);
    expect(controller.opened, isEmpty);
    expect(numbers(controller.teamInputItems), [30, 40, 41]);
  });

  test('reports a failure to send an item to the team', () async {
    github.failing.add('POST issues/10/labels');
    await controller.start();

    await controller.sendToTeam(controller.item(10)!, comment: 'Thoughts.');

    expect(controller.error, contains('Could not add'));
    expect(github.calls.where((c) => c.contains('comments')), isEmpty);
    expect(controller.session.isSentToTeam(10), isFalse);
    expect(numbers(controller.newItems), [11, 10, 20, 21]);
  });
}
