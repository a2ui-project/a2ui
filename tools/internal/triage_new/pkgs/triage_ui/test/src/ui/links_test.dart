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

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:triage_ui/src/ui/links.dart';

void main() {
  const url =
      'https://github.com/flutter/genui/blob/27f5846441693fba6da224e3770453f269a7121c/packages/genui/README.md?plain=1#L1-L6';

  /// The spans of the [LinkifiedText] for [text], as (text, is a link).
  Future<List<(String, bool)>> spansOf(WidgetTester tester, String text) async {
    await tester.pumpWidget(MaterialApp(home: LinkifiedText(text)));
    final RichText rich = tester.widget(find.byType(RichText));
    final spans = <(String, bool)>[];
    rich.text.visitChildren((InlineSpan span) {
      if (span is TextSpan && span.text != null) {
        spans.add((span.text!, span.recognizer != null));
      }
      return true;
    });
    return spans;
  }

  testWidgets('makes the URLs in the text links', (tester) async {
    expect(await spansOf(tester, 'See $url, and (https://a2ui.org).'), [
      ('See ', false),
      (url, true),
      (', and (', false),
      ('https://a2ui.org', true),
      (').', false),
    ]);
  });

  testWidgets('shows text without URLs as it is', (tester) async {
    expect(await spansOf(tester, 'No links here.'), [
      ('No links here.', false),
    ]);
  });

  testWidgets('opens the URL when the link is clicked', (tester) async {
    final launched = <Object?>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/url_launcher'),
      (MethodCall call) async {
        launched.add((call.arguments as Map)['url']);
        return true;
      },
    );
    await spansOf(tester, 'See $url');
    final RichText rich = tester.widget(find.byType(RichText));
    rich.text.visitChildren((InlineSpan span) {
      if (span case TextSpan(recognizer: final TapGestureRecognizer r)) {
        r.onTap!();
      }
      return true;
    });
    await tester.pump();
    expect(launched, [url]);
  });
}
