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

import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:material_ui/material_ui.dart';
import 'package:ui/src/github/browser.dart';
import 'package:ui/src/github/github_access.dart';
import 'package:ui/src/model/triage_controller.dart';
import 'package:ui/src/model/triage_service.dart';
import 'package:ui/src/ui/triage_app.dart';

import '../../support/fake_github.dart';

/// The app as `main.dart` starts it: signed in with a preset token, as on
/// macOS with `GITHUB_TOKEN`, loading the items itself.
void main() {
  late FakeGitHub github;
  late GitHubAccess access;
  late TriageController controller;

  /// Whether GitHub answers 401, as for a revoked token.
  late bool rejecting;

  setUp(() {
    github = FakeGitHub([
      itemNode(
        10,
        title: 'Crash on an empty Row',
        comments: [
          commentNode(
            analysisComment(
              'root = TriageAnalysis(tldr="""Case: a crash.""", '
              'summary="""A crash.""", reason="Priority is not set.", '
              'suggestion="""Set P1.""", reply="""Thanks for the report.""", '
              'added_labels=["P1"])',
            ),
            at: day(2),
          ),
        ],
      ),
      itemNode(11, title: 'Docs are unclear', createdAt: day(3)),
      itemNode(12, pr: true, title: 'Add a Slider', createdAt: day(4)),
    ]);
    rejecting = false;
    final http.Client gitHub = github.httpClient();
    access = GitHubAccess(
      page: null,
      browser: MemoryBrowser(),
      presetToken: 'good',
      httpClient: MockClient((request) async {
        if (rejecting) {
          return http.Response('{"message": "Bad credentials"}', 401);
        }
        if (request.url.path == '/user') {
          return http.Response('{"login": "ann"}', 200);
        }
        final forwarded = http.Request(request.method, request.url)
          ..headers.addAll(request.headers)
          ..bodyBytes = request.bodyBytes;
        return http.Response.fromStream(await gitHub.send(forwarded));
      }),
    );
    controller = TriageController(
      connect: () async => TriageService(access.client()),
    );
  });

  /// Pumps until [done], for work that the app starts on its own, such as
  /// loading the items, which waits on more than frames.
  Future<void> pumpUntil(WidgetTester tester, bool Function() done) async {
    for (var i = 0; i < 200 && !done(); i++) {
      await tester.pump(const Duration(milliseconds: 20));
    }
    await tester.pumpAndSettle();
  }

  Future<void> pumpApp(WidgetTester tester) async {
    tester.view
      ..physicalSize = const Size(1600, 1400)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    // As in main.dart: with a preset token, the check signs in at once.
    unawaited(access.check());
    await tester.pumpWidget(TriageApp(controller: controller, access: access));
    await pumpUntil(tester, () => controller.selected != null);
  }

  Finder inList(String text) =>
      find.descendant(of: find.byType(ListTile), matching: find.text(text));

  testWidgets('starts signed in, with Needs triage open at the first item', (
    tester,
  ) async {
    await pumpApp(tester);

    expect(controller.isConnected, isTrue);
    expect(inList('#10 Crash on an empty Row'), findsOneWidget);
    expect(inList('#11 Docs are unclear'), findsOneWidget);
    expect(inList('#12 Add a Slider'), findsOneWidget);
    expect(controller.selected?.ref, a2ui(10));
    expect(controller.selectedGroup, ItemGroup.newItems);
  });

  testWidgets('moves through the list with the arrow keys and J and K', (
    tester,
  ) async {
    await pumpApp(tester);

    Future<void> press(LogicalKeyboardKey key) async {
      await tester.sendKeyEvent(key);
      await tester.pumpAndSettle();
    }

    await press(LogicalKeyboardKey.arrowDown);
    expect(controller.selected?.ref, a2ui(11));
    await press(LogicalKeyboardKey.keyJ);
    expect(controller.selected?.ref, a2ui(12));
    // The last item stays selected.
    await press(LogicalKeyboardKey.keyJ);
    expect(controller.selected?.ref, a2ui(12));
    await press(LogicalKeyboardKey.keyK);
    expect(controller.selected?.ref, a2ui(11));
    await press(LogicalKeyboardKey.arrowUp);
    expect(controller.selected?.ref, a2ui(10));
  });

  testWidgets('says what Apply changes, and applies on Ctrl+Enter', (
    tester,
  ) async {
    await pumpApp(tester);
    expect(find.textContaining(RegExp(r'^#10: reply, .*\+P1')), findsOneWidget);

    await tester.sendKeyDownEvent(LogicalKeyboardKey.control);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.control);
    await pumpUntil(tester, () => controller.session.isApplied(a2ui(10)));

    expect(github.calls, contains(startsWith('POST issues/10/labels')));
  });

  testWidgets('shows the sign-in when GitHub rejects the token, and keeps '
      'the items after the next sign-in', (tester) async {
    await pumpApp(tester);

    rejecting = true;
    await tester.tap(
      find.descendant(of: find.byType(AppBar), matching: find.text('Refresh')),
    );
    await pumpUntil(tester, () => access.state == SignInState.signedOut);
    expect(access.state, SignInState.signedOut);
    expect(find.text('Sign in to GitHub'), findsOneWidget);
    expect(find.textContaining('Sign in again'), findsOneWidget);

    rejecting = false;
    await tester.enterText(find.byType(TextField), 'good');
    await tester.tap(find.text('Use token'));
    await pumpUntil(tester, () => controller.error == null);
    expect(access.state, SignInState.signedIn);
    expect(controller.error, isNull);
    expect(inList('#10 Crash on an empty Row'), findsOneWidget);
  });

  testWidgets('signs out without a page to reload, as on macOS', (
    tester,
  ) async {
    await pumpApp(tester);

    await tester.tap(find.byTooltip('Menu'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign out'));
    await tester.pumpAndSettle();

    expect(access.state, SignInState.signedOut);
    expect(find.text('Sign in to GitHub'), findsOneWidget);
  });
}
