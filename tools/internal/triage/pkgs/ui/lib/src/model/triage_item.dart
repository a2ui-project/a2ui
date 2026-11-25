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

import 'package:shared/shared.dart';

import '../github/json.dart';

/// The repository whose pull requests the triage UI triages together with
/// the items of [a2uiRepository]. See `ui.blueprint.md`.
const String genuiRepository = 'flutter/genui';

/// An issue or a pull request: its repository, such as
/// `a2ui-project/a2ui`, and its number there.
typedef ItemRef = ({String repository, int number});

/// "#12" for an item in [a2uiRepository], and "genui #12" for an item in
/// another repository.
String shortNameOf(ItemRef ref) => '${_repositoryPrefix(ref)}#${ref.number}';

/// The repository's name and a space, or nothing for [a2uiRepository].
String _repositoryPrefix(ItemRef ref) => ref.repository == a2uiRepository
    ? ''
    : '${ref.repository.split('/').last} ';

/// The prefix of the comment that the triager posts for the team when they
/// add [needsTeamInputLabel], as the triage UI shows it above the reply.
const String teamNoteTitle = 'Requires team input. Note for the discussion:';

/// The heading of the comment that the triager posts for the team when they
/// add [needsTeamInputLabel]. The triage UI adds it to the reply when it
/// applies the suggestion, and shows the latest such comment with the item's
/// analysis. See `docs/contributing/triage/triage.md`.
const String teamNoteHeading = '**$teamNoteTitle**\n\n';

/// The types of items, in the order the list shows them. See
/// `ui.blueprint.md`.
enum ItemKind {
  /// An issue that open pull requests are linked to close, whoever opened
  /// them, or that the analysis lists pull requests in `targeting_prs`
  /// for.
  issueWithPrs,

  /// An issue that no open pull request is linked to close, and whose
  /// analysis lists no pull request in `targeting_prs`. Closed and merged
  /// pull requests do not count.
  issueWithoutPrs,

  /// A pull request that closes issues, or whose analysis lists issues in
  /// `targeted_issues`.
  prWithIssues,

  /// A pull request that closes no issue, and whose analysis lists no
  /// issue in `targeted_issues`.
  prWithoutIssues,
}

/// Whether an item has a triage analysis, and whether it is current. See
/// `blueprints/features/triage_bot/analysis.blueprint.md`.
enum AnalysisStatus {
  /// No triage bot comment on the item has an `<a2ui>` block.
  none,

  /// The analysis comment does not hold a valid analysis.
  invalid,

  /// Nothing happened on the item after the analysis comment was last
  /// edited.
  current,

