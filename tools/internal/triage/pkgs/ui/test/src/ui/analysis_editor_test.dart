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
import 'package:material_ui/material_ui.dart';
import 'package:shared/shared.dart';
import 'package:ui/src/model/analysis_draft.dart';
import 'package:ui/src/model/triage_controller.dart';
import 'package:ui/src/model/triage_item.dart';
import 'package:ui/src/ui/triage_app.dart';

import '../../support/fake_github.dart';

void main() {
  late FakeGitHub github;
  late TriageController controller;

  setUp(() {
    github = FakeGitHub([
      itemNode(
        10,
        title: 'Crash on an empty Row',
        labels: [needsTriageLabel, 'type: bug'],
        assignees: ['hubot'],
        comments: [
          commentNode(
            analysisComment(
              'root = TriageAnalysis(reply="""Thanks.""", '
              'added_labels=["area: docs"])',
            ),
            at: day(2),
          ),
        ],
      )..['milestone'] = {'title': 'November launch'},
    ]);
    controller = TriageController(connect: () async => github.service());
  });

  Future<void> pumpEditor(WidgetTester tester) async {
    tester.view
      ..physicalSize = const Size(1600, 1400)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.runAsync(controller.start);
    controller.select(a2ui(10));
    await tester.pumpWidget(TriageApp(controller: controller));
    await tester.pumpAndSettle();
  }

  TriageItem item() => controller.item(a2ui(10))!;
  AnalysisDraft draft() => controller.draftFor(item());

  Future<void> tap(WidgetTester tester, Finder finder) async {
    await tester.ensureVisible(finder);
    await tester.pumpAndSettle();
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  Future<void> closeMenu(WidgetTester tester) async {
    await tester.tapAt(Offset.zero);
    await tester.pumpAndSettle();
  }

  bool isChecked(WidgetTester tester, String choice) => find
      .descendant(
        of: find.widgetWithText(MenuItemButton, choice),
        matching: find.byIcon(Icons.check_box),
      )
      .evaluate()
      .isNotEmpty;

  testWidgets('shows the labels the item will have, with what changes '
      'marked', (tester) async {
    await pumpEditor(tester);

    // `type: bug` stays, `area: docs` is added, and apply removes
    // `status: needs-triage` whatever the triager does.
    expect(find.byTooltip('Remove type: bug'), findsOneWidget);
    expect(find.byTooltip('Apply adds area: docs'), findsOneWidget);
    expect(find.byTooltip('Apply removes $needsTriageLabel'), findsOneWidget);
    expect(find.byTooltip('Keep $needsTriageLabel'), findsNothing);

    // Removing a label strikes it through; clicking it keeps it again.
    await tap(tester, find.byTooltip('Remove type: bug'));
    expect(draft().removedLabels, ['type: bug']);
    expect(find.byTooltip('Remove type: bug'), findsNothing);
    final Text struck = tester.widget(
      find.descendant(
        of: find.byTooltip('Keep type: bug'),
        matching: find.text('type: bug'),
      ),
    );
    expect(struck.style!.decoration, TextDecoration.lineThrough);
    await tap(tester, find.byTooltip('Keep type: bug'));
    expect(draft().removedLabels, isEmpty);
    expect(find.byTooltip('Remove type: bug'), findsOneWidget);

    // Removing an added label drops it.
    await tap(tester, find.byTooltip('Remove area: docs'));
    expect(draft().addedLabels, isEmpty);
    expect(find.byTooltip('Apply adds area: docs'), findsNothing);
  });

  testWidgets('opens the dropdown from anywhere in the field, with the '
      'labels the item will have checked', (tester) async {
    await pumpEditor(tester);

    final Rect field = tester.getRect(
      find.widgetWithText(InputDecorator, 'Labels'),
    );
    await tester.ensureVisible(find.widgetWithText(InputDecorator, 'Labels'));
    await tester.pumpAndSettle();
    await tester.tapAt(
      tester
          .getRect(find.widgetWithText(InputDecorator, 'Labels'))
          .centerLeft
          .translate(field.width * 0.75, 0),
    );
    await tester.pumpAndSettle();

    expect(isChecked(tester, 'type: bug'), isTrue);
    expect(isChecked(tester, 'area: docs'), isTrue);
    expect(isChecked(tester, needsTeamInputLabel), isFalse);
    // The priorities have a field of their own, and
    // `status: needs-triage` cannot be kept.
    expect(find.widgetWithText(MenuItemButton, 'P1'), findsNothing);
    expect(find.widgetWithText(MenuItemButton, needsTriageLabel), findsNothing);

    await tester.tap(find.widgetWithText(MenuItemButton, 'type: bug'));
    await tester.tap(find.widgetWithText(MenuItemButton, needsTeamInputLabel));
    await tester.pumpAndSettle();
    expect(draft().removedLabels, ['type: bug']);
    expect(draft().addedLabels, ['area: docs', needsTeamInputLabel]);
    await closeMenu(tester);
    expect(find.byTooltip('Keep type: bug'), findsOneWidget);
    expect(find.byTooltip('Apply adds $needsTeamInputLabel'), findsOneWidget);
  });

  testWidgets('assigns and unassigns in one field', (tester) async {
    await pumpEditor(tester);

    await tap(tester, find.byTooltip('Choose assignees'));
    expect(isChecked(tester, 'hubot'), isTrue);
    await tester.tap(find.widgetWithText(MenuItemButton, 'octocat'));
    await tester.pumpAndSettle();
    await closeMenu(tester);
    await tap(tester, find.byTooltip('Remove hubot'));

    expect(draft().newAssignees, ['octocat']);
    expect(draft().removedAssignees, ['hubot']);
    expect(find.byTooltip('Apply adds octocat'), findsOneWidget);
    expect(find.byTooltip('Keep hubot'), findsOneWidget);
  });

  testWidgets('replaces the milestone, and keeps it when its chip is '
      'clicked', (tester) async {
    await pumpEditor(tester);

    await tap(tester, find.byTooltip('Choose the milestone'));
    expect(isChecked(tester, 'November launch'), isTrue);
    await tester.tap(find.widgetWithText(MenuItemButton, 'December launch'));
    await tester.pumpAndSettle();
    // At most one is checked.
    expect(isChecked(tester, 'November launch'), isFalse);
    await closeMenu(tester);
    expect(draft().milestoneChange.set, 'December launch');
    expect(find.byTooltip('Apply adds December launch'), findsOneWidget);
    expect(find.byTooltip('Keep November launch'), findsOneWidget);

    await tap(tester, find.byTooltip('Keep November launch'));
    expect(draft().milestoneChange.isEmpty, isTrue);
    expect(find.byTooltip('Apply adds December launch'), findsNothing);

    await tap(tester, find.byTooltip('Remove November launch'));
    expect(draft().milestoneChange.remove, 'November launch');
    expect(draft().milestoneChange.set, isNull);
  });

  testWidgets('previews the reply as Markdown, and says what it is posted '
      'under', (tester) async {
    await pumpEditor(tester);
    final Finder reply = find.widgetWithText(TextField, 'Reply');

    await tester.enterText(reply, 'See **this** first.');
    await tester.pumpAndSettle();
    expect(
      find.text('Apply posts the reply under "From triage:"'),
      findsOneWidget,
    );

    await tap(tester, find.text('Preview'));
    expect(reply, findsNothing);
    expect(find.text('See this first.', findRichText: true), findsOneWidget);

    await tap(tester, find.text('Write'));
    expect(
      tester.widget<TextField>(reply).controller!.text,
      'See **this** '
      'first.',
    );

    // A reply for the team is posted under the note for the team.
    draft().addedLabels = [needsTeamInputLabel];
    await tester.pumpAndSettle();
    expect(
      find.text('Apply posts the reply under "$teamNoteTitle"'),
      findsOneWidget,
    );
  });

  testWidgets('cannot be edited while the item applies', (tester) async {
    await pumpEditor(tester);
    final Completer<void> hold = github.hold = Completer<void>();
    final Future<void> applied = controller.apply(item());
    await tester.pump();
    expect(controller.isApplying(a2ui(10)), isTrue);

    expect(
      tester.widget<TextField>(find.widgetWithText(TextField, 'Reply')).enabled,
      isFalse,
    );
    for (final SegmentedButton<String> button in tester.widgetList(
      find.byWidgetPredicate((w) => w is SegmentedButton<String>),
    )) {
      expect(button.onSelectionChanged, isNull);
    }
    for (final tooltip in [
      'Choose labels',
      'Choose assignees',
      'Choose the milestone',
    ]) {
      final IconButton button = tester.widget(
        find.ancestor(
          of: find.byTooltip(tooltip),
          matching: find.byType(IconButton),
        ),
      );
      expect(button.onPressed, isNull, reason: tooltip);
    }
    expect(find.byTooltip('Remove type: bug'), findsNothing);
    expect(find.byTooltip('Remove hubot'), findsNothing);

    hold.complete();
    github.hold = null;
    for (var i = 0; i < 100 && controller.isApplying(a2ui(10)); i++) {
      await tester.pump(const Duration(milliseconds: 10));
    }
    await applied;
    await tester.pumpAndSettle();
  });
}
