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

import 'package:triage/triage.dart';

import '../github/json.dart';

/// The label that the flagger adds to the items that need triage.
const String needsTriageLabel = 'status: needs-triage';

/// The label that the triager adds to the items that the team should
/// discuss. See `docs/contributing/triage/triage.md`.
const String needsTeamInputLabel = 'status: needs-team-input';

/// The types of items, in the order the list shows them. See
/// `ui.blueprint.md`.
enum ItemKind {
  issue,

  /// A pull request that closes issues.
  prWithIssues,

  /// A pull request that closes no issue.
  prWithoutIssues,
}

/// Whether an item has a triage suggestion, and whether it is current. See
/// `blueprints/features/triage_item.blueprint.md`.
enum SuggestionStatus {
  /// No triage bot comment on the item has an `<a2ui>` block.
  none,

  /// The suggestion comment does not hold a valid suggestion.
  invalid,

  /// Nothing happened on the item after the suggestion comment was last
  /// edited.
  current,

  /// Something happened on the item after the suggestion comment was last
  /// edited.
  outdated,
}

/// An issue or a pull request, as the triage UI shows it.
final class TriageItem {
  const TriageItem({
    required this.id,
    required this.number,
    required this.title,
    required this.url,
    required this.isPullRequest,
    required this.isOpen,
    required this.createdAt,
    required this.updatedAt,
    this.author,
    this.labels = const [],
    this.assignees = const [],
    this.linkedItems = const [],
    this.suggestionStatus = SuggestionStatus.none,
    this.suggestion,
    this.suggestionError,
    this.suggestionUrl,
  });

  /// Reads an `IssueFields` or `PullRequestFields` node of the triage UI's
  /// GraphQL queries.
  factory TriageItem.fromGraphQL(Map<String, Object?> node) {
    final isPullRequest = node['__typename'] == 'PullRequest';
    final List<Map<String, Object?>> comments = nodesOf(node['comments']);

    Map<String, Object?>? suggestionComment;
    for (final Map<String, Object?> comment in comments.reversed) {
      if (_isTriageBotComment(comment) &&
          hasA2uiBlock(comment['body']! as String)) {
        suggestionComment = comment;
        break;
      }
    }

    SuggestionStatus status = SuggestionStatus.none;
    SuggestionPayload? suggestion;
    String? suggestionError;
    if (suggestionComment != null) {
      try {
        suggestion = SuggestionPayload.parse(
          suggestionComment['body']! as String,
        );
        final DateTime suggestedAt =
            dateOf(suggestionComment['lastEditedAt']) ??
            dateOf(suggestionComment['createdAt'])!;
        status = _activity(node, comments).any(suggestedAt.isBefore)
            ? SuggestionStatus.outdated
            : SuggestionStatus.current;
      } on FormatException catch (e) {
        status = SuggestionStatus.invalid;
        suggestionError = e.message;
      }
    }

    return TriageItem(
      id: node['id']! as String,
      number: node['number']! as int,
      title: node['title']! as String,
      url: node['url']! as String,
      isPullRequest: isPullRequest,
      isOpen: node['state'] == 'OPEN',
      createdAt: dateOf(node['createdAt'])!,
      updatedAt: dateOf(node['updatedAt'])!,
      author: loginOf(node['author']),
      labels: [
        for (final Map<String, Object?> label in nodesOf(node['labels']))
          label['name']! as String,
      ],
      assignees: [
        for (final Map<String, Object?> user in nodesOf(node['assignees']))
          user['login']! as String,
      ],
      linkedItems: [
        for (final Map<String, Object?> linked in nodesOf(
          node[isPullRequest
              ? 'closingIssuesReferences'
              : 'closedByPullRequestsReferences'],
        ))
          linked['number']! as int,
      ],
      suggestionStatus: status,
      suggestion: suggestion,
      suggestionError: suggestionError,
      suggestionUrl: suggestionComment?['url'] as String?,
    );
  }

  /// The GraphQL node id.
  final String id;
  final int number;
  final String title;
  final String url;
  final bool isPullRequest;
  final bool isOpen;
  final DateTime createdAt;

  /// When anything about the item last changed on GitHub.
  final DateTime updatedAt;

  /// The login of the item's author, or null for a deleted account.
  final String? author;
  final List<String> labels;
  final List<String> assignees;

  /// For an issue, the open pull requests that close it. For a pull request,
  /// the issues it closes.
  final List<int> linkedItems;

  final SuggestionStatus suggestionStatus;

  /// The suggestion, unless [suggestionStatus] is [SuggestionStatus.none] or
  /// [SuggestionStatus.invalid].
  final SuggestionPayload? suggestion;

  /// What is wrong with the suggestion comment, when [suggestionStatus] is
  /// [SuggestionStatus.invalid].
  final String? suggestionError;

  /// The URL of the suggestion comment, if the item has one.
  final String? suggestionUrl;

  bool get needsTriage => labels.contains(needsTriageLabel);

  bool get needsTeamInput => labels.contains(needsTeamInputLabel);

  ItemKind get kind => !isPullRequest
      ? ItemKind.issue
      : linkedItems.isEmpty
      ? ItemKind.prWithoutIssues
      : ItemKind.prWithIssues;

  /// "Issue #12" or "PR #12".
  String get name => '${isPullRequest ? 'PR' : 'Issue'} #$number';

  /// A comment is a triage bot comment if it starts with the triage bot
  /// prefix and a team member or a bot posted it. See `core.blueprint.md`.
  static bool _isTriageBotComment(Map<String, Object?> comment) {
    if (!hasTriageBotPrefix(comment['body']! as String)) return false;
    final Object? author = comment['author'];
    return const {
          'OWNER',
          'MEMBER',
          'COLLABORATOR',
        }.contains(comment['authorAssociation']) ||
        (author != null && asMap(author)['__typename'] == 'Bot');
  }

  /// The times of the things that happened on the item, as
  /// `triage_item.blueprint.md` lists them.
  static Iterable<DateTime> _activity(
    Map<String, Object?> node,
    List<Map<String, Object?>> comments,
  ) sync* {
    for (final comment in comments) {
      if (!_isTriageBotComment(comment)) yield dateOf(comment['createdAt'])!;
    }
    if (node['reviews'] != null) {
      for (final Map<String, Object?> review in nodesOf(node['reviews'])) {
        if (dateOf(review['submittedAt']) case final DateTime submitted) {
          yield submitted;
        }
      }
    }
    if (dateOf(node['lastEditedAt']) case final DateTime edited) yield edited;
    for (final Map<String, Object?> event in nodesOf(node['timelineItems'])) {
      switch (event) {
        case {'__typename': 'PullRequestCommit', 'commit': final Object? c}:
          yield dateOf(asMap(c)['committedDate'])!;
        case {'label': {'name': needsTriageLabel}}:
          // The flagger manages the label, so its changes say nothing new.
          break;
        case {'createdAt': final String createdAt}:
          yield DateTime.parse(createdAt);
      }
    }
  }
}
