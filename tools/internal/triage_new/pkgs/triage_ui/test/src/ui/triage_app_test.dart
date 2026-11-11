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
import 'package:triage_ui/src/ui/chip_list_field.dart';
import 'package:triage_ui/src/ui/item_list.dart';
import 'package:triage_ui/src/ui/label_colors.dart';
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
              'Row.""", reason="Priority is not set.", '
              'suggestion="""Set P1 and assign octocat.""", '
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

  /// Starts the app, and selects item 10 unless [selectFirst] is false.
  Future<void> pumpApp(WidgetTester tester, {bool selectFirst = true}) async {
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
    if (selectFirst) controller.select(a2ui(10));
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

  /// The selected priority of the first item card.
  Set<String> priorityOf(WidgetTester tester) => tester
      .widget<SegmentedButton<String>>(
        find
            .ancestor(
              of: find.text('P0').first,
              matching: find.byWidgetPredicate(
                (w) => w is SegmentedButton<String>,
              ),
            )
            .first,
      )
      .selected;

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
    await expand(tester, 'Issues with open PRs (1)');
    await expand(tester, 'Issues without open PRs (1)');
    await expand(tester, 'PRs with issues (1)');
    expect(find.byTooltip('Issue with open PRs'), findsOneWidget);
    expect(find.byTooltip('Issue without open PRs'), findsOneWidget);
    expect(find.byTooltip('PR with issues'), findsOneWidget);
    expect(inList('suggestion'), findsOneWidget);
    expect(inList('no suggestion'), findsNWidgets(2));
    expect(inList('PR #20'), findsOneWidget);
    expect(inList('issue #10'), findsOneWidget);

    // The suggestion, rendered by the TriageSuggestion component.
    expect(find.text('A crash on an empty Row.'), findsOneWidget);
    expect(find.text('Why flagged for triage'), findsOneWidget);
    expect(find.text('Priority is not set.'), findsOneWidget);
    expect(find.text('Set P1 and assign octocat.'), findsOneWidget);
    expect(find.text('Thanks for the report.'), findsOneWidget);
    // The priority is a segmented button, not a label chip.
    expect(priorityOf(tester), {'P1'});
    expect(find.widgetWithText(InputChip, 'P1'), findsNothing);
    expect(find.widgetWithText(InputChip, 'octocat'), findsOneWidget);
    // Item 10 has a label to remove, and no assignee or milestone.
    expect(find.text('Remove labels'), findsWidgets);
    expect(find.text('Unassign'), findsNothing);
    expect(find.text('Remove milestone'), findsNothing);
    expect(find.widgetWithText(ActionChip, 'Issue #1234'), findsOneWidget);
    expect(find.widgetWithText(ActionChip, 'Fixed by PR #20'), findsOneWidget);

    // The item's age and author, on rows of their own.
    expect(find.textContaining(RegExp(r'^Age: \d+ days\.$')), findsWidgets);
    expect(find.text('Author: author10.'), findsOneWidget);
    // The texts can be selected: on the page, in the list and in the
    // details, each in a selection area of its own.
    expect(find.byType(SelectionArea), findsNWidgets(3));
    // The label and assignee fields have no text box, only the dropdown.
    expect(
      find.descendant(
        of: find.byType(ChipListField),
        matching: find.byType(TextField),
      ),
      findsNothing,
    );

    // The linked PR needs triage too, so it has a tab next to the issue's.
    expect(find.widgetWithText(Tab, '#10'), findsOneWidget);
    await tester.tap(find.widgetWithText(Tab, '#20'));
    await tester.pumpAndSettle();
    expect(find.text('PR #20: Fix the Row crash'), findsOneWidget);
  });

  testWidgets('applies the edited suggestion and moves to the next item', (
    tester,
  ) async {
    await pumpApp(tester);

    // P2 instead of the suggested P1.
    await tester.tap(find.text('P2').first);
    await tester.pumpAndSettle();
    expect(priorityOf(tester), {'P2'});
    await tester.tap(find.byTooltip('Choose the milestone').first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(MenuItemButton, 'November launch'));
    await tester.tapAt(Offset.zero);
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Apply').first);
    await tester.pump();
    for (var i = 0; i < 100 && controller.isApplying(a2ui(10)); i++) {
      await tester.pump(const Duration(milliseconds: 10));
    }
    await tester.pumpAndSettle();

    expect(github.calls, [
      'POST issues/10/comments {"body":"Thanks for the report."}',
      'POST issues/10/labels {"labels":["P2"]}',
      'POST issues/10/assignees {"assignees":["octocat"]}',
      'PATCH issues/10 {"milestone":10}',
    ]);
    expect(find.text('2 items need triage'), findsOneWidget);
    // The list shows the next item, #11, which is in another subgroup.
    await expand(tester, 'Issues with open PRs (1)');
    expect(find.byIcon(Icons.check_circle), findsOneWidget);
    expect(find.text('Issue #11: Docs are unclear'), findsOneWidget);
  });

  testWidgets('removes labels, assignees and the milestone with checkboxes, '
      'and clears the priority', (tester) async {
    github.items[10]!
      ..['labels'] = {
        'nodes': [
          {'name': needsTriageLabel},
          {'name': 'type: bug'},
          {'name': 'P2'},
        ],
      }
      ..['assignees'] = {
        'nodes': [
          {'login': 'hubot'},
        ],
      }
      ..['milestone'] = {'title': 'November launch'};
    await pumpApp(tester);

    // The priority is not among the labels to remove.
    expect(find.byTooltip('Remove type: bug'), findsOneWidget);
    expect(find.byTooltip('Remove P2'), findsNothing);

    // A checked label is grayed out.
    await tester.tap(find.byTooltip('Remove type: bug'));
    await tester.pumpAndSettle();
    final Opacity bug = tester.widget(
      find
          .ancestor(
            of: find.widgetWithText(LabelPill, 'type: bug').last,
            matching: find.byType(Opacity),
          )
          .first,
    );
    expect(bug.opacity, lessThan(1));
    for (final name in ['hubot', 'November launch']) {
      await tester.ensureVisible(find.byTooltip('Remove $name'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Remove $name'));
      await tester.pumpAndSettle();
    }
    // The suggestion sets P1; clicking it again sets no priority, which
    // removes the item's P2.
    await tester.ensureVisible(find.text('P1').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('P1').first);
    await tester.pumpAndSettle();
    expect(priorityOf(tester), isEmpty);

    final Finder apply = find.widgetWithText(FilledButton, 'Apply').first;
    await tester.ensureVisible(apply);
    await tester.pumpAndSettle();
    await tester.tap(apply);
    await tester.pump();
    for (var i = 0; i < 100 && controller.isApplying(a2ui(10)); i++) {
      await tester.pump(const Duration(milliseconds: 10));
    }
    await tester.pumpAndSettle();

    expect(github.calls, [
      'POST issues/10/comments {"body":"Thanks for the report."}',
      'DELETE issues/10/labels/type%3A%20bug',
      'DELETE issues/10/labels/P2',
      'DELETE issues/10/assignees {"assignees":["hubot"]}',
      'POST issues/10/assignees {"assignees":["octocat"]}',
      'PATCH issues/10 {"milestone":null}',
    ]);
  });

  testWidgets('shows labels in their GitHub colors', (tester) async {
    github.items[10]!['labels'] = {
      'nodes': [
        {'name': needsTriageLabel},
        {'name': 'type: bug'},
      ],
    };
    github.labelColors['area: docs'] = '1d76db';
    await pumpApp(tester);

    // The dropdown shows a dot of the label's color.
    await tester.tap(find.byTooltip('Choose labels to add').first);
    await tester.pumpAndSettle();
    expect(
      find.descendant(
        of: find.widgetWithText(MenuItemButton, 'area: docs'),
        matching: find.byWidgetPredicate(
          (w) =>
              w is DecoratedBox &&
              (w.decoration as BoxDecoration).color == const Color(0xFF1D76DB),
        ),
      ),
      findsOneWidget,
    );
    await tester.tap(find.widgetWithText(MenuItemButton, 'area: docs'));
    await tester.tapAt(Offset.zero);
    await tester.pumpAndSettle();

    // The label is dark, so its name on the chip is white.
    final InputChip docs = tester.widget(
      find.widgetWithText(InputChip, 'area: docs'),
    );
    expect(docs.backgroundColor, const Color(0xFF1D76DB));
    expect(docs.labelStyle!.color, Colors.white);

    // On the item card, a light label has black text, and a label without a
    // color has the theme's colors.
    final DecoratedBox bug = tester.widget(
      find
          .ancestor(
            of: find.text('type: bug'),
            matching: find.byType(DecoratedBox),
          )
          .first,
    );
    expect((bug.decoration as BoxDecoration).color, const Color(0xFFFBCA04));
    expect(
      tester.widget<Text>(find.text('type: bug').first).style!.color,
      Colors.black,
    );
    // In the labels of the item, and in the labels to remove.
    expect(find.widgetWithText(LabelPill, needsTriageLabel), findsNWidgets(2));
  });

  testWidgets('picks labels from the dropdown', (tester) async {
    await pumpApp(tester);

    List<String> choices() => [
      for (final Text text in tester.widgetList(
        find.descendant(
          of: find.byType(MenuItemButton),
          matching: find.byType(Text),
        ),
      ))
        text.data!,
    ];
    await tester.tap(find.byTooltip('Choose labels to add').first);
    await tester.pumpAndSettle();
    // The priorities have a field of their own.
    expect(choices(), ['area: docs', 'type: bug', needsTeamInputLabel]);
    await tester.tap(find.widgetWithText(MenuItemButton, 'type: bug'));
    await tester.pumpAndSettle();

    // The dropdown stays open, shows what is checked, and keeps the
    // choices in their places.
    expect(
      find.descendant(
        of: find.widgetWithText(MenuItemButton, 'type: bug'),
        matching: find.byIcon(Icons.check_box),
      ),
      findsOneWidget,
    );
    expect(find.widgetWithText(InputChip, 'type: bug'), findsOneWidget);
    expect(choices(), ['area: docs', 'type: bug', needsTeamInputLabel]);

    // Opened again, the dropdown lists the checked label first.
    await tester.tapAt(Offset.zero);
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Choose labels to add').first);
    await tester.pumpAndSettle();
    expect(choices(), ['type: bug', 'area: docs', needsTeamInputLabel]);
  });

  testWidgets('filters a dropdown with more than 7 choices', (tester) async {
    github.labels.addAll([
      'area: lit',
      'area: angular',
      'area: react',
      'area: swift',
      'area: vue',
    ]);
    await pumpApp(tester);
    Finder filter() => find.widgetWithText(TextField, 'Filter');

    // There are two milestones, so there is nothing to filter.
    await tester.tap(find.byTooltip('Choose the milestone').first);
    await tester.pumpAndSettle();
    expect(filter(), findsNothing);
    await tester.tapAt(Offset.zero);
    await tester.pumpAndSettle();

    // Another field has the cursor when the triager opens the dropdown.
    await tester.tap(find.widgetWithText(TextField, 'Reply').first);
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Choose labels to add').first);
    await tester.pumpAndSettle();
    expect(filter(), findsOneWidget);
    // The cursor is in the search field, so the triager can type right away.
    final EditableText search = tester.widget(
      find.descendant(of: filter(), matching: find.byType(EditableText)),
    );
    expect(search.focusNode.hasFocus, isTrue);
    // It keeps the cursor when the mouse moves over the choices.
    final TestGesture mouse = await tester.createGesture(
      kind: PointerDeviceKind.mouse,
    );
    addTearDown(mouse.removePointer);
    await mouse.addPointer(location: Offset.zero);
    await mouse.moveTo(
      tester.getCenter(find.widgetWithText(MenuItemButton, 'type: bug')),
    );
    await tester.pumpAndSettle();
    expect(search.focusNode.hasFocus, isTrue);
    await tester.enterText(filter(), 'AREA');
    await tester.pumpAndSettle();
    expect(find.byType(MenuItemButton), findsNWidgets(6));

    await tester.tap(find.widgetWithText(MenuItemButton, 'area: lit'));
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
    expect(find.byType(MenuItemButton), findsNWidgets(8));
  }, variant: TargetPlatformVariant.desktop());

  testWidgets('sends the item and its linked PR to the team', (tester) async {
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
      'POST issues/20/labels {"labels":["status: needs-team-input"]}',
      'POST issues/20/comments {"body":"Is this a P0?"}',
    ]);
    expect(find.text('New (1)'), findsOneWidget);
    expect(find.text('Issue #11: Docs are unclear'), findsOneWidget);
    await expand(tester, 'Needs team input (2)');
    await expand(tester, 'Issues with open PRs (1)');
    expect(find.byIcon(Icons.groups), findsOneWidget);
  });

  testWidgets('marks edited tabs, reverts them, and applies all tabs '
      'together', (tester) async {
    await pumpApp(tester);
    final Finder revert = find.widgetWithText(TextButton, 'Revert');
    final Finder edited = find.byTooltip('Edited');
    expect(edited, findsNothing);
    expect(tester.widget<TextButton>(revert).onPressed, isNull);

    Future<void> addBugLabelToThePr() async {
      await tester.tap(find.widgetWithText(Tab, '#20'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Choose labels to add'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(MenuItemButton, 'type: bug'));
      await tester.tapAt(Offset.zero);
      await tester.pumpAndSettle();
    }

    await addBugLabelToThePr();
    expect(edited, findsOneWidget);
    expect(find.widgetWithText(InputChip, 'type: bug'), findsOneWidget);

    await tester.tap(revert);
    await tester.pumpAndSettle();
    expect(edited, findsNothing);
    expect(find.widgetWithText(InputChip, 'type: bug'), findsNothing);

    await addBugLabelToThePr();
    await tester.tap(find.widgetWithText(FilledButton, 'Apply'));
    await tester.pump();
    for (
      var i = 0;
      i < 100 &&
          (controller.isApplying(a2ui(10)) || controller.isApplying(a2ui(20)));
      i++
    ) {
      await tester.pump(const Duration(milliseconds: 10));
    }
    await tester.pumpAndSettle();

    // The issue's suggestion and the PR's edits, in one click.
    expect(github.calls, [
      'POST issues/10/comments {"body":"Thanks for the report."}',
      'POST issues/10/labels {"labels":["P1"]}',
      'POST issues/10/assignees {"assignees":["octocat"]}',
      'POST issues/20/labels {"labels":["type: bug"]}',
    ]);
    expect(controller.selected!.number, 11);
  });

  testWidgets('says which related items are closed or merged', (tester) async {
    // The suggestion names issue #1234 as related, and the issue is linked
    // to PR #20, which this test merges.
    github
      ..items[1234] = itemNode(1234, state: 'CLOSED', labels: [])
      ..items[20]!['state'] = 'MERGED';
    await pumpApp(tester);
    // Loads #1234, which is not in the queue.
    await settle(
      tester,
      () => Future<void>.delayed(const Duration(milliseconds: 10)),
    );

    expect(
      find.widgetWithText(ActionChip, 'Issue #1234 (closed)'),
      findsOneWidget,
    );
    expect(
      find.widgetWithText(ActionChip, 'Fixed by PR #20 (merged)'),
      findsOneWidget,
    );
  });

  testWidgets('copies links with the button to their right', (tester) async {
    await pumpApp(tester);

    Finder copyNextTo(Finder link) => find.descendant(
      of: find.ancestor(of: link, matching: find.byType(Row)).first,
      matching: find.byTooltip('Copy link'),
    );

    await tester.tap(
      copyNextTo(find.widgetWithText(ActionChip, 'Fixed by PR #20')),
    );
    await tester.pump();
    expect(clipboard.last, 'https://github.com/a2ui-project/a2ui/pull/20');
    expect(
      find.text('Copied https://github.com/a2ui-project/a2ui/pull/20'),
      findsOneWidget,
    );

    await tester.tap(
      copyNextTo(
        find.text('Issue #10: Flutter renderer crashes on an empty Row'),
      ),
    );
    await tester.pump();
    expect(clipboard.last, 'https://github.com/a2ui-project/a2ui/issues/10');
  });

  testWidgets('starts with nothing selected, and a second click on an item '
      'deselects it', (tester) async {
    await pumpApp(tester, selectFirst: false);
    expect(controller.selected, isNull);
    expect(find.text('Select an item.'), findsOneWidget);

    await expand(tester, 'New (3)');
    await expand(tester, 'Issues without open PRs (1)');
    await tester.tap(inList('#11 Docs are unclear'));
    await tester.pumpAndSettle();
    expect(controller.selected!.number, 11);
    expect(find.text('Issue #11: Docs are unclear'), findsOneWidget);

    await tester.tap(inList('#11 Docs are unclear'));
    await tester.pumpAndSettle();
    expect(controller.selected, isNull);
    expect(find.text('Select an item.'), findsOneWidget);
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
    expect((tile.shape! as RoundedRectangleBorder).side.width, 2);
  });

  testWidgets('triages a PR on genui in the same groups as the items of '
      'a2ui', (tester) async {
    github.genuiItems[7] = itemNode(
      7,
      repository: genuiRepository,
      pr: true,
      title: 'Add a Slider',
      createdAt: day(3),
    );
    await pumpApp(tester, selectFirst: false);

    expect(find.text('4 items need triage'), findsOneWidget);
    await expand(tester, 'New (4)');
    await expand(tester, 'PRs without issues (1)');
    await tester.tap(inList('genui #7 Add a Slider'));
    await tester.pumpAndSettle();

    expect(controller.selected!.ref, genui(7));
    expect(find.widgetWithText(Tab, 'genui #7'), findsOneWidget);
    expect(find.text('genui PR #7: Add a Slider'), findsOneWidget);

    await tester.tap(find.text('P1').first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Apply').first);
    await tester.pump();
    for (var i = 0; i < 100 && controller.isApplying(genui(7)); i++) {
      await tester.pump(const Duration(milliseconds: 10));
    }
    await tester.pumpAndSettle();

    expect(github.calls, [
      'POST flutter/genui/issues/7/labels {"labels":["P1"]}',
    ]);
    expect(find.text('3 items need triage'), findsOneWidget);
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
    await expand(tester, 'Issues without open PRs (1)');
    await tester.tap(inList('#11 Docs are unclear'));
    await tester.pumpAndSettle();

    expect(find.textContaining('no suggestion yet'), findsNothing);
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
