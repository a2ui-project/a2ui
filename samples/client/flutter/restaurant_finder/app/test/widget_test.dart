// Copyright 2026 Google LLC
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

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genui/genui.dart';
import 'package:restaurant_finder_client/restaurant_finder_client.dart';
import 'package:restaurant_finder_client/src/primitives.dart';

import 'session_test.dart';

class FakeRestaurantSession extends RestaurantSession {
  FakeRestaurantSession({required super.connector});

  bool _mockIsRequesting = false;
  @override
  bool get isRequesting => _mockIsRequesting;
  set isRequesting(bool val) {
    _mockIsRequesting = val;
    notifyListeners();
  }

  bool _mockHasSentMessage = false;
  @override
  bool get hasSentMessage => _mockHasSentMessage;
  set hasSentMessage(bool val) {
    _mockHasSentMessage = val;
    notifyListeners();
  }

  String _mockLoadingText = 'Searching...';
  @override
  String get loadingText => _mockLoadingText;
  set loadingText(String val) {
    _mockLoadingText = val;
    notifyListeners();
  }

  String? _mockError;
  @override
  String? get error => _mockError;
  set error(String? val) {
    _mockError = val;
    notifyListeners();
  }

  List<String> _mockActiveSurfaceIds = [];
  @override
  Iterable<String> get activeSurfaceIds => _mockActiveSurfaceIds;
  set activeSurfaceIds(Iterable<String> val) {
    _mockActiveSurfaceIds = val.toList();
    notifyListeners();
  }
}

void main() {
  group('RestaurantScreen Widget Tests', () {
    late MockAgentConnector mockConnector;
    late FakeRestaurantSession fakeSession;

    setUp(() {
      mockConnector = MockAgentConnector();
      fakeSession = FakeRestaurantSession(connector: mockConnector);
    });

    testWidgets('renders initial form correctly', (WidgetTester tester) async {
      await tester.pumpWidget(RestaurantFinderApp(session: fakeSession));

      expect(find.text('Restaurant Finder'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
      expect(find.byType(FilledButton), findsOneWidget);
    });

    testWidgets('renders progress indicator and loading text when requesting', (
      WidgetTester tester,
    ) async {
      fakeSession.isRequesting = true;

      await tester.pumpWidget(RestaurantFinderApp(session: fakeSession));

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.text('Searching...'), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
    });

    testWidgets('renders error banner if error is set', (
      WidgetTester tester,
    ) async {
      fakeSession.error = 'Failed to load';

      await tester.pumpWidget(RestaurantFinderApp(session: fakeSession));

      expect(find.text('Failed to load'), findsOneWidget);
    });

    testWidgets('submits message on button tap', (WidgetTester tester) async {
      await tester.pumpWidget(RestaurantFinderApp(session: fakeSession));

      await tester.enterText(find.byType(TextField), '3 pasta places');
      await tester.tap(find.byType(FilledButton));
      await tester.pump();

      expect(mockConnector.connectAndSendCalled, isTrue);
      expect(mockConnector.lastSentMessage?.text, equals('3 pasta places'));
    });

    testWidgets('ThemeToggleButton toggles on tap', (
      WidgetTester tester,
    ) async {
      bool toggled = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ThemeToggleButton(
              themeMode: ThemeMode.light,
              onToggle: () => toggled = true,
            ),
          ),
        ),
      );
      await tester.tap(find.byType(ThemeToggleButton));
      expect(toggled, isTrue);
    });

    testWidgets('ErrorBanner renders message', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: ErrorBanner(message: 'Fatal error')),
        ),
      );
      expect(find.text('Fatal error'), findsOneWidget);
    });

    testWidgets('renders surfaces when message is sent', (
      WidgetTester tester,
    ) async {
      fakeSession.hasSentMessage = true;
      fakeSession.activeSurfaceIds = const ['sidebar'];

      await tester.pumpWidget(RestaurantFinderApp(session: fakeSession));
      await tester.pump();

      expect(find.byType(ListView), findsOneWidget);
      expect(
        find.byWidgetPredicate((w) => w is Surface, skipOffstage: false),
        findsOneWidget,
      );
    });

    testWidgets('toggles theme mode on toggle button tap', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(RestaurantFinderApp(session: fakeSession));
      await tester.pumpAndSettle();

      // Find the toggle button and tap it
      await tester.tap(find.byType(ThemeToggleButton));
      await tester.pumpAndSettle();
    });
  });
}
