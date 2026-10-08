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

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/basic_catalog.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:video_player/video_player.dart';

import '../../support/basic_test_catalog.dart';
import '../../support/fake_video_player_platform.dart';
import '../../support/surface_harness.dart';

final WidgetCatalog _catalog = basicTestCatalog([
  BasicComponents.video,
  BasicComponents.text,
]);

const String _url = 'https://example.com/trailer.mp4';

Map<String, Object?> _video(Object? url) => {
  'id': 'root',
  'component': 'Video',
  'url': url,
};

Finder _button(IconData icon) =>
    find.ancestor(of: find.byIcon(icon), matching: find.byType(IconButton));

bool _enabled(WidgetTester tester, IconData icon) =>
    tester.widget<IconButton>(_button(icon)).onPressed != null;

Finder get _progress => find.byType(VideoProgressIndicator);

void main() {
  group('with a platform player', () {
    late FakeVideoPlayerPlatform platform;

    setUp(() {
      platform = FakeVideoPlayerPlatform()..install();
    });

    testWidgets('shows a loading frame until the video initializes', (
      tester,
    ) async {
      await pumpComponents(tester, [_video(_url)], catalog: _catalog);

      expect(platform.uris, [_url]);
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      expect(find.byType(VideoPlayer), findsNothing);
      expect(_enabled(tester, Icons.play_arrow), isFalse);
      final Size frame = tester.getSize(find.byType(AspectRatio));
      expect(frame.width / frame.height, closeTo(16 / 9, 0.01));
    });

    testWidgets('shows the video at its aspect ratio once initialized', (
      tester,
    ) async {
      await pumpComponents(tester, [_video(_url)], catalog: _catalog);

      platform.initialize(
        0,
        duration: const Duration(minutes: 1, seconds: 5),
        size: const Size(400, 300),
      );
      await tester.pump();

      expect(find.byKey(const ValueKey('video-view-0')), findsOneWidget);
      final Size frame = tester.getSize(find.byType(VideoPlayer));
      expect(frame.width, 800);
      expect(frame.width / frame.height, closeTo(4 / 3, 0.01));
      expect(_enabled(tester, Icons.play_arrow), isTrue);
      expect(_progress, findsOneWidget);
    });

    testWidgets('plays and pauses', (tester) async {
      await pumpComponents(tester, [_video(_url)], catalog: _catalog);
      platform.initialize(0);
      await tester.pump();

      await tester.tap(_button(Icons.play_arrow));
      await tester.pump();
      expect(platform.calls, contains('play(0)'));
      expect(find.byIcon(Icons.pause), findsOneWidget);

      platform.position = const Duration(seconds: 12);
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pump();
      final double played = tester
          .widgetList<LinearProgressIndicator>(
            find.descendant(
              of: _progress,
              matching: find.byType(LinearProgressIndicator),
            ),
          )
          .last
          .value!;
      expect(played, closeTo(12 / 65, 0.001));

      await tester.tap(_button(Icons.pause));
      await tester.pump();
      expect(platform.calls.last, 'pause(0)');
      expect(find.byIcon(Icons.play_arrow), findsOneWidget);
    });

    testWidgets('shows the failure when playback fails', (tester) async {
      await pumpComponents(tester, [_video(_url)], catalog: _catalog);
      platform.initialize(0);
      await tester.pump();

      platform.fail(0);
      await tester.pump();

      expect(find.byType(VideoPlayer), findsNothing);
      expect(find.byIcon(Icons.videocam_off), findsOneWidget);
      expect(find.byIcon(Icons.error_outline), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('shows the failure when the source fails to load', (
      tester,
    ) async {
      await pumpComponents(tester, [_video(_url)], catalog: _catalog);

      platform.fail(0);
      await tester.pump();

      expect(find.byIcon(Icons.videocam_off), findsOneWidget);
      expect(find.byIcon(Icons.play_arrow), findsNothing);
      expect(_progress, findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('replaces the player when the bound url changes', (
      tester,
    ) async {
      final SurfaceHarness harness = await pumpComponents(
        tester,
        [
          _video({'path': '/url'}),
        ],
        catalog: _catalog,
        data: {'url': _url},
      );
      platform.initialize(0);
      await tester.pump();

      await harness.send([
        updateDataModel('https://example.com/other.mp4', path: '/url'),
      ]);

      expect(platform.uris, [_url, 'https://example.com/other.mp4']);
      expect(platform.calls, contains('dispose(0)'));
      expect(platform.livePlayers, [1]);
      expect(find.byType(VideoPlayer), findsNothing);
      expect(_enabled(tester, Icons.play_arrow), isFalse);
    });

    testWidgets('keeps the player when the url is unchanged', (tester) async {
      final SurfaceHarness harness = await pumpComponents(
        tester,
        [
          _video({'path': '/url'}),
        ],
        catalog: _catalog,
        data: {'url': _url, 'other': 1},
      );
      platform.initialize(0);
      await tester.pump();

      await harness.send([updateDataModel(2, path: '/other')]);
      await harness.send([updateDataModel(_url, path: '/url')]);

      expect(platform.uris, [_url]);
      expect(find.byType(VideoPlayer), findsOneWidget);
    });

    testWidgets('loads nothing until the bound url has a value', (
      tester,
    ) async {
      final SurfaceHarness harness = await pumpComponents(tester, [
        _video({'path': '/url'}),
      ], catalog: _catalog);

      expect(platform.uris, isEmpty);
      expect(find.byIcon(Icons.videocam_off), findsNothing);
      expect(_enabled(tester, Icons.play_arrow), isFalse);

      await harness.send([updateDataModel(_url, path: '/url')]);

      expect(platform.uris, [_url]);
    });

    testWidgets('loads nothing for an empty url or one it cannot play', (
      tester,
    ) async {
      for (final (String url, bool fails) in [
        ('', false),
        ('http://[::1', true),
        ('file:///tmp/trailer.mp4', true),
        ('rtsp://example.com/live', true),
      ]) {
        await pumpComponents(tester, [_video(url)], catalog: _catalog);

        expect(platform.uris, isEmpty, reason: url);
        expect(
          find.byIcon(Icons.videocam_off),
          fails ? findsOneWidget : findsNothing,
          reason: url,
        );
        if (!fails) expect(_enabled(tester, Icons.play_arrow), isFalse);
      }
    });

    testWidgets('disposes the player when the component is removed', (
      tester,
    ) async {
      final SurfaceHarness harness = await pumpComponents(tester, [
        _video(_url),
      ], catalog: _catalog);
      platform.initialize(0);
      await tester.pump();

      await harness.send([
        updateComponents([
          {'id': 'root', 'component': 'Text', 'text': 'Gone'},
        ]),
      ]);

      expect(find.text('Gone'), findsOneWidget);
      expect(platform.calls, contains('dispose(0)'));
      expect(platform.livePlayers, isEmpty);
    });

    testWidgets('disposes a player that is still being created', (
      tester,
    ) async {
      platform.createGate = Completer<void>();
      final SurfaceHarness harness = await pumpComponents(tester, [
        _video(_url),
      ], catalog: _catalog);

      await harness.send([
        updateComponents([
          {'id': 'root', 'component': 'Text', 'text': 'Gone'},
        ]),
      ]);
      expect(platform.calls, isEmpty);

      platform.createGate!.complete();
      await tester.pump();

      expect(platform.calls, ['create(0)', 'dispose(0)']);
      expect(platform.livePlayers, isEmpty);
      expect(tester.takeException(), isNull);
    });
  });

  group('without a platform player', () {
    testWidgets('shows the failure and throws nothing', (tester) async {
      await pumpComponents(tester, [_video(_url)], catalog: _catalog);
      await tester.pump();

      expect(find.byIcon(Icons.videocam_off), findsOneWidget);
      expect(find.byIcon(Icons.error_outline), findsOneWidget);
      expect(_progress, findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('shows the failure when the plugin is missing', (tester) async {
      FakeVideoPlayerPlatform(
        createError: MissingPluginException('No implementation'),
      ).install();

      await pumpComponents(tester, [_video(_url)], catalog: _catalog);
      await tester.pump();

      expect(find.byIcon(Icons.videocam_off), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('layout', () {
    setUp(() => FakeVideoPlayerPlatform().install());

    testWidgets('takes the fallback width when the width is unbounded', (
      tester,
    ) async {
      await pumpComponents(
        tester,
        [_video(_url)],
        catalog: _catalog,
        host: unboundedWidthHost,
      );

      expect(tester.getSize(find.byType(AspectRatio)).width, 300);
      expect(tester.takeException(), isNull);
    });
  });
}
