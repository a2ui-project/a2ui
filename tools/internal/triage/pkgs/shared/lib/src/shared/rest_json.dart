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

/// Reads the GitHub REST API's JSON about issues and pull requests.
library;

import 'item.dart';

/// An entry in an item's history, as
/// `GET /repos/{owner}/{repo}/issues/{number}/events` returns it.
final class IssueEvent {
  const IssueEvent({required this.event, this.label, required this.createdAt});

  factory IssueEvent.fromJson(Map<String, Object?> json) => IssueEvent(
    event: json['event']! as String,
    label: switch (json['label']) {
      {'name': final String name} => name,
      _ => null,
    },
    createdAt: DateTime.parse(json['created_at']! as String),
  );

  /// What happened, such as `labeled`.
  final String event;

  /// The name of the label that a `labeled` event added.
  final String? label;

  final DateTime createdAt;
}

/// Reads an issue or a pull request, as `GET /repos/{owner}/{repo}/issues`
/// and `GET /repos/{owner}/{repo}/issues/{number}` return it.
Item itemFromJson(Map<String, Object?> json) => Item(
  number: json['number']! as int,
  state: json['state'] as String? ?? 'open',
  htmlUrl: json['html_url'] as String?,
  title: json['title'] as String? ?? '',
  createdAt: DateTime.parse(json['created_at']! as String),
  authorAssociation: json['author_association']! as String,
  user: _userOf(json['user']),
  labels: [
    for (final Object? label in json['labels'] as List<Object?>? ?? [])
      switch (label) {
        final String name => name,
        {'name': final String name} => name,
        _ => throw FormatException('Not a label: $label'),
      },
  ],
  assignees: [
    for (final Object? assignee in json['assignees'] as List<Object?>? ?? [])
      (assignee! as Map<String, Object?>)['login']! as String,
  ],
  hasMilestone: json['milestone'] != null,
  isPullRequest: json['pull_request'] != null,
  isDraft: json['draft'] == true,
  commentCount: json['comments'] as int? ?? 0,
);

/// Reads a comment, a review or a review comment as the API returns it, or
/// returns null for a review that is not submitted yet. Reviews have
/// `submitted_at` instead of `created_at`.
Contribution? contributionFromJson(Map<String, Object?> json) {
  final Object? time = json['created_at'] ?? json['submitted_at'];
  if (time == null) return null;
  return Contribution(
    createdAt: DateTime.parse(time as String),
    association: json['author_association']! as String,
    user: _userOf(json['user']),
    body: json['body'] as String?,
  );
}

/// Reads an account, or returns null for a deleted one.
User? _userOf(Object? json) => switch (json) {
  final Map<String, Object?> user => User(
    login: user['login'] as String?,
    type: user['type'] as String?,
  ),
  _ => null,
};
