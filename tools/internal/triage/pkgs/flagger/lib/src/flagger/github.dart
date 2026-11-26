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

/// The GitHub calls that the flagger makes, on the items of one repository:
/// it reads them, and adds and removes labels.
abstract interface class FlaggerGitHub implements ItemReader {
  Future<void> addLabel(int number, String label);

  Future<void> removeLabel(int number, String label);
}

/// A [FlaggerGitHub] that calls the GitHub REST API.
final class RestFlaggerGitHub extends RestItemReader implements FlaggerGitHub {
  /// Calls GitHub with [client], for the items of [repository], such as
  /// `a2ui-project/a2ui`.
  RestFlaggerGitHub(super.client, super.repository);

  @override
  Future<void> addLabel(int number, String label) =>
      client.rest('POST', '$issuesPath/$number/labels', {
        'labels': [label],
      });

  @override
  Future<void> removeLabel(int number, String label) => client.rest(
    'DELETE',
    '$issuesPath/$number/labels/${Uri.encodeComponent(label)}',
  );
}
