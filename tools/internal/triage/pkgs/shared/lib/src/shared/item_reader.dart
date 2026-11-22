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

import 'github_client.dart';
import 'item.dart';
import 'rest_json.dart';

/// Reads the issues and pull requests of one repository: what the flagger
/// and the staleness pinger read.
abstract interface class ItemReader {
  /// The repository, such as `a2ui-project/a2ui`.
  String get repository;

  /// The open issues and pull requests.
  Future<List<Item>> openItems();

  /// The item with [number], read now.
  Future<Item> item(int number);

  /// The top-level comments on the item with [number].
  Future<List<Contribution>> comments(int number);

  /// The reviews of the pull request with [number].
  Future<List<Contribution>> reviews(int number);

  /// The review comments on the pull request with [number].
  Future<List<Contribution>> reviewComments(int number);

  /// The history of the item with [number].
  Future<List<IssueEvent>> events(int number);
}

/// An [ItemReader] that calls the GitHub REST API.
class RestItemReader implements ItemReader {
  /// Calls GitHub with [client], for the items of [repository], such as
  /// `a2ui-project/a2ui`.
  RestItemReader(this.client, this.repository);

  /// The client that calls GitHub.
  final GitHubClient client;

  @override
  final String repository;

  /// The path of the repository's issues in the REST API.
  String get issuesPath => 'repos/$repository/issues';

  String get _pulls => 'repos/$repository/pulls';

  /// Every entry of the list at [path], from all its pages.
  Future<List<Map<String, Object?>>> _list(
    String path, [
    Map<String, String> query = const {},
  ]) async {
    final url = Uri(path: path, queryParameters: {...query, 'per_page': '100'});
    return [
      for (final Object? page in await client.restPages('$url'))
        for (final Object? entry in page! as List<Object?>)
          entry! as Map<String, Object?>,
    ];
  }

  Future<List<Contribution>> _contributions(String path) async => [
    for (final Map<String, Object?> json in await _list(path))
      ?contributionFromJson(json),
  ];

  @override
  Future<List<Item>> openItems() async => [
    for (final Map<String, Object?> json in await _list(issuesPath, {
      'state': 'open',
    }))
      itemFromJson(json),
  ];

  @override
  Future<Item> item(int number) async => itemFromJson(
    await client.rest('GET', '$issuesPath/$number') as Map<String, Object?>,
  );

  @override
  Future<List<Contribution>> comments(int number) =>
      _contributions('$issuesPath/$number/comments');

  @override
  Future<List<Contribution>> reviews(int number) =>
      _contributions('$_pulls/$number/reviews');

  @override
  Future<List<Contribution>> reviewComments(int number) =>
      _contributions('$_pulls/$number/comments');

  @override
  Future<List<IssueEvent>> events(int number) async => [
    for (final Map<String, Object?> json in await _list(
      '$issuesPath/$number/events',
    ))
      IssueEvent.fromJson(json),
  ];
}
