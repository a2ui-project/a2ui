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

/// The parts of the GitHub REST API's JSON that the flagger reads.
library;

/// A GitHub account, or null for a deleted one.
final class User {
  const User({this.login, this.type});

  factory User.fromJson(Map<String, Object?> json) =>
      User(login: json['login'] as String?, type: json['type'] as String?);

  final String? login;

  /// `User` or `Bot`.
  final String? type;
}

/// An issue or a pull request, as `GET /repos/{owner}/{repo}/issues` and
/// `GET /repos/{owner}/{repo}/issues/{number}` return it.
final class Item {
  const Item({
    required this.number,
    this.state = 'open',
    this.htmlUrl,
    this.title = '',
    required this.createdAt,
    required this.authorAssociation,
    this.user,
    this.labels = const [],
    this.assignees = const [],
    this.hasMilestone = false,
    this.isPullRequest = false,
    this.isDraft = false,
    this.commentCount = 0,
  });

  factory Item.fromJson(Map<String, Object?> json) => Item(
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

  final int number;

  /// `open` or `closed`.
  final String state;

  final String? htmlUrl;

  final String title;

  final DateTime createdAt;

  /// The author's association with the repository, such as `MEMBER`.
  final String authorAssociation;

  /// The author, or null for a deleted account.
  final User? user;

  final List<String> labels;

  /// The logins of the assignees.
  final List<String> assignees;

  int get assigneeCount => assignees.length;

  final bool hasMilestone;

  final bool isPullRequest;

  /// Whether the item is a draft pull request.
  final bool isDraft;

  /// The number of top-level comments.
  final int commentCount;

  /// The item with [labels] instead of its own.
  Item withLabels(List<String> labels) => Item(
    number: number,
    state: state,
    htmlUrl: htmlUrl,
    title: title,
    createdAt: createdAt,
    authorAssociation: authorAssociation,
    user: user,
    labels: labels,
    assignees: assignees,
    hasMilestone: hasMilestone,
    isPullRequest: isPullRequest,
    isDraft: isDraft,
    commentCount: commentCount,
  );
}

/// An issue comment, a pull request review or a review comment.
final class Contribution {
  const Contribution({
    required this.createdAt,
    required this.association,
    this.user,
    this.body,
  });

  /// Reads a contribution as the API returns it, or returns null for a
  /// review that is not submitted yet. Reviews have `submitted_at` instead
  /// of `created_at`.
  static Contribution? fromJson(Map<String, Object?> json) {
    final Object? time = json['created_at'] ?? json['submitted_at'];
    if (time == null) return null;
    return Contribution(
      createdAt: DateTime.parse(time as String),
      association: json['author_association']! as String,
      user: _userOf(json['user']),
      body: json['body'] as String?,
    );
  }

  final DateTime createdAt;

  /// The author's association with the repository, such as `MEMBER`.
  final String association;

  /// The author, or null for a deleted account.
  final User? user;

  /// The text, or null for a review submitted without a summary.
  final String? body;
}

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

/// A comment that was just posted, as
/// `POST /repos/{owner}/{repo}/issues/{number}/comments` returns it.
final class PostedComment {
  const PostedComment({
    required this.id,
    required this.association,
    this.htmlUrl,
  });

  factory PostedComment.fromJson(Map<String, Object?> json) => PostedComment(
    id: json['id']! as int,
    association: json['author_association']! as String,
    htmlUrl: json['html_url'] as String?,
  );

  final int id;

  /// The poster's association with the repository, such as `MEMBER`.
  final String association;

  final String? htmlUrl;
}

User? _userOf(Object? json) =>
    json == null ? null : User.fromJson(json as Map<String, Object?>);

/// Whether [user] is a bot: its account type is `Bot`, or its login ends with
/// `[bot]`.
///
/// A deleted account, whose [user] is null, counts as a human, so that its
/// past contributions still count.
bool isBot(User? user) =>
    user != null &&
    (user.type == 'Bot' || (user.login ?? '').endsWith('[bot]'));
