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

import 'dart:ui';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:triage_ui/src/model/triage_controller.dart';
import 'package:triage_ui/src/ui/triage_app.dart';

import '../../support/fake_github.dart';

void main() {
  late TriageController controller;
  late List<String> clipboard;

  setUp(() {
    final github = FakeGitHub([
      itemNode(10, title: 'Crash'),
      itemNode(11, title: 'Docs'),
    ]);
    controller = TriageController(connect: () async => github.service());
    clipboard = [];
  });

  tearDown(() => controller.dispose());

  Future<void> pumpApp(WidgetTester tester) async {
    tester.view
      ..physicalSize = const Size(1600, 1400)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (MethodCall call) async {
        if (call.method == 'Clipboard.setData') {
          clipboard.add(
            (call.arguments as Map<Object?, Object?>)['text']! as String,
          );
        }
        return null;
      },
    );
    await tester.runAsync(controller.start);
    await tester.pumpWidget(TriageApp(controller: controller));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Needs triage (2/2)'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining(RegExp('^Issues')).first);
    await tester.pumpAndSettle();
  }

  Future<void> click(WidgetTester tester, String text) async {
    final TestGesture mouse = await tester.startGesture(
      tester.getRect(find.text(text)).centerLeft + const Offset(2, 0),
      kind: PointerDeviceKind.mouse,
    );
    await tester.pump(const Duration(milliseconds: 30));
    await mouse.up();
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pumpAndSettle();
  }

  /// Drags the mouse across [text], copies the selection with Cmd+C, and
  /// returns what was copied.
  Future<String> dragAndCopy(WidgetTester tester, Finder text) async {
    final Rect rect = tester.getRect(text);
    final TestGesture mouse = await tester.startGesture(
      rect.centerLeft + const Offset(1, 0),
      kind: PointerDeviceKind.mouse,
    );
    for (var i = 1; i <= 10; i++) {
      await tester.pump(const Duration(milliseconds: 16));
      await mouse.moveTo(
        Offset.lerp(rect.centerLeft, rect.centerRight, i / 10)! -
            const Offset(1, 0),
      );
    }
    await mouse.up();
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pumpAndSettle();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.metaLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyC);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.metaLeft);
    await tester.pumpAndSettle();
    final String copied = clipboard.lastOrNull ?? '';
    clipboard.clear();
    return copied;
  }

  testWidgets('text on the card can be selected after a click on an item', (
    tester,
  ) async {
    await pumpApp(tester);

    // The click leaves a caret in the list, which used to keep a drag on
    // the card from selecting anything.
    await click(tester, '#10 Crash');

    expect(
      await dragAndCopy(tester, find.textContaining('Author:')),
      'Author: author10.',
    );
    expect(await dragAndCopy(tester, find.text('#11 Docs')), '#11 Docs');
    expect(
      await dragAndCopy(tester, find.textContaining('Age:')),
      startsWith('Age: '),
    );
  }, variant: TargetPlatformVariant.only(TargetPlatform.macOS));
}
