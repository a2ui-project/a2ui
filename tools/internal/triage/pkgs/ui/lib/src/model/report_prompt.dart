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

/// The prompt that asks an agent for the triage report. See "Create a
/// report" in `ui.blueprint.md`.
library;

import 'triage_session.dart';

/// The period of the triage report of [session], as dates: from the day
/// the session started to the day of [now], in the local time zone.
({String since, String until}) reportPeriod(
  TriageSession session,
  DateTime now,
) => (since: isoDate(session.started), until: isoDate(now));

/// The prompt that asks an agent to create the triage report of
/// [reportPeriod] with the a2ui-triage-bot skill from `main`.
String reportPrompt(TriageSession session, DateTime now) {
  final (:String since, :String until) = reportPeriod(session, now);
  return 'Create the triage report for $since to $until.\n'
      '\n'
      'Use the a2ui-triage-bot skill from the main branch of '
      'a2ui-project/a2ui: $_skillUrl.\n';
}

/// The date of [time] as "2026-11-12".
String isoDate(DateTime time) => [
  time.year.toString().padLeft(4, '0'),
  time.month.toString().padLeft(2, '0'),
  time.day.toString().padLeft(2, '0'),
].join('-');

const _skillUrl =
    'https://github.com/a2ui-project/a2ui/tree/main/.agents/skills/a2ui-triage-bot';
