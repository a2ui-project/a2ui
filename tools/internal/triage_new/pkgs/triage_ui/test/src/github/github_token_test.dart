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

import 'package:flutter_test/flutter_test.dart';
import 'package:triage_ui/src/github/github_client.dart';
import 'package:triage_ui/src/github/github_token.dart';

void main() {
  test('prefers GITHUB_TOKEN', () async {
    expect(
      await findGitHubToken(
        environment: {'GITHUB_TOKEN': ' env-token\n'},
        run: (_, _) => throw StateError('gh must not run'),
      ),
      'env-token',
    );
  });

  test('falls back to gh, wherever it is installed', () async {
    final tried = <String>[];
    final String token = await findGitHubToken(
      environment: const {},
      run: (String command, List<String> args) async {
        tried.add(command);
        if (command == 'gh') throw const ProcessException('gh', []);
        return ProcessResult(0, 0, 'gh-token\n', '');
      },
    );

    expect(token, 'gh-token');
    expect(tried, ['gh', '/opt/homebrew/bin/gh']);
  });

  test('says what to do when there is no token', () async {
    expect(
      findGitHubToken(
        environment: const {},
        run: (_, _) async => ProcessResult(0, 1, '', 'not logged in'),
      ),
      throwsA(
        isA<GitHubException>().having(
          (e) => e.message,
          'message',
          contains('gh auth login'),
        ),
      ),
    );
  });
}
