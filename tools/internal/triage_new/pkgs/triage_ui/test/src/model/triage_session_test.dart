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
  TriageItem item(int number) =>
      TriageItem.fromGraphQL(itemNode(number, title: 'Item $number'));

  test('tells the items sent to the team from the triaged ones', () {
    final session = TriageSession()
      ..recordApplied(item(1), const TriageSuggestion(addedLabels: ['P2']))
      ..recordApplied(
        item(2),
        const TriageSuggestion(addedLabels: [needsTeamInputLabel]),
      );

    expect(session.isApplied(a2ui(1)), isTrue);
    expect(session.isSentToTeam(a2ui(1)), isFalse);
    expect(session.isHandled(a2ui(1)), isTrue);
    expect(session.isApplied(a2ui(2)), isFalse);
    expect(session.isSentToTeam(a2ui(2)), isTrue);
    expect(session.isHandled(a2ui(2)), isTrue);
    expect(session.isHandled(a2ui(3)), isFalse);
  });

  test('a later apply to the same item replaces the earlier one', () {
    final session = TriageSession()
      ..recordApplied(
        item(1),
        const TriageSuggestion(addedLabels: [needsTeamInputLabel]),
      )
      ..recordApplied(item(1), const TriageSuggestion(addedLabels: ['P2']));

    expect(session.isApplied(a2ui(1)), isTrue);
    expect(session.isSentToTeam(a2ui(1)), isFalse);
  });
}
