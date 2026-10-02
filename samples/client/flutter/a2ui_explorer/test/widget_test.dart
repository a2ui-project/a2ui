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

import 'package:a2ui_explorer/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
    'A2uiExplorerApp renders content immediately and supports stepper',
    (WidgetTester tester) async {
      // Set a wide screen size for 3-column desktop layout.
      tester.view.physicalSize = const Size(1400, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(const A2uiExplorerApp());
      await tester.pump();

      // Verify 3 columns are present.
      expect(find.text('SAMPLE SCENARIOS'), findsOneWidget);
      expect(find.text('JSON MESSAGE STREAM'), findsOneWidget);
      expect(find.text('DATA MODEL INSPECTOR'), findsOneWidget);
      expect(find.text('ACTION LOGS'), findsOneWidget);

      // Initial state: scenario is fully rendered by default!
      expect(find.text('A2UI Flutter Framework Adapter'), findsOneWidget);
      expect(find.text('Loading root...'), findsNothing);
      expect(find.text('Processed: 2 / 2'), findsOneWidget);

      // Tap Reset Scenario to enter stepping mode.
      await tester.tap(find.byTooltip('Reset Scenario'));
      await tester.pump();

      // Now in reset state: only createSurface was processed, root is pending.
      expect(find.text('Processed: 1 / 2'), findsOneWidget);
      expect(find.text('Loading root...'), findsOneWidget);

      // Advance 1 message (updates components).
      await tester.tap(find.text('Advance 1 Message'));
      await tester.pump();

      // Verify component rendered and placeholder is gone.
      expect(find.text('A2UI Flutter Framework Adapter'), findsOneWidget);
      expect(find.text('Loading root...'), findsNothing);
      expect(find.text('Processed: 2 / 2'), findsOneWidget);

      // Switch to Scenario 4 (Login Form).
      await tester.tap(find.text('4. Login Form (Two-Way Binding)'));
      await tester.pump();

      // Verify form rendered immediately with data model bound.
      expect(find.text('Sign In to A2UI'), findsOneWidget);
      expect(find.text('ada_lovelace'), findsNWidgets(2));
    },
  );
}
