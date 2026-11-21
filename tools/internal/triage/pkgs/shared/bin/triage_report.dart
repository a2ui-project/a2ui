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

// Writes the triage report: what a person triaged in a2ui-project/a2ui in a
// period, and the open items assigned for triage, by assignee, collected from
// GitHub, for the team chat space and the triage log. The triage bot runs it.
//
// Usage, from the repository root:
//
//   dart run tools/internal/triage/pkgs/shared/bin/triage_report.dart report \
//     --since <date> [--until <date>] [--login <login>] --out <dir> [--copy]
//   dart run tools/internal/triage/pkgs/shared/bin/triage_report.dart \
//     unsubscribe <dir>/items.json
//   dart run tools/internal/triage/pkgs/shared/bin/triage_report.dart \
//     paste <dir> --to chat|log
//
// `report` prints the report as plain text, and writes to <dir>:
//
//   report.txt: the report as plain text.
//   report.html: the report as HTML, where "triage bot" in the last line links
//     to the triage bot skill.
//   report.chat.txt: the report as the text of a Google Chat message, where
//     "triage bot" in the last line links to the skill.
//   report.log.html: report.html followed by a horizontal line, for the top of
//     the triage log.
//   items.json: the items in the report, with the node IDs that `unsubscribe`
//     takes.
//
// With --copy, it also puts the report on the macOS clipboard, as HTML for
// apps that paste rich text, such as the team chat, and as plain text for the
// rest.
//
// A date is YYYY-MM-DD in the local time zone, or an ISO 8601 time. The period
// includes the whole --until day, which defaults to now. The login defaults to
// the account of the GitHub token: GITHUB_TOKEN or GH_TOKEN, or else the
// account `gh` is logged in to.
//
// `unsubscribe` unsubscribes that account from the notifications of the items
// in items.json, as the Unsubscribe button on an item does.
//
// `paste` is for an agent without a Google Chat or Google Docs tool. It puts
// the report on the macOS clipboard in the form for the destination, and opens
// the destination in the browser for the person to paste it:
//
//   chat: report.html, for the go/a2ui-core-working-group chat space.
//   log: report.log.html, for the go/a2ui-triage-log doc.

import 'dart:io';

import 'package:shared/src/triage_bot/report_command.dart';

Future<void> main(List<String> args) async {
  exitCode = await runTriageReport(args);
}
