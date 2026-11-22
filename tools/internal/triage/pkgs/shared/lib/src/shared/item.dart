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

/// What the flagger and the staleness pinger know about an issue or a pull
/// request. `RestItemReader` reads it from the GitHub REST API.
library;

/// A GitHub account, or null for a deleted one.
final class User {
  const User({this.login, this.type});

  final String? login;

  /// `User` or `Bot`.
  final String? type;
}

/// An issue or a pull request.
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

  final DateTime createdAt;

  /// The author's association with the repository, such as `MEMBER`.
  final String association;

  /// The author, or null for a deleted account.
  final User? user;

  /// The text, or null for a review submitted without a summary.
  final String? body;
}

/// Whether [user] is a bot: its account type is `Bot`, or its login ends with
/// `[bot]`.
///
/// A deleted account, whose [user] is null, counts as a human, so that its
/// past contributions still count.
bool isBot(User? user) =>
    user != null &&
    (user.type == 'Bot' || (user.login ?? '').endsWith('[bot]'));
