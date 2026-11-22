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

import 'item.dart';

/// The GitHub calls that the flagger and the staleness pinger make, on the
/// items of one repository.
abstract interface class FlaggerGitHub {
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

  Future<void> addLabel(int number, String label);

  Future<void> removeLabel(int number, String label);

  /// Posts a comment with [body] on the item with [number].
  Future<PostedComment> comment(int number, String body);

  /// Deletes the comment with [id].
  Future<void> deleteComment(int id);
}

/// A [FlaggerGitHub] that calls the GitHub REST API.
final class RestFlaggerGitHub implements FlaggerGitHub {
  /// Calls GitHub with the client, for the items of [repository], such as
  /// `a2ui-project/a2ui`.
  RestFlaggerGitHub(this._client, this.repository);

  final GitHubClient _client;

  @override
  final String repository;

  String get _issues => 'repos/$repository/issues';

  String get _pulls => 'repos/$repository/pulls';

  /// Every entry of the list at [path], from all its pages.
  Future<List<Map<String, Object?>>> _list(
    String path, [
    Map<String, String> query = const {},
  ]) async {
    final url = Uri(path: path, queryParameters: {...query, 'per_page': '100'});
    return [
      for (final Object? page in await _client.restPages('$url'))
        for (final Object? entry in page! as List<Object?>)
          entry! as Map<String, Object?>,
    ];
  }

  Future<List<Contribution>> _contributions(String path) async => [
    for (final Map<String, Object?> json in await _list(path))
      ?Contribution.fromJson(json),
  ];

  @override
  Future<List<Item>> openItems() async => [
    for (final Map<String, Object?> json in await _list(_issues, {
      'state': 'open',
    }))
      Item.fromJson(json),
  ];

  @override
  Future<Item> item(int number) async => Item.fromJson(
    await _client.rest('GET', '$_issues/$number') as Map<String, Object?>,
  );

  @override
  Future<List<Contribution>> comments(int number) =>
      _contributions('$_issues/$number/comments');

  @override
  Future<List<Contribution>> reviews(int number) =>
      _contributions('$_pulls/$number/reviews');

  @override
  Future<List<Contribution>> reviewComments(int number) =>
      _contributions('$_pulls/$number/comments');

  @override
  Future<List<IssueEvent>> events(int number) async => [
    for (final Map<String, Object?> json in await _list(
      '$_issues/$number/events',
    ))
      IssueEvent.fromJson(json),
  ];

  @override
  Future<void> addLabel(int number, String label) =>
      _client.rest('POST', '$_issues/$number/labels', {
        'labels': [label],
      });

  @override
  Future<void> removeLabel(int number, String label) => _client.rest(
    'DELETE',
    '$_issues/$number/labels/${Uri.encodeComponent(label)}',
  );

  @override
  Future<PostedComment> comment(int number, String body) async =>
      PostedComment.fromJson(
        await _client.rest('POST', '$_issues/$number/comments', {
              'body': body,
            })
            as Map<String, Object?>,
      );

  @override
  Future<void> deleteComment(int id) =>
      _client.rest('DELETE', '$_issues/comments/$id');
}
