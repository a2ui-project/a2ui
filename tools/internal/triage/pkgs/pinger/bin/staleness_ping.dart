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

// Asks the assignees of stale issues and pull requests to act, before the
// flagger flags the items. See
// `blueprints/features/triage_bot/staleness_ping.blueprint.md`.
//
// Usage, from the repository root:
//
//   dart run tools/internal/triage/pkgs/pinger/bin/staleness_ping.dart \
//     [--dry-run] [--messages <file>]
//
// The triage bot runs it hourly. With `--dry-run`, it prints the comments
// and the direct messages instead of posting or writing them.
//
// It reads the repository from `GITHUB_REPOSITORY`, which defaults to
// a2ui-project/a2ui, and the token from `GITHUB_TOKEN`, `GH_TOKEN` or
// `gh auth token`. The token must be a team member's.
//
// With `--messages`, it writes a direct message to each assignee to
// <file>, as lines of JSON with the keys `login`, `to` and `text`, for the
// triage bot to send from the triager's Google account. It reads the
// assignees' Google accounts from `TRIAGE_CHAT_USERS`, a JSON object that
// maps GitHub logins to Google accounts.
//
// It exits with 1 if a ping or a message fails, and with 2 for wrong
// arguments or settings.

import 'dart:io';

import 'package:pinger/pinger.dart';
import 'package:shared/shared.dart';

const String _usage =
    'Usage: dart run tools/internal/triage/pkgs/pinger/bin/staleness_ping.dart '
    '[--dry-run] [--messages <file>]';

Future<void> main(List<String> args) async {
  var dryRun = false;
  String? messagesPath;
  for (var i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        dryRun = true;
      case '--messages' when i + 1 < args.length:
        messagesPath = args[++i];
      default:
        stderr.writeln(_usage);
        exitCode = 2;
        return;
    }
  }
  final Map<String, String> env = Platform.environment;

  final Map<String, String> chatUsers;
  try {
    chatUsers = parseChatUsers(env['TRIAGE_CHAT_USERS']);
  } on FormatException catch (e) {
    stderr.writeln('TRIAGE_CHAT_USERS: ${e.message}');
    exitCode = 2;
    return;
  }

  final JsonLinesOutbox? outbox = messagesPath == null || dryRun
      ? null
      : JsonLinesOutbox(File(messagesPath));
  if (!dryRun) {
    if (messagesPath == null) {
      stdout.writeln('No --messages file, so no direct messages are written.');
    } else if (chatUsers.isEmpty) {
      stdout.writeln(
        'TRIAGE_CHAT_USERS is not set, so no direct messages are written.',
      );
    }
  }

  final String repository = env['GITHUB_REPOSITORY'] ?? a2uiRepository;
  final client = GitHubClient(token: await findGitHubToken());
  try {
    final PingRun run = await pingStaleItems(
      RestPingerGitHub(client, repository),
      now: DateTime.now().toUtc(),
      log: stdout,
      errorLog: stderr,
      outbox: outbox,
      chatUsers: chatUsers,
      dryRun: dryRun,
    );
    if (run.failed > 0) exitCode = 1;
  } finally {
    client.close();
  }
}
