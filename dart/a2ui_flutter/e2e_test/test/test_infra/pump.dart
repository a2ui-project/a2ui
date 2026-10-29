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

import 'package:a2ui_flutter_example/chat_session.dart';
import 'package:flutter_test/flutter_test.dart';

/// Pumps frames until [session] is no longer busy.
///
/// Between frames the test waits in real time, so the model's network
/// traffic can arrive.
Future<void> pumpUntilIdle(
  WidgetTester tester,
  ChatSession session, {
  Duration timeout = const Duration(minutes: 2),
}) async {
  final stopwatch = Stopwatch()..start();
  do {
    if (stopwatch.elapsed > timeout) {
      fail('The model did not finish within $timeout.');
    }
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 50)),
    );
    await tester.pump(const Duration(milliseconds: 50));
  } while (session.busy);
  await tester.pump();
}
