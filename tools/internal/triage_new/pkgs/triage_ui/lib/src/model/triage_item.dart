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

/// The repository whose issues and pull requests the triage UI triages.
const String a2uiRepository = 'a2ui-project/a2ui';

/// The repository whose pull requests the triage UI triages together with
/// the items of [a2uiRepository]. See `ui.blueprint.md`.
const String genuiRepository = 'flutter/genui';

/// An issue or a pull request: its repository, such as
/// `a2ui-project/a2ui`, and its number there.
typedef ItemRef = ({String repository, int number});

/// The label that the flagger adds to the items that need triage.
const String needsTriageLabel = 'status: needs-triage';

/// The label that the triager adds to the items that the team should
/// discuss. See `docs/contributing/triage/triage.md`.
const String needsTeamInputLabel = 'status: needs-team-input';

/// The heading of the comment that the triager posts for the team with
/// **Needs team input**. The triage UI shows the latest such comment with
/// the item's suggestion. See `ui.blueprint.md`.
const String teamNoteHeading = '**From triager for team discussion:**\n\n';

/// The types of items, in the order the list shows them. See
/// `ui.blueprint.md`.
enum ItemKind {
  /// An issue that open pull requests are linked to close, whoever opened
  /// them.
  issueWithPrs,

  /// An issue that no open pull request is linked to close. Closed and
  /// merged pull requests do not count.
  issueWithoutPrs,

  /// A pull request that closes issues.
  prWithIssues,

  /// A pull request that closes no issue.
  prWithoutIssues,
}

/// Whether an item has a triage suggestion, and whether it is current. See
/// `blueprints/features/advisor.blueprint.md`.
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
    this.repository = a2uiRepository,
    required this.number,
    required this.title,
    required this.url,
    required this.isPullRequest,
    required this.isOpen,
    this.isMerged = false,
    required this.createdAt,
    required this.updatedAt,
    this.author,
    this.labels = const [],
    this.assignees = const [],
    this.milestone,
    this.linkedItems = const [],
    this.suggestionStatus = SuggestionStatus.none,
    this.suggestion,
    this.suggestionError,
    this.suggestionUrl,
    this.teamNote,
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

    TeamNote? teamNote;
    for (final Map<String, Object?> comment in comments.reversed) {
      if (TeamNote._tryParse(comment) case final TeamNote note) {
        teamNote = note;
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

    final url = node['url']! as String;
    return TriageItem(
      id: node['id']! as String,
      repository: Uri.parse(url).pathSegments.take(2).join('/'),
      number: node['number']! as int,
      title: node['title']! as String,
      url: url,
      isPullRequest: isPullRequest,
      isOpen: node['state'] == 'OPEN',
      isMerged: node['state'] == 'MERGED',
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
      milestone: switch (node['milestone']) {
        {'title': final String title} => title,
        _ => null,
      },
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
      teamNote: teamNote,
    );
  }

  /// The GraphQL node id.
  final String id;

  /// The repository, such as `a2ui-project/a2ui`.
  final String repository;
  final int number;
  final String title;
  final String url;
  final bool isPullRequest;
  final bool isOpen;

  /// Whether the item is a merged pull request.
  final bool isMerged;
  final DateTime createdAt;

  /// When anything about the item last changed on GitHub.
  final DateTime updatedAt;

  /// The login of the item's author, or null for a deleted account.
  final String? author;
  final List<String> labels;
  final List<String> assignees;

  /// The title of the item's milestone, or null if it has none.
  final String? milestone;

  /// For an issue, the numbers of the open pull requests that close it. For
  /// a pull request, the numbers of the issues it closes. They are in the
  /// item's [repository].
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

  /// The latest comment that a triager posted for the team with **Needs
  /// team input**, if the item has one.
  final TeamNote? teamNote;

  bool get needsTriage => labels.contains(needsTriageLabel);

  bool get needsTeamInput => labels.contains(needsTeamInputLabel);

  ItemKind get kind => switch ((isPullRequest, linkedItems.isEmpty)) {
    (false, false) => ItemKind.issueWithPrs,
    (false, true) => ItemKind.issueWithoutPrs,
    (true, false) => ItemKind.prWithIssues,
    (true, true) => ItemKind.prWithoutIssues,
  };

  ItemRef get ref => (repository: repository, number: number);

  /// The item with [number] in the item's repository, such as one of
  /// [linkedItems].
  ItemRef refTo(int number) => (repository: repository, number: number);

  /// "#12" for an item in [a2uiRepository], and "genui #12" for an item in
  /// another repository.
  String get shortName => '$_repositoryPrefix#$number';

  /// "Issue #12" or "PR #12" for an item in [a2uiRepository], and
  /// "genui PR #12" for an item in another repository.
  String get name =>
      '$_repositoryPrefix${isPullRequest ? 'PR' : 'Issue'} #$number';

  /// The repository's name and a space, or nothing for [a2uiRepository].
  String get _repositoryPrefix =>
      repository == a2uiRepository ? '' : '${repository.split('/').last} ';

  /// A comment is a triage bot comment if it starts with the triage bot
  /// prefix and a team member or a bot posted it. See `core.blueprint.md`.
  static bool _isTriageBotComment(Map<String, Object?> comment) {
    if (!hasTriageBotPrefix(comment['body']! as String)) return false;
    final Object? author = comment['author'];
    return _isTeamMember(comment) ||
        (author != null && asMap(author)['__typename'] == 'Bot');
  }

  static bool _isTeamMember(Map<String, Object?> comment) => const {
    'OWNER',
    'MEMBER',
    'COLLABORATOR',
  }.contains(comment['authorAssociation']);

  /// The times of the things that happened on the item, as
  /// `advisor.blueprint.md` lists them.
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

/// A comment that a triager posted for the team with **Needs team input**:
/// a team member's comment that starts with [teamNoteHeading].
final class TeamNote {
  const TeamNote({required this.text, this.author, required this.url});

  /// Reads a `Comments` node, or returns null if it is not a team note.
  static TeamNote? _tryParse(Map<String, Object?> comment) {
    final String body = (comment['body']! as String).replaceAll('\r\n', '\n');
    if (!body.startsWith(teamNoteHeading) ||
        !TriageItem._isTeamMember(comment)) {
      return null;
    }
    return TeamNote(
      text: body.substring(teamNoteHeading.length).trim(),
      author: loginOf(comment['author']),
      url: comment['url']! as String,
    );
  }

  /// The comment without [teamNoteHeading].
  final String text;

  /// The login of the triager, or null for a deleted account.
  final String? author;

  /// The URL of the comment.
  final String url;
}
