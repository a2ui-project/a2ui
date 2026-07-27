// Copyright 2025 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import 'package:flutter_test/flutter_test.dart';

/// A class that collects issues found during testing.
///
/// Instead of failing the test immediately, it prints the issues
/// and fails the test execution at the end.
class IssueReporter {
  IssueReporter();

  int _issuesFound = 0;

  void expect(bool expectation, String issue) {
    if (expectation) return;
    // ignore: avoid_print
    print('Issue: $issue');
    _issuesFound++;
  }

  void failIfIssuesFound() {
    if (_issuesFound > 0) {
      fail(
        'Found $_issuesFound issues. Find them above prefixed with "Issue: "',
      );
    }
  }
}
