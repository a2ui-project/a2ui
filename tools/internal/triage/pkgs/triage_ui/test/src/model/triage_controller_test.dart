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
import 'package:triage_ui/src/model/triage_controller.dart';
import 'package:triage_ui/src/model/triage_item.dart';

import '../../support/fake_github.dart';

void main() {
  late FakeGitHub github;
  late TriageController controller;

  setUp(() {
    github = FakeGitHub([
      itemNode(20, pr: true, createdAt: day(1), linked: [11]),
      itemNode(11, createdAt: day(3), linked: [20]),
      itemNode(10, createdAt: day(2)),
      itemNode(30, labels: ['P1'], createdAt: day(1)),
    ]);
    controller = TriageController(connect: () async => github.service());
  });

  tearDown(() => controller.dispose());

  List<int> numbers(List<TriageItem> items) => [
    for (final i in items) i.number,
  ];

  GitHubItem url(String path) =>
      GitHubItem.tryParse('https://github.com/a2ui-project/a2ui/$path')!;

  test('loads the queue: issues, then PRs, oldest first', () async {
    await controller.start();

    expect(controller.isConnected, isTrue);
    expect(numbers(controller.orderedItems), [10, 11, 20]);
    expect(controller.selected!.number, 10);
    expect(controller.remaining, 3);
    expect(controller.repositoryInfo.labels, contains('P1'));
    expect(numbers(controller.relatedInQueue(controller.item(11)!)), [20]);
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
    expect(controller.remaining, 3);
  });

  test('applies the draft, then selects the next item', () async {
    await controller.start();
    final TriageItem item = controller.selected!;
    controller.draftFor(item, const TriageSuggestion(addedLabels: ['P2']));

    await controller.apply(item);

    expect(controller.lastResult(10)!.succeeded, isTrue);
    expect(controller.session.isApplied(10), isTrue);
    expect(controller.selected!.number, 11);
    expect(controller.remaining, 2);
    // The item shows its new labels, and stays in the list until a refresh.
    expect(controller.item(10)!.labels, contains('P2'));
    expect(numbers(controller.orderedItems), [10, 11, 20]);
  });

  test('keeps a failed item selected, and posts its reply once', () async {
    github.unassignable.add('stranger');
    await controller.start();
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
      ..items[40] = itemNode(40, createdAt: day(4));

    await controller.refresh();

    expect(numbers(controller.orderedItems), [10, 11, 40]);
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
}