  /// Something happened on the item after the analysis comment was last
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
    this.body = '',
    required this.url,
    required this.isPullRequest,
    required this.isOpen,
    this.isMerged = false,
    this.isDraft = false,
    required this.createdAt,
    required this.updatedAt,
    this.author,
    this.labels = const [],
    this.assignees = const [],
    this.milestone,
    this.linkedItems = const [],
    this.closedLinkedItems = const [],
    this.analysisStatus = AnalysisStatus.none,
    this.analysis,
    this.analysisError,
    this.analysisUrl,
    this.teamNote,
    this.comments = const [],
  });

  /// Reads an `IssueFields` or `PullRequestFields` node of the triage UI's
  /// GraphQL queries.
  factory TriageItem.fromGraphQL(Map<String, Object?> node) {
    final isPullRequest = node['__typename'] == 'PullRequest';
    final List<Map<String, Object?>> comments = nodesOf(node['comments']);

    // The latest of each.
    final Map<String, Object?>? analysisComment = comments.reversed
        .where(
          (c) => _isTriageBotComment(c) && hasA2uiBlock(c['body']! as String),
        )
        .firstOrNull;
    final TeamNote? teamNote = comments.reversed
        .map(TeamNote._tryParse)
        .nonNulls
        .firstOrNull;

    AnalysisStatus status = AnalysisStatus.none;
    AnalysisPayload? analysis;
    String? analysisError;
    if (analysisComment != null) {
      try {
        analysis = AnalysisPayload.parse(analysisComment['body']! as String);
        final DateTime analyzedAt =
            dateOf(analysisComment['lastEditedAt']) ??
            dateOf(analysisComment['createdAt'])!;
        status = _activity(node, comments).any(analyzedAt.isBefore)
            ? AnalysisStatus.outdated
            : AnalysisStatus.current;
      } on FormatException catch (e) {
        status = AnalysisStatus.invalid;
        analysisError = e.message;
      }
    }

    final url = node['url']! as String;
    final String repository = Uri.parse(url).pathSegments.take(2).join('/');
    final List<({ItemRef ref, bool isOpen})> linked = [
      for (final Map<String, Object?> l in nodesOf(
        node[isPullRequest
            ? 'closingIssuesReferences'
            : 'closedByPullRequestsReferences'],
      ))
        (
          ref: (
            repository: switch (l['repository']) {
              {'nameWithOwner': final String name} => name,
              _ => repository,
            },
            number: l['number']! as int,
          ),
          isOpen: l['state'] == null || l['state'] == 'OPEN',
        ),
    ];
    return TriageItem(
      id: node['id']! as String,
      repository: repository,
      number: node['number']! as int,
      title: node['title']! as String,
      body: (node['body'] as String? ?? '').replaceAll('\r\n', '\n'),
      url: url,
      isPullRequest: isPullRequest,
      isOpen: node['state'] == 'OPEN',
      isMerged: node['state'] == 'MERGED',
      isDraft: node['isDraft'] == true,
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
        for (final l in linked)
          if (l.isOpen) l.ref,
      ],
      closedLinkedItems: [
        for (final l in linked)
          if (!l.isOpen) l.ref,
      ],
      analysisStatus: status,
      analysis: analysis,
      analysisError: analysisError,
      analysisUrl: analysisComment?['url'] as String?,
      teamNote: teamNote,
      comments: [
        for (final Map<String, Object?> c in comments)
          // The analysis comments hold the analysis's A2UI messages, and
          // [analysis] has the latest analysis.
          if (!_isTriageBotComment(c) || !hasA2uiBlock(c['body']! as String))
            ItemComment(
              author: loginOf(c['author']),
              createdAt: dateOf(c['createdAt'])!,
              body: (c['body']! as String).replaceAll('\r\n', '\n'),
              url: c['url']! as String,
            ),
      ],
    );
  }

  /// The GraphQL node id.
  final String id;

  /// The repository, such as `a2ui-project/a2ui`.
  final String repository;
  final int number;
  final String title;

  /// The item's description, as Markdown.
  final String body;
  final String url;
  final bool isPullRequest;
  final bool isOpen;

  /// Whether the item is a merged pull request.
  final bool isMerged;

  /// Whether the item is a draft pull request.
  final bool isDraft;
  final DateTime createdAt;

  /// When anything about the item last changed on GitHub.
  final DateTime updatedAt;

  /// The login of the item's author, or null for a deleted account.
  final String? author;
  final List<String> labels;
  final List<String> assignees;

  /// The title of the item's milestone, or null if it has none.
  final String? milestone;

  /// For an issue, the open pull requests that close it. For a pull request,
  /// the open issues it closes. They can be in another repository.
  final List<ItemRef> linkedItems;

  /// For a pull request, the closed issues it closes. The triage UI links
  /// them, but does not open them for editing.
  final List<ItemRef> closedLinkedItems;

  final AnalysisStatus analysisStatus;

  /// The analysis, unless [analysisStatus] is [AnalysisStatus.none] or
  /// [AnalysisStatus.invalid].
  final AnalysisPayload? analysis;

  /// What is wrong with the analysis comment, when [analysisStatus] is
  /// [AnalysisStatus.invalid].
  final String? analysisError;

  /// The URL of the analysis comment, if the item has one.
  final String? analysisUrl;

  /// The latest comment that a triager posted for the team, if the item has
  /// one.
  final TeamNote? teamNote;

  /// The last 100 comments, oldest first, without the triage bot's
  /// analysis comments.
  final List<ItemComment> comments;

  bool get needsTriage => labels.contains(needsTriageLabel);

  bool get needsTeamInput => labels.contains(needsTeamInputLabel);

  /// [linkedItems], then the other items that the [analysis] lists in
  /// `targeting_prs`, for an issue, or in `targeted_issues`, for a pull
  /// request. The list groups and flags the item by them.
  List<ItemRef> get linkedAndTargetedItems => {
    ...linkedItems,
    for (final int n
        in (isPullRequest
                ? analysis?.analysis.targetedIssues
                : analysis?.analysis.targetingPrs) ??
            const <int>[])
      refTo(n),
  }.toList();

  ItemKind get kind =>
      switch ((isPullRequest, linkedAndTargetedItems.isEmpty)) {
        (false, false) => ItemKind.issueWithPrs,
        (false, true) => ItemKind.issueWithoutPrs,
        (true, false) => ItemKind.prWithIssues,
        (true, true) => ItemKind.prWithoutIssues,
      };

  ItemRef get ref => (repository: repository, number: number);

  /// The item with [number] in the item's repository, such as one that the
  /// [analysis] lists.
  ItemRef refTo(int number) => (repository: repository, number: number);

  /// "#12" for an item in [a2uiRepository], and "genui #12" for an item in
  /// another repository.
  String get shortName => shortNameOf(ref);

  /// "Issue #12" or "PR #12" for an item in [a2uiRepository], and
  /// "genui PR #12" for an item in another repository.
  String get name =>
      '${_repositoryPrefix(ref)}${isPullRequest ? 'PR' : 'Issue'} #$number';

  /// Whether a `Comments` node is a triage bot comment. See
  /// `core.blueprint.md`.
  static bool _isTriageBotComment(Map<String, Object?> comment) {
    final Object? author = comment['author'];
    return isTriageBotComment(
      body: comment['body']! as String,
      association: comment['authorAssociation'] as String?,
      byBot: author != null && asMap(author)['__typename'] == 'Bot',
    );
  }

  /// The times of the things that happened on the item, as
  /// `triage_bot/analysis.blueprint.md` lists them.
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

/// A comment that a triager posted for the team: a team member's comment
/// that starts with [teamNoteHeading].
final class TeamNote {
  const TeamNote({required this.text, this.author, required this.url});

  /// Reads a `Comments` node, or returns null if it is not a team note.
  static TeamNote? _tryParse(Map<String, Object?> comment) {
    final String body = (comment['body']! as String).replaceAll('\r\n', '\n');
    if (!body.startsWith(teamNoteHeading) ||
        !isTeamMember(comment['authorAssociation'] as String?)) {
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

/// A comment on an item.
final class ItemComment {
  const ItemComment({
    this.author,
    required this.createdAt,
    required this.body,
    required this.url,
  });

  /// The login of the commenter, or null for a deleted account.
  final String? author;
  final DateTime createdAt;

  /// The comment, as Markdown.
  final String body;

  /// The URL of the comment.
  final String url;
}
