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
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/basic_catalog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:video_player/video_player.dart';

import '../../support/basic_test_catalog.dart';
import '../../support/fake_video_player_platform.dart';
import '../../support/surface_harness.dart';

final WidgetCatalog _catalog = basicTestCatalog([BasicComponents.audioPlayer]);

const String _url = 'https://example.com/episode.mp3';

Finder _button(IconData icon) =>
    find.ancestor(of: find.byIcon(icon), matching: find.byType(IconButton));

bool _enabled(WidgetTester tester, IconData icon) =>
    tester.widget<IconButton>(_button(icon)).onPressed != null;

void main() {
  group('with a platform player', () {
    late FakeVideoPlayerPlatform platform;

    setUp(() {
      platform = FakeVideoPlayerPlatform()..install();
    });

    testWidgets('shows the description above the controls', (tester) async {
      await pumpComponents(tester, [
        {
          'id': 'root',
          'component': 'AudioPlayer',
          'url': _url,
          'description': 'Episode 12',
        },
      ], catalog: _catalog);

      expect(platform.uris, [_url]);
      final Text description = tester.widget<Text>(find.text('Episode 12'));
      expect(
        description.style,
        Theme.of(tester.element(find.text('Episode 12'))).textTheme.bodySmall,
      );
      expect(
        tester.getBottomLeft(find.text('Episode 12')).dy + 4,
        tester.getTopLeft(find.byType(Row)).dy,
      );
      expect(find.byType(VideoPlayer), findsNothing);
      expect(_enabled(tester, Icons.play_arrow), isFalse);
    });

    testWidgets('shows only the controls without a description', (
      tester,
    ) async {
      for (final String? description in [null, '']) {
        await pumpComponents(tester, [
          {
            'id': 'root',
            'component': 'AudioPlayer',
            'url': _url,
            'description': ?description,
          },
        ], catalog: _catalog);

        expect(find.byType(Text), findsNothing, reason: description);
        expect(_enabled(tester, Icons.play_arrow), isFalse);
      }
    });

    testWidgets('plays without a video view, and pauses', (tester) async {
      await pumpComponents(tester, [
        {'id': 'root', 'component': 'AudioPlayer', 'url': _url},
      ], catalog: _catalog);
      platform.initialize(0, duration: const Duration(minutes: 45));
      await tester.pump();

      expect(find.byType(VideoProgressIndicator), findsOneWidget);
      expect(find.byType(VideoPlayer), findsNothing);

      await tester.tap(_button(Icons.play_arrow));
      await tester.pump();
      expect(platform.calls, contains('play(0)'));

      await tester.tap(_button(Icons.pause));
      await tester.pump();
      expect(platform.calls.last, 'pause(0)');
    });

    testWidgets('follows a bound description and keeps the player', (
      tester,
    ) async {
      final SurfaceHarness harness = await pumpComponents(tester, [
        {
          'id': 'root',
          'component': 'AudioPlayer',
          'url': _url,
          'description': {'path': '/title'},
        },
      ], catalog: _catalog);
      platform.initialize(0);
      await tester.pump();
      await tester.tap(_button(Icons.play_arrow));
      await tester.pump();

      await harness.send([updateDataModel('Episode 12', path: '/title')]);
      expect(find.text('Episode 12'), findsOneWidget);
      await harness.send([updateDataModel('Episode 13', path: '/title')]);
      expect(find.text('Episode 13'), findsOneWidget);

      expect(platform.uris, [_url]);
      expect(platform.calls, isNot(contains('dispose(0)')));
      expect(find.byIcon(Icons.pause), findsOneWidget);

      await tester.tap(_button(Icons.pause));
      await tester.pump();
    });

    testWidgets('takes the fallback width when the width is unbounded', (
      tester,
    ) async {
      await pumpComponents(
        tester,
        [
          {'id': 'root', 'component': 'AudioPlayer', 'url': _url},
        ],
        catalog: _catalog,
        host: unboundedWidthHost,
      );

      expect(tester.getTopLeft(_button(Icons.play_arrow)).dx, 0);
      expect(tester.getSize(find.byType(A2uiSurface)).width, 300);
      expect(
        tester.getSize(find.byType(LinearProgressIndicator)).width,
        greaterThan(0),
      );
      expect(tester.takeException(), isNull);
    });
  });
}
