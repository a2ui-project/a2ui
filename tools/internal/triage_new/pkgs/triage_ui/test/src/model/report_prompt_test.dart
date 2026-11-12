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
import 'package:triage_ui/src/model/report_prompt.dart';
import 'package:triage_ui/src/model/triage_session.dart';

void main() {
  test('the period runs from the day the session started to today', () {
    final session = TriageSession(started: DateTime(2026, 11, 9, 18, 30));
    expect(reportPeriod(session, DateTime(2026, 11, 12, 9)), (
      since: '2026-11-09',
      until: '2026-11-12',
    ));
  });

  test('a session that started today reports today', () {
    final session = TriageSession(started: DateTime(2027, 1, 3, 8));
    expect(reportPeriod(session, DateTime(2027, 1, 3, 17)), (
      since: '2027-01-03',
      until: '2027-01-03',
    ));
  });

  test('the prompt names the period and the skill on main', () {
    final session = TriageSession(started: DateTime(2026, 11, 9, 10));
    expect(
      reportPrompt(session, DateTime(2026, 11, 12, 9)),
      'Create the triage report for 2026-11-09 to 2026-11-12.\n'
      '\n'
      'Use the a2ui-triage-bot skill from the main branch of '
      'a2ui-project/a2ui: '
      'https://github.com/a2ui-project/a2ui/tree/main/.agents/skills/'
      'a2ui-triage-bot.\n',
    );
  });
}
