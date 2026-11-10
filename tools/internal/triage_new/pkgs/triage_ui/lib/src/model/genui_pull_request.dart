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

import '../github/json.dart';

/// An open pull request in `flutter/genui` that needs triage.
///
/// The triage UI shows what it is, with a link to it on GitHub, but does not
/// triage it. See `ui.blueprint.md`.
final class GenuiPullRequest {
  const GenuiPullRequest({
    required this.number,
    required this.title,
    required this.url,
    required this.createdAt,
    required this.updatedAt,
    this.author,
    this.labels = const [],
    this.labelColors = const {},
    this.assignees = const [],
  });

  /// Reads a node of `genuiPullRequestsQuery`.
  factory GenuiPullRequest.fromGraphQL(Map<String, Object?> node) {
    final List<Map<String, Object?>> labels = nodesOf(node['labels']);
    return GenuiPullRequest(
      number: node['number']! as int,
      title: node['title']! as String,
      url: node['url']! as String,
      createdAt: dateOf(node['createdAt'])!,
      updatedAt: dateOf(node['updatedAt'])!,
      author: loginOf(node['author']),
      labels: [for (final label in labels) label['name']! as String],
      labelColors: {
        for (final label in labels)
          if (label['color'] case final String color)
            label['name']! as String: color,
      },
      assignees: [
        for (final Map<String, Object?> user in nodesOf(node['assignees']))
          user['login']! as String,
      ],
    );
  }

  final int number;
  final String title;
  final String url;
  final DateTime createdAt;
  final DateTime updatedAt;

  /// The login of the author, or null for a deleted account.
  final String? author;

  final List<String> labels;

  /// The color of each label in [labels], as GitHub gives it: six hex
  /// digits, such as `d73a4a`.
  final Map<String, String> labelColors;

  final List<String> assignees;
}
