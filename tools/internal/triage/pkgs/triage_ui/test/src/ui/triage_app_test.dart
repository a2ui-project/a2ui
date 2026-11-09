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

import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:triage_ui/src/github_item.dart';
import 'package:triage_ui/src/model/triage_controller.dart';
import 'package:triage_ui/src/model/triage_item.dart';
import 'package:triage_ui/src/ui/item_list.dart';
import 'package:triage_ui/src/ui/triage_app.dart';

import '../../support/fake_github.dart';

void main() {
  late FakeGitHub github;
  late TriageController controller;
  late List<String> clipboard;

  setUp(() {
    github = FakeGitHub([
      itemNode(
        10,
        title: 'Flutter renderer crashes on an empty Row',
        createdAt: day(1),
        linked: [20],
        comments: [
          commentNode(
            suggestionComment(
              'root = TriageSuggestion(summary="""A crash on an empty '
              'Row.""", suggestion="""Set P1 and assign octocat.""", '
              'reply="""Thanks for the report.""", added_labels=["P1"], '
              'new_assignees=["octocat"], related_issues=[1234])',
            ),
            at: day(2),
          ),
        ],
      ),
      itemNode(11, title: 'Docs are unclear', createdAt: day(3)),
      itemNode(
        20,
        pr: true,
        title: 'Fix the Row crash',
        createdAt: day(2),
        linked: [10],
      ),
    ]);
    controller = TriageController(connect: () async => github.service());
    clipboard = [];
  });

  Future<void> pumpApp(WidgetTester tester) async {
    tester.view
      ..physicalSize = const Size(1600, 1400)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (MethodCall call) async {
        if (call.method == 'Clipboard.setData') {
          clipboard.add(
            (call.arguments as Map<Object?, Object?>)['text']! as String,
          );
        }
        return null;
      },
    );
    await tester.runAsync(controller.start);
    await tester.pumpWidget(TriageApp(controller: controller));
    await tester.pumpAndSettle();
  }

  /// Runs [action], which talks to the fake GitHub, and waits for the UI.
  Future<void> settle(
    WidgetTester tester,
    Future<void> Function() action,
  ) async {
    await tester.runAsync(action);
    await tester.pumpAndSettle();
  }

  /// Expands [group], a group or a subgroup. When several headers read the
  /// same, expands the last one.
  Future<void> expand(WidgetTester tester, String group) async {
    await tester.tap(find.text(group).last);
    await tester.pumpAndSettle();
  }

  Finder inList(String text) =>
      find.descendant(of: find.byType(ListTile), matching: find.text(text));

  testWidgets('shows the queue, and the suggestion of the first item', (
    tester,
  ) async {
    await pumpApp(tester);

    expect(find.text('3 items need triage'), findsOneWidget);
    expect(find.text('Needs team input (0)'), findsOneWidget);
    // The groups start collapsed.
    expect(find.byType(ListTile), findsNothing);

    await expand(tester, 'New (3)');
    // So do the subgroups, which only show the kinds the group has.
    expect(find.byType(ListTile), findsNothing);
    expect(find.text('PRs without issues (0)'), findsNothing);
    await expand(tester, 'Issues (2)');
    await expand(tester, 'PRs with issues (1)');
    expect(find.byTooltip('PR with issues'), findsOneWidget);
    expect(inList('suggestion'), findsOneWidget);
    expect(inList('no suggestion'), findsNWidgets(2));
    expect(inList('PR #20'), findsOneWidget);
    expect(inList('issue #10'), findsOneWidget);

    // The suggestion, rendered by the TriageSuggestion component.
    expect(find.text('A crash on an empty Row.'), findsOneWidget);
    expect(find.text('Set P1 and assign octocat.'), findsOneWidget);
    expect(find.text('Thanks for the report.'), findsOneWidget);
    expect(find.widgetWithText(InputChip, 'P1'), findsOneWidget);
    expect(find.widgetWithText(InputChip, 'octocat'), findsOneWidget);
    expect(find.widgetWithText(ActionChip, 'Issue #1234'), findsOneWidget);
    expect(find.widgetWithText(ActionChip, 'Fixed by PR #20'), findsOneWidget);

    // The linked PR needs triage too, so it is shown below the issue.
    expect(find.text('Linked PR that needs triage'), findsOneWidget);
    expect(find.text('PR #20: Fix the Row crash'), findsOneWidget);
  });

  testWidgets('applies the edited suggestion and moves to the next item', (
    tester,
  ) async {
    await pumpApp(tester);

    await tester.tap(find.byTooltip('Remove P1'));
    await tester.pump();
    await tester.enterText(
      find.widgetWithText(TextField, 'Labels to add').first,
      'P2',
    );
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();

    await tester.tap(find.widgetWithText(FilledButton, 'Apply').first);
    await tester.pump();
    for (var i = 0; i < 100 && controller.isApplying(10); i++) {
      await tester.pump(const Duration(milliseconds: 10));
    }
    await tester.pumpAndSettle();

    expect(github.calls, [
      'POST issues/10/comments {"body":"Thanks for the report."}',
      'POST issues/10/labels {"labels":["P2"]}',
      'POST issues/10/assignees {"assignees":["octocat"]}',
    ]);
    expect(find.text('2 items need triage'), findsOneWidget);
    expect(find.byIcon(Icons.check_circle), findsOneWidget);
    expect(find.text('Issue #11: Docs are unclear'), findsOneWidget);
  });

  testWidgets('picks labels from the dropdown', (tester) async {
    await pumpApp(tester);

    await tester.tap(find.byTooltip('Choose labels to add').first);
    await tester.pumpAndSettle();
    // The priority labels come first.
    final List<String> choices = [
      for (final CheckboxMenuButton b in tester.widgetList(
        find.byType(CheckboxMenuButton),
      ))
        (b.child! as Text).data!,
    ];
    expect(choices.take(4), ['P0', 'P1', 'P2', 'P3']);
    await tester.tap(find.widgetWithText(CheckboxMenuButton, 'P2'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(CheckboxMenuButton, 'P1'));
    await tester.pumpAndSettle();

    // The dropdown stays open, and shows what is checked.
    final CheckboxMenuButton p2 = tester.widget(
      find.widgetWithText(CheckboxMenuButton, 'P2'),
    );
    expect(p2.value, isTrue);
    expect(find.widgetWithText(InputChip, 'P2'), findsOneWidget);
    expect(find.widgetWithText(InputChip, 'P1'), findsNothing);
  });

  testWidgets('filters a dropdown with more than 7 choices', (tester) async {
    github.labels.addAll(['area: lit', 'area: angular']);
    await pumpApp(tester);
    Finder filter() => find.widgetWithText(TextField, 'Filter');

    // Item 10 has one label, so there is nothing to filter.
    await tester.tap(find.byTooltip('Choose labels to remove').first);
    await tester.pumpAndSettle();
    expect(filter(), findsNothing);
    await tester.tapAt(Offset.zero);
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Choose labels to add').first);
    await tester.pumpAndSettle();
    expect(filter(), findsOneWidget);
    await tester.enterText(filter(), 'AREA');
    await tester.pumpAndSettle();
    expect(find.byType(CheckboxMenuButton), findsNWidgets(3));

    await tester.tap(find.widgetWithText(CheckboxMenuButton, 'area: lit'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(InputChip, 'area: lit'), findsOneWidget);

    await tester.enterText(filter(), 'nothing like this');
    await tester.pumpAndSettle();
    expect(find.text('Nothing matches'), findsOneWidget);

    // Closing the dropdown clears the filter.
    await tester.tapAt(Offset.zero);
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Choose labels to add').first);
    await tester.pumpAndSettle();
    expect(find.byType(CheckboxMenuButton), findsNWidgets(9));
  });

  testWidgets('sends an item to the team', (tester) async {
    await pumpApp(tester);

    await tester.tap(
      find.widgetWithText(OutlinedButton, 'Needs team input').first,
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Comment for the team'),
      'Is this a P0?',
    );
    await settle(tester, () async {
      await tester.tap(find.text('Add "$needsTeamInputLabel"'));
      await Future<void>.delayed(const Duration(milliseconds: 10));
    });

    expect(github.calls, [
      'POST issues/10/labels {"labels":["status: needs-team-input"]}',
      'POST issues/10/comments {"body":"Is this a P0?"}',
    ]);
    expect(find.text('New (2)'), findsOneWidget);
    expect(find.text('Issue #11: Docs are unclear'), findsOneWidget);
    await expand(tester, 'Needs team input (1)');
    await expand(tester, 'Issues (1)');
    expect(find.byIcon(Icons.groups), findsOneWidget);
  });

  testWidgets('shows an item opened by URL in its group', (tester) async {
    await pumpApp(tester);
    expect(controller.selected!.number, 10);

    await settle(
      tester,
      () => controller.open(
        GitHubItem.tryParse('https://github.com/a2ui-project/a2ui/pull/20')!,
      ),
    );

    expect(controller.selected!.number, 20);
    expect(find.text('PR #20: Fix the Row crash'), findsOneWidget);
    final ListTile tile = tester.widget(
      find.ancestor(
        of: find.text('#20 Fix the Row crash'),
        matching: find.byType(ListTile),
      ),
    );
    expect(tile.selected, isTrue);
  });

  testWidgets('the divider resizes the item list', (tester) async {
    await pumpApp(tester);
    final Finder list = find.byType(ItemList);
    expect(tester.getSize(list).width, 400);

    await tester.drag(
      find.bySemanticsLabel('Resize the item list'),
      const Offset(150, 0),
    );
    await tester.pumpAndSettle();

    expect(tester.getSize(list).width, greaterThan(500));
  });

  testWidgets('an item without a suggestion starts empty', (tester) async {
    await pumpApp(tester);
    await expand(tester, 'New (3)');
    await expand(tester, 'Issues (2)');
    await tester.tap(inList('#11 Docs are unclear'));
    await tester.pumpAndSettle();

    expect(
      find.text('The item has no suggestion yet. Fill one in below.'),
      findsOneWidget,
    );
    expect(find.text('Nothing to apply.'), findsOneWidget);
    final Finder apply = find.widgetWithText(FilledButton, 'Apply');
    expect(tester.widget<FilledButton>(apply).onPressed, isNull);

    await tester.tap(find.text('Close as duplicate'));
    await tester.pump();
    expect(
      find.text('Enter the number of the issue that this one duplicates.'),
      findsOneWidget,
    );

    await tester.enterText(find.widgetWithText(TextField, 'Duplicate of'), '7');
    await tester.pump();
    expect(tester.widget<FilledButton>(apply).onPressed, isNotNull);
    expect(find.widgetWithText(ActionChip, 'Duplicate of #7'), findsOneWidget);
  });

  testWidgets('shows the session report, and offers it before closing', (
    tester,
  ) async {
    await pumpApp(tester);
    expect(await tester.binding.handleRequestAppExit(), AppExitResponse.exit);

    final TriageItem item = controller.selected!;
    await settle(tester, () => controller.apply(item));

    await tester.tap(find.byTooltip('Menu'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Session report'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Triaged 1 item: 1 issue.\n2 items still need'),
      findsOneWidget,
    );
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();

    final Future<AppExitResponse> exit = tester.binding.handleRequestAppExit();
    await tester.pumpAndSettle();
    expect(
      find.text('Copy the session report before closing?'),
      findsOneWidget,
    );
    await tester.tap(find.text('Copy and close'));
    await tester.pumpAndSettle();

    expect(await exit, AppExitResponse.exit);
    expect(clipboard.single, startsWith('Triaged 1 item'));
    expect(controller.session.needsReport, isFalse);
  });

  testWidgets('says when a refresh found that the item changed', (
    tester,
  ) async {
    await pumpApp(tester);
    github.change(10, (item) => item['title'] = 'Renamed');

    await tester.tap(find.byTooltip('Menu'));
    await tester.pumpAndSettle();
    await settle(tester, () async {
      await tester.tap(find.text('Refresh'));
      await Future<void>.delayed(const Duration(milliseconds: 10));
    });

    expect(find.text('Issue #10: Renamed'), findsOneWidget);
    expect(find.textContaining('The item changed on GitHub'), findsOneWidget);
  });
}
