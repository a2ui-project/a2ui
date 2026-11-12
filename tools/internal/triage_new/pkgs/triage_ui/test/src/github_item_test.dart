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
import 'package:triage_ui/src/github_item.dart';

void main() {
  test('parses an issue URL', () {
    final GitHubItem item = GitHubItem.tryParse(
      'https://github.com/a2ui-project/a2ui/issues/1235',
    )!;

    expect(item.repository, 'a2ui-project/a2ui');
    expect(item.isPullRequest, isFalse);
    expect(item.number, 1235);
  });

  test('parses a pull request URL', () {
    final GitHubItem item = GitHubItem.tryParse(
      'https://github.com/a2ui-project/a2ui/pull/4026',
    )!;

    expect(item.isPullRequest, isTrue);
    expect(item.number, 4026);
  });

  test('parses a pull request URL on genui', () {
    final GitHubItem item = GitHubItem.tryParse(
      'https://github.com/flutter/genui/pull/45',
    )!;

    expect(item.repository, 'flutter/genui');
    expect(item.isPullRequest, isTrue);
    expect(item.number, 45);
  });

  test('rejects URLs that are not issues or pull requests on a2ui or '
      'genui', () {
    for (final url in [
      '',
      '1235',
      'https://github.com/flutter/flutter/issues/1',
      'https://github.com/a2ui-project/a2ui/issues/0',
      'https://github.com/a2ui-project/a2ui/issues/12x',
      'https://github.com/a2ui-project/a2ui/issues/1/comments',
      'https://github.com/a2ui-project/a2ui/discussions/1',
      'http://github.com/a2ui-project/a2ui/issues/1',
      'https://github.com/a2ui-project/a2ui/issues/99999999999999999999',
    ]) {
      expect(GitHubItem.tryParse(url), isNull, reason: url);
    }
  });
}
