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

// Adds `status: needs-triage` to the open issues and pull requests that
// need triage, removes it from the rest, and removes
// `status: waiting-for-author-response` from the items that someone
// outside the team answered. See `blueprints/features/flagger.blueprint.md`.
//
// The `Flag/Unflag issues and PRs` workflow runs it, in
// `.github/workflows/triage.yml`. It reads the repository from
// `GITHUB_REPOSITORY`, which defaults to a2ui-project/a2ui, and the token
// from `GITHUB_TOKEN` or `gh auth token`.

import 'dart:io';

import 'package:flagger/flagger.dart';
import 'package:shared/shared.dart';

Future<void> main() async {
  final client = GitHubClient(token: await findGitHubToken());
  try {
    await reconcile(
      RestFlaggerGitHub(
        client,
        Platform.environment['GITHUB_REPOSITORY'] ?? a2uiRepository,
      ),
      now: DateTime.now().toUtc(),
      log: stdout,
      errorLog: stderr,
    );
  } finally {
    client.close();
  }
}
