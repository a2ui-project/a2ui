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

import 'package:a2ui_flutter/basic_catalog.dart';
// ignore: deprecated_member_use, see https://github.com/a2ui-project/a2ui/issues/3235
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/image_server.dart';

Widget _error(BuildContext context, Object error, StackTrace? stackTrace) =>
    const Text('error');

void main() {
  testWidgets('decodes a data: URL in memory', (tester) async {
    await tester.pumpWidget(
      A2uiMediaImage(
        'DATA:image/png;base64,${base64Encode(widePng)}',
        errorBuilder: _error,
      ),
    );

    expect(tester.widget<Image>(find.byType(Image)).image, isA<MemoryImage>());
    expect(find.text('error'), findsNothing);
  });

  for (final url in [
    'data:image/png;base64,!!!!',
    'data:image/png;base64,a',
    'data:',
  ]) {
    testWidgets('builds the error widget for the malformed URL $url', (
      tester,
    ) async {
      await tester.pumpWidget(
        Directionality(
          textDirection: TextDirection.ltr,
          child: A2uiMediaImage(url, errorBuilder: _error),
        ),
      );

      expect(find.text('error'), findsOneWidget);
      expect(find.byType(Image), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('fetches any other URL', (tester) async {
    await tester.pumpWidget(
      const A2uiMediaImage(
        'https://images.test/wide.png',
        errorBuilder: _error,
      ),
    );

    expect(tester.widget<Image>(find.byType(Image)).image, isA<NetworkImage>());
  });
}
