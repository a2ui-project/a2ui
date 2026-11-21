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

// Prints why the flagger flags each given issue or pull request, with the
// same rules and data that the flagger uses. The triage bot copies the
// reason into the `reason` property of its suggestion.
//
// Usage, from the repository root:
//
//   dart run tools/internal/triage/flagger/bin/flag_reason.dart <item>...
//
// An item is a number in a2ui-project/a2ui, or the URL of an issue or pull
// request. The output is a JSON array with one `{"url": ..., "reason": ...}`
// entry per item, where `reason` is null when the item should not be
// flagged. It reads GitHub with `GITHUB_TOKEN`, or else with the token of
// the account that `gh` is logged in to.

import 'dart:convert';
import 'dart:io';

import 'package:flagger/flagger.dart';
import 'package:shared/shared.dart';

const String _usage =
    'Usage: dart run tools/internal/triage/flagger/bin/flag_reason.dart '
    '<item>...';

Future<void> main(List<String> args) async {
  if (args.isEmpty) {
    stderr.writeln(_usage);
    exitCode = 2;
    return;
  }
  final List<ItemRef> refs;
  try {
    refs = args.map(parseItem).toList();
  } on FormatException catch (e) {
    stderr.writeln('${e.message}\n$_usage');
    exitCode = 2;
    return;
  }

  final client = GitHubClient(token: await findGitHubToken());
  final DateTime now = DateTime.now().toUtc();
  try {
    // The messages from reading the items go to stderr, so that stdout has
    // only the JSON.
    final List<ItemReason> reasons = await inBatches(
      refs,
      (ItemRef ref) => itemReason(
        RestFlaggerGitHub(client, ref.repository),
        ref.number,
        now,
        log: stderr,
        errorLog: stderr,
      ),
    );
    stdout.writeln(
      const JsonEncoder.withIndent('  ').convert([
        for (final ItemReason reason in reasons)
          {'url': reason.url, 'reason': reason.reason},
      ]),
    );
  } finally {
    client.close();
  }
}
