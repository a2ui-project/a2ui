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
import 'package:triage_ui/src/model/triage_item.dart';
import 'package:triage_ui/src/model/triage_session.dart';

import '../../support/fake_github.dart';

void main() {
  TriageItem item(int number, String title, {bool pr = false}) =>
      TriageItem.fromGraphQL(itemNode(number, pr: pr, title: title));

  test('reports the applied items, grouped by what was done', () {
    final session = TriageSession()
      ..recordApplied(
        item(4065, 'Flutter renderer crashes on an empty Row', pr: true),
        const TriageSuggestion(closeAs: TriageCloseReason.completed),
      )
      ..recordApplied(
        item(4066, 'Support dark theme in the Lit renderer'),
        const TriageSuggestion(
          closeAs: TriageCloseReason.duplicate,
          duplicateOf: 1100,
          reply: 'Thanks!',
        ),
      )
      ..recordApplied(
        item(4067, 'Fix typo in the quickstart'),
        const TriageSuggestion(
          addedLabels: ['P3', 'type: bug', 'size: small'],
          newAssignees: ['octocat'],
        ),
      )
      ..recordApplied(
        item(4068, 'Add a Swift renderer'),
        const TriageSuggestion(
          addedLabels: ['status: assigned-for-triage'],
          newAssignees: ['hubot', 'octocat'],
          removedLabels: ['status: needs-team-input'],
        ),
      )
      ..recordApplied(
        item(4069, 'Question about catalogs'),
        const TriageSuggestion(removedAssignees: ['hubot']),
      );

    expect(session.report(stillNeedTriage: 4), '''
Triaged 5 items: 4 issues and 1 PR.
4 items still need triage.

- Closed: 1 issue and 1 PR
  - https://github.com/a2ui-project/a2ui/pull/4065
    Flutter renderer crashes on an empty Row: closed
  - https://github.com/a2ui-project/a2ui/issues/4066
    Support dark theme in the Lit renderer: closed as duplicate of #1100, replied

- Assigned P3: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4067
    Fix typo in the quickstart: added P3, type: bug and size: small, assigned octocat

- Assigned for triage: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4068
    Add a Swift renderer: added status: assigned-for-triage, removed status: needs-team-input, assigned hubot and octocat

- Updated: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4069
    Question about catalogs: unassigned hubot''');
  });

  test('reports an empty session', () {
    expect(
      TriageSession().report(stillNeedTriage: 1),
      'Nothing triaged yet.\n1 item still needs triage.',
    );
  });

  test('a later apply to the same item replaces the earlier one', () {
    final session = TriageSession()
      ..recordApplied(item(1, 'A'), const TriageSuggestion(addedLabels: ['P1']))
      ..recordApplied(
        item(1, 'A'),
        const TriageSuggestion(addedLabels: ['P2']),
      );

    expect(session.applied, hasLength(1));
    expect(session.report(stillNeedTriage: 0), contains('Assigned P2'));
  });

  test('needs a report until the report with every applied item is copied', () {
    final session = TriageSession();
    expect(session.needsReport, isFalse);

    session.recordApplied(item(1, 'A'), const TriageSuggestion(reply: 'Hi'));
    expect(session.needsReport, isTrue);

    session.recordCopied();
    expect(session.needsReport, isFalse);

    session.recordApplied(item(2, 'B'), const TriageSuggestion(reply: 'Hi'));
    expect(session.needsReport, isTrue);
  });
}
