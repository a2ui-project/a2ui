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

/// A comment that was just posted, as
/// `POST /repos/{owner}/{repo}/issues/{number}/comments` returns it.
final class PostedComment {
  const PostedComment({
    required this.id,
    required this.association,
    required this.htmlUrl,
  });

  factory PostedComment.fromJson(Map<String, Object?> json) => PostedComment(
    id: json['id']! as int,
    association: json['author_association']! as String,
    htmlUrl: json['html_url']! as String,
  );

  final int id;

  /// The poster's association with the repository, such as `MEMBER`.
  final String association;

  final String htmlUrl;
}

/// The GitHub calls that the staleness pinger makes, on the items of one
/// repository: it reads them, and posts and deletes comments.
abstract interface class PingerGitHub implements ItemReader {
  /// Posts a comment with [body] on the item with [number].
  Future<PostedComment> comment(int number, String body);

  /// Deletes the comment with [id].
  Future<void> deleteComment(int id);
}

/// A [PingerGitHub] that calls the GitHub REST API.
final class RestPingerGitHub extends RestItemReader implements PingerGitHub {
  /// Calls GitHub with [client], for the items of [repository], such as
  /// `a2ui-project/a2ui`.
  RestPingerGitHub(super.client, super.repository);

  @override
  Future<PostedComment> comment(int number, String body) async =>
      PostedComment.fromJson(
        await client.rest('POST', '$issuesPath/$number/comments', {
              'body': body,
            })
            as Map<String, Object?>,
      );

  @override
  Future<void> deleteComment(int id) =>
      client.rest('DELETE', '$issuesPath/comments/$id');
}
