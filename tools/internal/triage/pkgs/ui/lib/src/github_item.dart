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

import 'model/triage_item.dart';

/// An issue or a pull request in [a2uiRepository] or [genuiRepository].
final class GitHubItem {
  const GitHubItem._(
    this.url, {
    required this.repository,
    required this.isPullRequest,
    required this.number,
  });

  static final RegExp _url = RegExp(
    r'^https://github\.com/(a2ui-project/a2ui|flutter/genui)/(issues|pull)/'
    r'([0-9]+)$',
  );

  /// Parses the URL of an issue or a pull request, such as
  /// `https://github.com/a2ui-project/a2ui/issues/123` or
  /// `https://github.com/flutter/genui/pull/45`.
  ///
  /// Returns null if [url] is not the URL of an issue or a pull request in
  /// [a2uiRepository] or [genuiRepository].
  static GitHubItem? tryParse(String url) {
    final RegExpMatch? match = _url.firstMatch(url);
    if (match == null) return null;
    final int? number = int.tryParse(match.group(3)!);
    if (number == null || number < 1) return null;
    return GitHubItem._(
      url,
      repository: match.group(1)!,
      isPullRequest: match.group(2) == 'pull',
      number: number,
    );
  }

  final String url;

  /// The repository, such as `a2ui-project/a2ui`.
  final String repository;
  final bool isPullRequest;
  final int number;

  ItemRef get ref => (repository: repository, number: number);
}
