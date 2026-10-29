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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/basic_catalog.dart';
// ignore: deprecated_member_use, see https://github.com/a2ui-project/a2ui/issues/3235
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:video_player/video_player.dart';

import 'support/fake_video_player_platform.dart';
import 'support/image_server.dart';
import 'support/surface_harness.dart';

/// A v1.0 `createSurface` message on the basic catalog that carries
/// [components] and [dataModel].
Map<String, Object?> _createSurface(
  List<Map<String, Object?>> components, {
  Map<String, Object?>? dataModel,
}) => {
  'version': '1.0',
  'createSurface': {
    'surfaceId': testSurfaceId,
    'catalogId': BasicCatalog.v1_0Id,
    'components': components,
    'dataModel': ?dataModel,
  },
};

/// Renders [components] on a v1.0 surface of [catalog], the v1.0 basic
/// catalog unless given another.
Future<SurfaceHarness> _pump(
  WidgetTester tester,
  List<Map<String, Object?>> components, {
  Map<String, Object?>? dataModel,
  CatalogImplementation? catalog,
}) => pumpSurface(tester, [
  _createSurface(components, dataModel: dataModel),
], catalog: catalog ?? basicCatalog());

Map<String, Object?> _bind(String path) => {'@path': path};

void main() {
  testWidgets('renders a createSurface carrying its components and data', (
    tester,
  ) async {
    final SurfaceHarness harness = await _pump(
      tester,
      [
        {
          'id': 'root',
          'component': 'Text',
          'text': {
            '@call': 'formatString',
            'args': {'value': r'Hello, ${/name}'},
          },
        },
      ],
      dataModel: {'name': 'Ada'},
    );

    expect(find.text('Hello, Ada'), findsOneWidget);
    expect(harness.errors, isEmpty);
  });

  testWidgets('shows each template item its @index', (tester) async {
    await _pump(
      tester,
      [
        {
          'id': 'root',
          'component': 'List',
          'children': {'componentId': 'item', 'path': '/items'},
        },
        {
          'id': 'item',
          'component': 'Text',
          'text': {
            '@call': '@index',
            'args': {'offset': 1},
          },
        },
      ],
      dataModel: {
        'items': ['a', 'b'],
      },
    );

    expect(find.text('1'), findsOneWidget);
    expect(find.text('2'), findsOneWidget);
  });

  group('user activation', () {
    testWidgets('runs openUrl from a tap', (tester) async {
      final opened = <Uri>[];
      final SurfaceHarness harness = await _pump(tester, [
        {
          'id': 'root',
          'component': 'Button',
          'child': 'label',
          'action': {
            'functionCall': {
              '@call': 'openUrl',
              'args': {'url': 'https://example.com/docs'},
            },
          },
        },
        {'id': 'label', 'component': 'Text', 'text': 'Docs'},
      ], catalog: basicCatalog(openUrl: opened.add));

      await tester.tap(find.text('Docs'));
      await tester.pump();

      expect(opened, [Uri.parse('https://example.com/docs')]);
      expect(harness.actions, isEmpty);
      expect(harness.errors, isEmpty);
    });

    testWidgets('refuses openUrl bound to a property', (tester) async {
      final opened = <Uri>[];
      final SurfaceHarness harness = await _pump(tester, [
        {
          'id': 'root',
          'component': 'Text',
          'text': {
            '@call': 'openUrl',
            'args': {'url': 'https://example.com/docs'},
          },
        },
      ], catalog: basicCatalog(openUrl: opened.add));

      expect(opened, isEmpty);
      expect(harness.errorCodes, ['EXPRESSION_ERROR']);
    });
  });

  group('checks', () {
    List<Map<String, Object?>> form(Object? condition) => [
      {
        'id': 'root',
        'component': 'Column',
        'children': ['name', 'send'],
      },
      {
        'id': 'name',
        'component': 'TextField',
        'label': 'Name',
        'value': _bind('/name'),
        'checks': [
          {'condition': condition, 'message': 'Name is required.'},
        ],
      },
      {
        'id': 'send',
        'component': 'Button',
        'child': 'sendLabel',
        'action': {
          'event': {'name': 'send'},
        },
        'checks': [
          {'condition': condition, 'message': 'Name is required.'},
        ],
      },
      {'id': 'sendLabel', 'component': 'Text', 'text': 'Send'},
    ];

    bool sendEnabled(WidgetTester tester) =>
        tester.widget<OutlinedButton>(find.byType(OutlinedButton)).enabled;

    InputDecoration decoration(WidgetTester tester) =>
        tester.widget<TextField>(find.byType(TextField)).decoration!;

    testWidgets('a failing rule disables the button and shows an error', (
      tester,
    ) async {
      final SurfaceHarness harness = await _pump(
        tester,
        form({
          '@call': 'required',
          'args': {'value': _bind('/name')},
        }),
        dataModel: {'name': ''},
      );

      expect(sendEnabled(tester), isFalse);
      expect(decoration(tester).errorText, isNotNull);

      await tester.enterText(find.byType(TextField), 'Ada');
      await tester.pump();

      expect(harness.data('/name'), 'Ada');
      expect(sendEnabled(tester), isTrue);
      expect(decoration(tester).errorText, isNull);
    });

    testWidgets('a warning result leaves the button enabled and shows a hint', (
      tester,
    ) async {
      await _pump(
        tester,
        form(_bind('/check')),
        dataModel: {
          'name': 'Al',
          'check': {
            'valid': false,
            'severity': 'warning',
            'message': 'Short names are often typos.',
          },
        },
      );

      expect(sendEnabled(tester), isTrue);
      expect(decoration(tester).helperText, 'Short names are often typos.');
      expect(decoration(tester).errorText, isNull);
      expect(find.byType(Tooltip), findsNothing);
    });

    testWidgets('the other inputs show an info result as a hint, and an '
        'error in its place', (tester) async {
      final List<Map<String, Object?>> checks = [
        {'condition': _bind('/error'), 'message': 'Fix this.'},
        {'condition': _bind('/warning')},
      ];
      final SurfaceHarness harness = await _pump(
        tester,
        [
          {
            'id': 'root',
            'component': 'Column',
            'children': ['check', 'slider', 'picker', 'date'],
          },
          {
            'id': 'check',
            'component': 'CheckBox',
            'label': 'Subscribe',
            'value': _bind('/subscribe'),
            'checks': checks,
          },
          {
            'id': 'slider',
            'component': 'Slider',
            'value': _bind('/volume'),
            'max': 10,
            'checks': checks,
          },
          {
            'id': 'picker',
            'component': 'ChoicePicker',
            'options': [
              {'label': 'Red', 'value': 'red'},
            ],
            'value': _bind('/colors'),
            'checks': checks,
          },
          {
            'id': 'date',
            'component': 'DateTimeInput',
            'value': _bind('/date'),
            'checks': checks,
          },
        ],
        dataModel: {
          'subscribe': false,
          'volume': 3,
          'colors': <String>[],
          'date': '',
          'error': true,
          'warning': {
            'valid': false,
            'severity': 'info',
            'message': 'Check this.',
          },
        },
      );

      expect(find.text('Check this.'), findsNWidgets(4));
      expect(find.text('Fix this.'), findsNothing);

      harness.surface().dataModel.set('/error', false);
      // DateTimeInput's field fades its hint out.
      await tester.pumpAndSettle();

      expect(find.text('Fix this.'), findsNWidgets(4));
      expect(find.text('Check this.'), findsNothing);
    });

    testWidgets('a false boolean result acts as an error', (tester) async {
      await _pump(
        tester,
        form(_bind('/ok')),
        dataModel: {'name': '', 'ok': false},
      );

      expect(sendEnabled(tester), isFalse);
      expect(decoration(tester).errorText, 'Name is required.');
      expect(decoration(tester).helperText, isNull);
    });
  });

  group('accessibility', () {
    testWidgets('marks a polite or assertive component as a live region', (
      tester,
    ) async {
      final SemanticsHandle semantics = tester.ensureSemantics();
      await _pump(tester, [
        {
          'id': 'root',
          'component': 'Column',
          'children': ['polite', 'assertive', 'off'],
        },
        {
          'id': 'assertive',
          'component': 'Text',
          'text': 'Offline',
          'accessibility': {'label': 'Status', 'live': 'assertive'},
        },
        {
          'id': 'polite',
          'component': 'Text',
          'text': '3 new',
          'accessibility': {'label': 'Unread', 'live': 'polite'},
        },
        {
          'id': 'off',
          'component': 'Text',
          'text': 'Archive',
          'accessibility': {'label': 'Old', 'live': 'off'},
        },
      ]);

      expect(
        tester.getSemantics(find.bySemanticsLabel(RegExp('^Unread'))),
        isSemantics(isLiveRegion: true),
      );
      expect(
        tester.getSemantics(find.bySemanticsLabel(RegExp('^Status'))),
        isSemantics(isLiveRegion: true),
      );
      expect(
        tester.getSemantics(find.bySemanticsLabel(RegExp('^Old'))),
        isSemantics(isLiveRegion: false),
      );
      semantics.dispose();
    });

    testWidgets('hides a component while its bound hidden is true', (
      tester,
    ) async {
      final SemanticsHandle semantics = tester.ensureSemantics();
      final SurfaceHarness harness = await _pump(
        tester,
        [
          {
            'id': 'root',
            'component': 'Text',
            'text': 'Secret',
            'accessibility': {'hidden': _bind('/hidden')},
          },
        ],
        dataModel: {'hidden': true},
      );

      expect(find.text('Secret'), findsOneWidget);
      expect(find.bySemanticsLabel('Secret'), findsNothing);

      harness.surface().dataModel.set('/hidden', false);
      await tester.pump();

      expect(find.bySemanticsLabel('Secret'), findsOneWidget);
      semantics.dispose();
    });

    testWidgets('reads a hidden that is a validation result by its validity', (
      tester,
    ) async {
      final SemanticsHandle semantics = tester.ensureSemantics();
      await _pump(tester, [
        {
          'id': 'root',
          'component': 'Text',
          'text': 'Secret',
          'accessibility': {
            'hidden': {
              '@call': 'required',
              'args': {'value': 'x'},
            },
          },
        },
      ]);

      expect(find.text('Secret'), findsOneWidget);
      expect(find.bySemanticsLabel('Secret'), findsNothing);
      semantics.dispose();
    });
  });

  group('basic components', () {
    testWidgets('TextField does not check validationRegexp', (tester) async {
      await _pump(
        tester,
        [
          {
            'id': 'root',
            'component': 'TextField',
            'label': 'Zip',
            'value': _bind('/zip'),
            'validationRegexp': '[0-9]{5}',
          },
        ],
        dataModel: {'zip': ''},
      );

      await tester.enterText(find.byType(TextField), 'abc');
      await tester.pump();

      expect(
        tester.widget<TextField>(find.byType(TextField)).decoration!.errorText,
        isNull,
      );
    });

    testWidgets('TextField shows its placeholder beside its label', (
      tester,
    ) async {
      await _pump(tester, [
        {
          'id': 'root',
          'component': 'TextField',
          'label': 'Zip',
          'placeholder': '94043',
        },
      ]);

      final AnimatedOpacity placeholder = tester.widget(
        find
            .ancestor(
              of: find.text('94043'),
              matching: find.byType(AnimatedOpacity),
            )
            .first,
      );
      expect(placeholder.opacity, 1);
    });

    testWidgets('Slider moves in its steps', (tester) async {
      final SurfaceHarness harness = await _pump(
        tester,
        [
          {
            'id': 'root',
            'component': 'Slider',
            'label': 'Volume',
            'value': _bind('/volume'),
            'min': 0,
            'max': 1,
            'steps': 10,
          },
        ],
        dataModel: {'volume': 0},
      );

      final Slider slider = tester.widget<Slider>(find.byType(Slider));
      expect(slider.divisions, 10);

      slider.onChanged!(0.31);
      expect(harness.data('/volume'), 0.3);
    });

    testWidgets('Slider snaps to more than 1000 steps', (tester) async {
      final SurfaceHarness harness = await _pump(
        tester,
        [
          {
            'id': 'root',
            'component': 'Slider',
            'value': _bind('/volume'),
            'max': 1,
            'steps': 1001,
          },
        ],
        dataModel: {'volume': 0},
      );

      final Slider slider = tester.widget<Slider>(find.byType(Slider));
      expect(slider.divisions, 1001);

      slider.onChanged!(0.5);
      expect(harness.data('/volume'), 501 / 1001);
    });

    testWidgets('Icon follows a bound svgPath', (tester) async {
      final SurfaceHarness harness = await _pump(
        tester,
        [
          {
            'id': 'root',
            'component': 'Icon',
            'name': {'svgPath': _bind('/path')},
          },
        ],
        dataModel: {'path': 'M0 0h12v12H0z'},
      );

      expect(find.byType(Icon), findsNothing);

      harness.surface().dataModel.set('/path', 'not a path');
      await tester.pump();

      expect(find.byIcon(Icons.help_outline), findsOneWidget);
    });

    testWidgets('Video shows its poster until playback starts', (tester) async {
      final platform = FakeVideoPlayerPlatform()..install();
      const poster = 'https://example.com/poster.png';
      final Finder posterImage = find.byWidgetPredicate(
        (w) =>
            w is Image &&
            w.image is NetworkImage &&
            (w.image as NetworkImage).url == poster,
      );
      await withImageServer(ImageServer({}, fallback: widePng), () async {
        await _pump(tester, [
          {
            'id': 'root',
            'component': 'Video',
            'url': 'https://example.com/trailer.mp4',
            'posterUrl': poster,
          },
        ]);
        expect(posterImage, findsOneWidget);

        platform.initialize(0);
        await tester.pump();
        expect(posterImage, findsOneWidget);

        await tester.tap(find.byIcon(Icons.play_arrow));
        await tester.pump();
        expect(posterImage, findsNothing);
        expect(find.byType(VideoPlayer), findsOneWidget);

        // Paused at 0:00, the video has still been played.
        await tester.tap(find.byIcon(Icons.pause));
        await tester.pump();
        expect(posterImage, findsNothing);
        expect(find.byType(VideoPlayer), findsOneWidget);
      });
    });

    testWidgets('Video shows the video once ready when its poster fails to '
        'load', (tester) async {
      final platform = FakeVideoPlayerPlatform()..install();
      await withImageServer(ImageServer({}), () async {
        await _pump(tester, [
          {
            'id': 'root',
            'component': 'Video',
            'url': 'https://example.com/trailer.mp4',
            'posterUrl': 'https://example.com/missing.png',
          },
        ]);
        await settleImages(tester);
        expect(find.byType(VideoPlayer), findsNothing);

        platform.initialize(0);
        await tester.pump();

        expect(find.byType(VideoPlayer), findsOneWidget);
      });
    });

    testWidgets('Video drops its poster when the video fails', (tester) async {
      final platform = FakeVideoPlayerPlatform()..install();
      await withImageServer(ImageServer({}, fallback: widePng), () async {
        await _pump(tester, [
          {
            'id': 'root',
            'component': 'Video',
            'url': 'https://example.com/trailer.mp4',
            'posterUrl': 'https://example.com/poster.png',
          },
        ]);
        expect(find.byType(Image), findsOneWidget);

        platform.fail(0);
        await tester.pump();

        expect(find.byType(Image), findsNothing);
        expect(find.byIcon(Icons.videocam_off), findsOneWidget);
      });
    });
  });
}
