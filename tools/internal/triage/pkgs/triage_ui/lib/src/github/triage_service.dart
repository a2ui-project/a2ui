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

import '../model/genui_pull_request.dart';
import '../model/triage_item.dart';
import 'github_client.dart';
import 'json.dart';
import 'queries.dart';

/// The labels of the repository and the people who can be assigned to its
/// items, to complete what the triager types.
final class RepositoryInfo {
  const RepositoryInfo({
    this.labels = const [],
    this.labelColors = const {},
    this.assignableUsers = const [],
    this.milestones = const {},
  });

  final List<String> labels;

  /// The color of each label, as GitHub gives it: six hex digits, such as
  /// `d73a4a`.
  final Map<String, String> labelColors;
  final List<String> assignableUsers;

  /// The number of each open milestone, by title, soonest due first.
  final Map<String, int> milestones;
}

/// Reads and changes the items of `a2ui-project/a2ui` on GitHub.
class TriageService {
  TriageService(this._client);

  static const String owner = 'a2ui-project';
  static const String name = 'a2ui';

  /// The repository whose pull requests that need triage the list shows,
  /// without editing them.
  static const String genuiRepository = 'flutter/genui';

  final GitHubClient _client;

  static const Map<String, Object?> _repository = {
    'owner': owner,
    'name': name,
  };

  String _issuePath(int number) => 'repos/$owner/$name/issues/$number';

  /// The open items with `status: needs-triage` or
  /// `status: needs-team-input`.
  Future<List<TriageItem>> fetchQueue() async {
    final (
      List<TriageItem> needTriage,
      List<TriageItem> needTeamInput,
    ) = await (
      _searchItems('label:"$needsTriageLabel"'),
      _searchItems('label:"$needsTeamInputLabel"'),
    ).wait;
    final Set<int> found = {for (final i in needTriage) i.number};
    return [
      ...needTriage,
      for (final i in needTeamInput)
        if (!found.contains(i.number)) i,
    ];
  }

  /// The open pull requests in [genuiRepository] with
  /// `status: needs-triage`.
  Future<List<GenuiPullRequest>> fetchGenuiPullRequests() async => [
    for (final Map<String, Object?> node in await _search(
      genuiPullRequestsQuery,
      'repo:$genuiRepository is:pr is:open label:"$needsTriageLabel"',
    ))
      GenuiPullRequest.fromGraphQL(node),
  ];

  /// The open items in the repository that match [filter], a GitHub search
  /// filter.
  Future<List<TriageItem>> _searchItems(String filter) async => [
    for (final Map<String, Object?> node in await _search(
      searchQuery,
      'repo:$owner/$name is:open $filter',
    ))
      TriageItem.fromGraphQL(node),
  ];

  /// The nodes of every page of [graphqlQuery], a search for [query].
  Future<List<Map<String, Object?>>> _search(
    String graphqlQuery,
    String query,
  ) async {
    final nodes = <Map<String, Object?>>[];
    String? cursor;
    do {
      final Map<String, Object?> search = asMap(
        (await _client.graphql(graphqlQuery, {
          'query': query,
          'cursor': cursor,
        }))['search'],
      );
      nodes.addAll(nodesOf(search));
      final Map<String, Object?> page = asMap(search['pageInfo']);
      cursor = page['hasNextPage'] == true
          ? page['endCursor'] as String?
          : null;
    } while (cursor != null);
    return nodes;
  }

  /// The item with [number], or null if there is none.
  Future<TriageItem?> fetchItem(int number) async {
    final Map<String, Object?> data = await _client.graphql(itemQuery, {
      ..._repository,
      'number': number,
    });
    final Object? node = asMap(data['repository'])['issueOrPullRequest'];
    return node == null ? null : TriageItem.fromGraphQL(asMap(node));
  }

  Future<RepositoryInfo> fetchRepositoryInfo() async {
    final Map<String, Object?> repository = asMap(
      (await _client.graphql(repositoryQuery, _repository))['repository'],
    );
    final List<Map<String, Object?>> labels = nodesOf(repository['labels']);
    return RepositoryInfo(
      labels: [for (final label in labels) label['name']! as String],
      labelColors: {
        for (final label in labels)
          if (label['color'] case final String color)
            label['name']! as String: color,
      },
      assignableUsers: [
        for (final Map<String, Object?> user in nodesOf(
          repository['assignableUsers'],
        ))
          user['login']! as String,
      ]..sort(),
      milestones: {
        for (final Map<String, Object?> m in nodesOf(repository['milestones']))
          m['title']! as String: m['number']! as int,
      },
    );
  }

  /// Sets the milestone with [milestone] number on the item, or removes
  /// the item's milestone if [milestone] is null.
  Future<void> setMilestone(int number, int? milestone) =>
      _client.rest('PATCH', _issuePath(number), {'milestone': milestone});

  Future<void> postComment(int number, String body) =>
      _client.rest('POST', '${_issuePath(number)}/comments', {'body': body});

  /// Removes [labels], skipping the ones the item does not have.
  Future<void> removeLabels(int number, List<String> labels) async {
    for (final label in labels) {
      try {
        await _client.rest(
          'DELETE',
          '${_issuePath(number)}/labels/${Uri.encodeComponent(label)}',
        );
      } on GitHubException catch (e) {
        if (e.statusCode != 404) rethrow;
      }
    }
  }

  Future<void> addLabels(int number, List<String> labels) =>
      _client.rest('POST', '${_issuePath(number)}/labels', {'labels': labels});

  Future<void> removeAssignees(int number, List<String> logins) => _client.rest(
    'DELETE',
    '${_issuePath(number)}/assignees',
    {'assignees': logins},
  );

  /// Assigns [logins] to the item.
  ///
  /// GitHub skips the people it cannot assign without an error, so this
  /// throws a [GitHubException] that names them.
  Future<void> addAssignees(int number, List<String> logins) async {
    final Map<String, Object?> issue = asMap(
      await _client.rest('POST', '${_issuePath(number)}/assignees', {
        'assignees': logins,
      }),
    );
    final Set<String> assigned = {
      for (final Object? user in asList(issue['assignees']))
        (loginOf(user) ?? '').toLowerCase(),
    };
    final List<String> skipped = [
      for (final login in logins)
        if (!assigned.contains(login.toLowerCase())) login,
    ];
    if (skipped.isNotEmpty) {
      throw GitHubException(
        'GitHub did not assign ${skipped.join(', ')}. Only team members, and '
        'people who opened or commented on the item, can be assigned.',
      );
    }
  }

  /// Closes [item]: an issue with [closeAs], one of
  /// [TriageCloseReason.values], and a pull request without a reason.
  Future<void> close(
    TriageItem item,
    String closeAs, {
    int? duplicateOf,
  }) async {
    if (item.isPullRequest) {
      await _client.graphql(closePullRequestMutation, {'id': item.id});
      return;
    }
    String? duplicateId;
    if (closeAs == TriageCloseReason.duplicate && duplicateOf != null) {
      final Object? issue = asMap(
        (await _client.graphql(issueIdQuery, {
          ..._repository,
          'number': duplicateOf,
        }))['repository'],
      )['issue'];
      if (issue == null) {
        throw GitHubException('#$duplicateOf is not an issue.');
      }
      duplicateId = asMap(issue)['id']! as String;
    }
    await _client.graphql(closeIssueMutation, {
      'id': item.id,
      'reason': closeAs.toUpperCase(),
      'duplicateOf': duplicateId,
    });
  }
}
