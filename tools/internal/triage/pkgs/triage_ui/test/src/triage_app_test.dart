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

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:triage_ui/src/github_item.dart';
import 'package:triage_ui/src/triage_app.dart';

void main() {
  testWidgets('says how to open an item when there is none', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(TriageApp(item: ValueNotifier<GitHubItem?>(null)));

    expect(find.textContaining('No item to triage'), findsOneWidget);
  });

  testWidgets('shows the item, and the next item it receives', (
    WidgetTester tester,
  ) async {
    final item = ValueNotifier<GitHubItem?>(
      GitHubItem.tryParse('https://github.com/a2ui-project/a2ui/issues/1235'),
    );
    await tester.pumpWidget(TriageApp(item: item));

    expect(find.text('Issue #1235'), findsOneWidget);
    expect(
      find.text('https://github.com/a2ui-project/a2ui/issues/1235'),
      findsOneWidget,
    );

    item.value = GitHubItem.tryParse(
      'https://github.com/a2ui-project/a2ui/pull/4026',
    );
    await tester.pump();

    expect(find.text('Pull request #4026'), findsOneWidget);
    expect(find.text('Issue #1235'), findsNothing);
  });
}
