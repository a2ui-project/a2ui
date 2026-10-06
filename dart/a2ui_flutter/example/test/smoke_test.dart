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

import 'package:flutter_test/flutter_test.dart';
import 'package:simple_chat/agent/api_key/_io_api_key.dart';
import 'package:simple_chat/main.dart';

void main() {
  setUp(() {
    debugApiKey = 'dummy_api_key';
  });

  tearDown(() {
    debugApiKey = null;
  });

  testWidgets('Smoke test: App starts without issues', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const MyApp());
    expect(find.byType(ChatScreen), findsOneWidget);
  });
}
