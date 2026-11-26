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

import 'dart:convert';

import 'package:flagger/flagger.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared/shared.dart';
import 'package:test/test.dart';

/// A [RestFlaggerGitHub] whose GitHub answers each request with [respond],
/// and records the requests in [requests].
RestFlaggerGitHub restGitHub(
  List<http.Request> requests,
  Object? Function(http.Request request) respond,
) => RestFlaggerGitHub(
  GitHubClient(
    token: 'token',
    httpClient: MockClient((request) async {
      requests.add(request);
      final Object? body = respond(request);
      return http.Response(body == null ? '' : jsonEncode(body), 200);
    }),
  ),
  'a2ui-project/a2ui',
);

void main() {
  group('RestFlaggerGitHub', () {
    test('adds and removes labels', () async {
      final requests = <http.Request>[];
      final RestFlaggerGitHub github = restGitHub(requests, (_) => null);
      await github.addLabel(7, needsTriageLabel);
      await github.removeLabel(7, needsTriageLabel);
      expect(requests[0].method, 'POST');
      expect(requests[0].url.path, '/repos/a2ui-project/a2ui/issues/7/labels');
      expect(jsonDecode(requests[0].body), {
        'labels': [needsTriageLabel],
      });
      expect(requests[1].method, 'DELETE');
      expect(
        requests[1].url.toString(),
        'https://api.github.com/repos/a2ui-project/a2ui/issues/7/labels/'
        'status%3A%20needs-triage',
      );
    });
  });
}
