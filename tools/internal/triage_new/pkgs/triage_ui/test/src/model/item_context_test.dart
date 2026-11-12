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
import 'package:triage_ui/src/model/item_context.dart';
import 'package:triage_ui/src/model/triage_controller.dart';
import 'package:triage_ui/src/model/triage_item.dart';

import '../../support/fake_github.dart';

void main() {
  late FakeGitHub github;
  late TriageController controller;

  setUp(() {
    github = FakeGitHub([
      itemNode(
        10,
        title: 'Crash on an empty Row',
        body: 'Steps:\r\n\r\n1. Render an empty Row.',
        createdAt: day(1),
        updatedAt: day(4),
        linked: [20],
        comments: [
          commentNode(
            suggestionComment(
              'root = TriageSuggestion(summary="A crash.", '
              'reason="Priority is not set.", suggestion="Set P1.", '
              'reply="Thanks.", added_labels=["P1"], related_issues=[5])',
            ),
            at: day(2),
          ),
          commentNode(
            'It also crashes on a Column.',
            at: day(3),
            login: 'reporter',
            association: 'NONE',
          ),
        ],
      ),
      itemNode(
        20,
        pr: true,
        title: 'Fix the crash',
        createdAt: day(2),
        linked: [10],
      ),
    ]);
    controller = TriageController(connect: () async => github.service());
  });

  tearDown(() => controller.dispose());

  test('describes the item and its linked items, with the changes that '
      'Apply would make', () async {
    await controller.start();
    final TriageItem issue = controller.item(a2ui(10))!;
    controller.draftFor(issue).newAssignees = ['octocat'];

    expect(itemContext(controller, [issue, controller.item(a2ui(20))!]), '''
Context: I am triaging Issue #10 in a2ui-project/a2ui, with PR #20 linked to it. This is what the A2UI triage tool knows about them.

# Issue #10: Crash on an empty Row

- URL: https://github.com/a2ui-project/a2ui/issues/10
- State: open
- Author: @author10
- Created: 2026-11-01
- Updated: 2026-11-04
- Labels: status: needs-triage
- Assignees: none
- Milestone: none
- Fixed by open PRs: #20

## Description

Steps:

1. Render an empty Row.

## Comments

### @reporter, 2026-11-03, https://github.com/a2ui-project/a2ui/issues/1#issuecomment-1

It also crashes on a Column.

## Triage bot suggestion (outdated: the item changed after the triage bot commented)

- Comment: https://github.com/a2ui-project/a2ui/issues/1#issuecomment-1
- Summary: A crash.
- Why flagged for triage: Priority is not set.
- Suggestion: Set P1.
- Related issues: #5

## Changes that Apply would make, as I edited them

- Add labels: P1
- Remove labels: status: needs-triage
- Assign: octocat
- Post this reply:

Thanks.

# PR #20: Fix the crash

- URL: https://github.com/a2ui-project/a2ui/pull/20
- State: open
- Author: @author20
- Created: 2026-11-02
- Updated: 2026-11-02
- Labels: status: needs-triage
- Assignees: none
- Milestone: none
- Fixes issues: #10

## Description

No description.

## Comments

No comments.

## Triage bot suggestion

None.

## Changes that Apply would make

- Remove labels: status: needs-triage
''');
  });
}
