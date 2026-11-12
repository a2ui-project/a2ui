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

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:triage/triage.dart';
import 'package:triage_ui/src/github/github_client.dart';
import 'package:triage_ui/src/github_item.dart';
import 'package:triage_ui/src/model/applier.dart';
import 'package:triage_ui/src/model/log_entry.dart';
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

  List<String> names(List<TriageItem> items) => [
    for (final i in items) i.shortName,
  ];

  GitHubItem url(String path) =>
      GitHubItem.tryParse('https://github.com/a2ui-project/a2ui/$path')!;

  test('loads the queue in groups: issues with open PRs, issues without open '
      'PRs, PRs with issues, then PRs without issues, least recently updated '
      'first', () async {
    await controller.start();

    expect(controller.isConnected, isTrue);
    expect(numbers(controller.newItems), [11, 10, 20, 21]);
    expect(numbers(controller.teamInputItems), [40, 41]);
    expect(controller.selected, isNull);
    expect(controller.remaining, 6);
    expect(controller.repositoryInfo(a2uiRepository).labels, contains('P1'));
  });

  test('triages the PRs on genui in the same groups as the items of a2ui, '
      'and changes them on genui', () async {
    github.genuiItems
      // The same number as an issue on a2ui.
      ..[10] = itemNode(
        10,
        repository: genuiRepository,
        pr: true,
        createdAt: day(3),
      )
      ..[11] = itemNode(
        11,
        repository: genuiRepository,
        pr: true,
        labels: [needsTeamInputLabel],
        createdAt: day(6),
      )
      // Issues on genui are not in the queue.
      ..[12] = itemNode(12, repository: genuiRepository);

    await controller.start();

    expect(names(controller.newItems), [
      '#11',
      '#10',
      '#20',
      '#21',
      'genui #10',
    ]);
    expect(names(controller.teamInputItems), ['#40', '#41', 'genui #11']);
    expect(controller.remaining, 8);
    expect(controller.item(genui(10))!.name, 'genui PR #10');
    expect(controller.item(a2ui(10))!.name, 'Issue #10');
    expect(
      controller.repositoryInfo(genuiRepository).labels,
      isNot(contains('type: bug')),
    );

    controller
      ..select(genui(10))
      ..draftFor(
        controller.item(genui(10))!,
        const TriageSuggestion(addedLabels: ['P2'], reply: 'Thanks!'),
      );
    await controller.apply(controller.item(genui(10))!);

    expect(github.calls, [
      'POST flutter/genui/issues/10/comments {"body":"Thanks!"}',
      'DELETE flutter/genui/issues/10/labels/status%3A%20needs-triage',
      'POST flutter/genui/issues/10/labels {"labels":["P2"]}',
    ]);
    expect(controller.session.isApplied(genui(10)), isTrue);
    expect(controller.session.isApplied(a2ui(10)), isFalse);
    expect(controller.item(genui(10))!.labels, contains('P2'));
    expect(controller.item(a2ui(10))!.labels, isNot(contains('P2')));

    await controller.open(
      GitHubItem.tryParse('https://github.com/flutter/genui/issues/12')!,
    );
    expect(controller.selected!.name, 'genui Issue #12');
    expect(names(controller.opened), ['genui #12']);
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

    // 12 is the most recently updated issue without open PRs, but the only one
    // with a suggestion.
    expect(numbers(controller.newItems), [11, 12, 10, 20, 21]);
  });

  test('deselects the selected item', () async {
    await controller.start();
    controller.select(a2ui(11));

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
    final TriageItem issue = controller.item(a2ui(12))!;

    expect(numbers(controller.group(issue)), [12]);
    await controller.loadLinked(issue);
    expect(numbers(controller.group(issue)), [12, 31]);
    // Item 11 is linked to PR 20, which is in the queue.
    expect(numbers(controller.group(controller.item(a2ui(11))!)), [11, 20]);
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
    controller.select(a2ui(10));
    final TriageItem item = controller.selected!;
    controller.draftFor(item, const TriageSuggestion(addedLabels: ['P2']));

    await controller.apply(item);

    expect(controller.lastResult(a2ui(10))!.succeeded, isTrue);
    expect(controller.session.isApplied(a2ui(10)), isTrue);
    expect(controller.selected!.number, 20);
    expect(controller.remaining, 5);
    // The item shows its new labels, and stays in its place until a refresh.
    expect(controller.item(a2ui(10))!.labels, contains('P2'));
    expect(numbers(controller.newItems), [11, 10, 20, 21]);
  });

  test('selects the next item before the apply finishes', () async {
    await controller.start();
    controller.select(a2ui(10));
    final TriageItem item = controller.selected!;
    controller.draftFor(item, const TriageSuggestion(addedLabels: ['P2']));
    final Completer<void> hold = github.hold = Completer<void>();

    final Future<void> applying = controller.apply(item);

    expect(controller.selected!.number, 20);
    expect(controller.isApplying(a2ui(10)), isTrue);
    expect(controller.session.isApplied(a2ui(10)), isFalse);

    hold.complete();
    github.hold = null;
    await applying;
    expect(controller.isApplying(a2ui(10)), isFalse);
    expect(controller.session.isApplied(a2ui(10)), isTrue);
    expect(controller.selected!.number, 20);
  });

  test('moves on from a failed item, and posts its reply once', () async {
    github.unassignable.add('stranger');
    await controller.start();
    controller.select(a2ui(10));
    final TriageItem item = controller.selected!;
    controller.draftFor(
      item,
      const TriageSuggestion(reply: 'Thanks!', newAssignees: ['stranger']),
    );

    await controller.apply(item);
    expect(controller.lastResult(a2ui(10))!.succeeded, isFalse);
    expect(controller.selected!.number, 20);
    expect(controller.session.isApplied(a2ui(10)), isFalse);

    controller.select(a2ui(10));

    controller.draftFor(item, const TriageSuggestion()).newAssignees = [];
    await controller.apply(controller.item(a2ui(10))!);

    expect(controller.lastResult(a2ui(10))!.succeeded, isTrue);
    expect(github.calls.where((c) => c.contains('comments')), hasLength(1));

    // The log has both applies, with every step, the reply and the error.
    final List<LogEntry> log = controller.logOf(a2ui(10));
    expect(log.map((LogEntry e) => e.title), [
      'Some changes failed',
      'Applied the suggestion',
    ]);
    expect(log.first.failed, isTrue);
    // The reply, removing "status: needs-triage", and the assignee.
    expect(log.first.steps.map((StepResult s) => s.status), [
      StepStatus.done,
      StepStatus.done,
      StepStatus.failed,
    ]);
    expect(log.first.steps.first.text, 'Thanks!');
    expect(log.first.steps.last.description, 'Assign: stranger');
    expect(log.first.steps.last.error, isNotNull);
    expect(log.last.failed, isFalse);
    expect(log.last.steps.first.description, 'Post the reply: already posted');
    expect(log.last.steps.first.status, StepStatus.skipped);
  });

  test('refresh drops triaged items and resets the drafts of changed '
      'items', () async {
    await controller.start();
    controller
      ..draftFor(controller.item(a2ui(10))!, const TriageSuggestion(reply: 'A'))
      ..draftFor(
        controller.item(a2ui(11))!,
        const TriageSuggestion(reply: 'B'),
      );
    github
      ..change(10, (item) => item['title'] = 'Renamed')
      ..change(20, (item) => item['labels'] = {'nodes': <Object?>[]})
      ..items[50] = itemNode(50, createdAt: day(4));

    await controller.refresh();

    // Item 10 was updated last, so it moves after 50.
    expect(numbers(controller.newItems), [11, 50, 10, 21]);
    expect(controller.changedOnGitHub(a2ui(10)), isTrue);
    expect(controller.changedOnGitHub(a2ui(11)), isFalse);
    expect(controller.item(a2ui(10))!.title, 'Renamed');
    const empty = TriageSuggestion();
    expect(
      controller.draftFor(controller.item(a2ui(10))!, empty).reply.text,
      '',
    );
    expect(controller.logOf(a2ui(10)).single.title, contains('changed on'));
    expect(controller.logOf(a2ui(11)), isEmpty);
    expect(
      controller.draftFor(controller.item(a2ui(11))!, empty).reply.text,
      'B',
    );
  });

  test('refresh does not take the triager own changes for others', () async {
    await controller.start();
    controller.draftFor(
      controller.item(a2ui(10))!,
      const TriageSuggestion(addedLabels: ['P2']),
    );
    await controller.apply(controller.item(a2ui(10))!);

    await controller.refresh();

    expect(controller.changedOnGitHub(a2ui(10)), isFalse);
  });

  test('applying to an item that needs team input removes the label, and '
      'keeps the item in its group', () async {
    await controller.start();
    controller.draftFor(
      controller.item(a2ui(40))!,
      const TriageSuggestion(addedLabels: ['P2']),
    );

    await controller.apply(controller.item(a2ui(40))!);

    expect(github.calls, [
      'DELETE issues/40/labels/status%3A%20needs-triage',
      'DELETE issues/40/labels/status%3A%20needs-team-input',
      'POST issues/40/labels {"labels":["P2"]}',
    ]);
    expect(controller.item(a2ui(40))!.needsTeamInput, isFalse);
    expect(numbers(controller.teamInputItems), [40, 41]);
    expect(controller.session.isApplied(a2ui(40)), isTrue);
  });

  test('applying a suggestion that adds the label keeps it', () async {
    await controller.start();
    controller.draftFor(
      controller.item(a2ui(40))!,
      const TriageSuggestion(addedLabels: [needsTeamInputLabel]),
    );

    await controller.apply(controller.item(a2ui(40))!);

    expect(github.calls, [
      'DELETE issues/40/labels/status%3A%20needs-triage',
      'POST issues/40/labels {"labels":["status: needs-team-input"]}',
    ]);
    expect(controller.session.isSentToTeam(a2ui(40)), isTrue);
  });

  test('applying a suggestion that adds the label lists the item under '
      'Needs team input too', () async {
    await controller.start();
    controller.select(a2ui(10));
    controller.draftFor(
      controller.item(a2ui(10))!,
      const TriageSuggestion(addedLabels: [needsTeamInputLabel]),
    );

    await controller.apply(controller.item(a2ui(10))!);

    expect(github.calls, [
      'DELETE issues/10/labels/status%3A%20needs-triage',
      'POST issues/10/labels {"labels":["status: needs-team-input"]}',
    ]);
    // The item stays in its group, and is also under Needs team input.
    expect(numbers(controller.newItems), [11, 10, 20, 21]);
    expect(numbers(controller.teamInputItems), [10, 40, 41]);
    expect(controller.selected!.number, 20);
    expect(controller.selectedGroup, ItemGroup.newItems);
    expect(controller.remaining, 5);
    expect(controller.session.isSentToTeam(a2ui(10)), isTrue);
  });

  test(
    'selects the next item in the group in which the item was selected',
    () async {
      await controller.start();
      controller.draftFor(
        controller.item(a2ui(10))!,
        const TriageSuggestion(addedLabels: [needsTeamInputLabel]),
      );
      await controller.apply(controller.item(a2ui(10))!);
      // Listed in New and in Needs team input.
      controller.select(a2ui(10));
      expect(controller.selectedGroup, ItemGroup.newItems);
      controller.select(a2ui(10), group: ItemGroup.teamInput);
      final TriageItem item = controller.selected!;
      controller.draftFor(item, const TriageSuggestion(addedLabels: ['P2']));

      await controller.apply(item);

      // Not #20, which comes after #10 in New.
      expect(controller.selected!.number, 40);
      expect(controller.selectedGroup, ItemGroup.teamInput);
    },
  );

  test('lists an item opened by URL under Needs team input after applying '
      'a suggestion that adds the label', () async {
    await controller.start();
    await controller.open(url('issues/30'));
    controller.draftFor(
      controller.item(a2ui(30))!,
      const TriageSuggestion(addedLabels: [needsTeamInputLabel]),
    );

    await controller.apply(controller.item(a2ui(30))!);

    expect(
      github.calls,
      contains('POST issues/30/labels {"labels":["status: needs-team-input"]}'),
    );
    expect(numbers(controller.opened), [30]);
    expect(numbers(controller.teamInputItems), [30, 40, 41]);
  });
  test(
    'hides the applied items that left their group, until a refresh',
    () async {
      github.unassignable.add('stranger');
      await controller.start();
      expect(controller.hasTriaged, isFalse);
      controller
        ..draftFor(
          controller.item(a2ui(10))!,
          const TriageSuggestion(addedLabels: ['P2']),
        )
        ..draftFor(
          controller.item(a2ui(11))!,
          const TriageSuggestion(addedLabels: [needsTeamInputLabel]),
        )
        ..draftFor(
          controller.item(a2ui(40))!,
          const TriageSuggestion(addedLabels: ['P2']),
        )
        // Fails, so it is not triaged, though it loses "status: needs-triage".
        ..draftFor(
          controller.item(a2ui(21))!,
          const TriageSuggestion(newAssignees: ['stranger']),
        );
      await controller.applyAll([
        for (final n in [10, 11, 40, 21]) controller.item(a2ui(n))!,
      ]);
      controller.select(a2ui(10));
      expect(controller.hasTriaged, isTrue);

      controller.hideTriaged();

      expect(numbers(controller.newItems), [20, 21]);
      // #11 was sent to the team, so it left only New.
      expect(numbers(controller.teamInputItems), [11, 41]);
      expect(controller.hasTriaged, isFalse);
      expect(controller.selected, isNull);

      await controller.refresh();

      expect(numbers(controller.newItems), [20]);
      expect(numbers(controller.teamInputItems), [11, 41]);
    },
  );

  test('hides an item opened by URL that the triager sent to the team only '
      'from Not in the queue', () async {
    await controller.start();
    await controller.open(url('issues/30'));
    controller.draftFor(
      controller.item(a2ui(30))!,
      const TriageSuggestion(addedLabels: [needsTeamInputLabel]),
    );
    await controller.apply(controller.item(a2ui(30))!);
    controller.select(a2ui(30), group: ItemGroup.notInQueue);

    controller.hideTriaged();

    expect(controller.opened, isEmpty);
    expect(numbers(controller.teamInputItems), [30, 40, 41]);
    // Still selected, now in the group that has it.
    expect(controller.selected!.number, 30);
    expect(controller.selectedGroup, ItemGroup.teamInput);
  });
}
