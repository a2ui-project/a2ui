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
//   dart run tools/internal/triage/pkgs/pinger/bin/staleness_ping.dart [--dry-run]
//
// The triage bot runs it hourly. With `--dry-run`, it prints the comments
// instead of posting them, and sends no Google Chat messages.
//
// It reads the repository from `GITHUB_REPOSITORY`, which defaults to
// a2ui-project/a2ui, and the token from `GITHUB_TOKEN`, `GH_TOKEN` or
// `gh auth token`. The token must be a team member's. It sends the Google
// Chat messages to the incoming webhook in `TRIAGE_CHAT_WEBHOOK_URL`, and
// reads the Google Chat user IDs of the assignees from `TRIAGE_CHAT_USERS`,
// a JSON object that maps GitHub logins to user IDs.
//
// It exits with 1 if a ping or a message fails, and with 2 for wrong
// arguments or settings.

import 'dart:io';

import 'package:pinger/pinger.dart';
import 'package:shared/shared.dart';

const String _usage =
    'Usage: dart run tools/internal/triage/pkgs/pinger/bin/staleness_ping.dart '
    '[--dry-run]';

Future<void> main(List<String> args) async {
  if (args.any((arg) => arg != '--dry-run')) {
    stderr.writeln(_usage);
    exitCode = 2;
    return;
  }
  final bool dryRun = args.contains('--dry-run');
  final Map<String, String> env = Platform.environment;

  final Map<String, String> chatUsers;
  try {
    chatUsers = parseChatUsers(env['TRIAGE_CHAT_USERS']);
  } on FormatException catch (e) {
    stderr.writeln('TRIAGE_CHAT_USERS: ${e.message}');
    exitCode = 2;
    return;
  }

  final String webhook = env['TRIAGE_CHAT_WEBHOOK_URL']?.trim() ?? '';
  final WebhookTeamChat? chat = webhook.isEmpty || dryRun
      ? null
      : WebhookTeamChat(Uri.parse(webhook));
  if (webhook.isEmpty && !dryRun) {
    stdout.writeln(
      'TRIAGE_CHAT_WEBHOOK_URL is not set, so no Google Chat messages are '
      'sent.',
    );
  }

  final String repository = env['GITHUB_REPOSITORY'] ?? a2uiRepository;
  final client = GitHubClient(token: await findGitHubToken());
  try {
    final PingRun run = await pingStaleItems(
      RestPingerGitHub(client, repository),
      now: DateTime.now().toUtc(),
      log: stdout,
      errorLog: stderr,
      chat: chat,
      chatUsers: chatUsers,
      dryRun: dryRun,
    );
    if (run.failed > 0) exitCode = 1;
  } finally {
    client.close();
    chat?.close();
  }
}
