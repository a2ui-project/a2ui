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

import 'dart:io';

import 'github_client.dart';

/// Where the `gh` command may be, when it is not on the app's `PATH`, as
/// when VS Code was started from the Dock.
const List<String> _ghCommands = [
  'gh',
  '/opt/homebrew/bin/gh',
  '/usr/local/bin/gh',
];

/// Finds the triager's GitHub token: `GITHUB_TOKEN` or `GH_TOKEN` from the
/// environment, or else the token that `gh auth token` prints.
///
/// Throws a [GitHubException] that says what to do if there is none.
Future<String> findGitHubToken({
  Map<String, String>? environment,
  Future<ProcessResult> Function(String command, List<String> args) run =
      Process.run,
}) async {
  final Map<String, String> env = environment ?? Platform.environment;
  for (final name in ['GITHUB_TOKEN', 'GH_TOKEN']) {
    final String? token = env[name]?.trim();
    if (token != null && token.isNotEmpty) return token;
  }

  for (final String gh in _ghCommands) {
    final ProcessResult result;
    try {
      result = await run(gh, ['auth', 'token']);
    } on ProcessException {
      continue;
    }
    final String token = '${result.stdout}'.trim();
    if (result.exitCode == 0 && token.isNotEmpty) return token;
  }

  throw const GitHubException(
    'Cannot find a GitHub token. Run "gh auth login" in a terminal, or set '
    'GITHUB_TOKEN, and restart the triage UI.',
  );
}
