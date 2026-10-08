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

import '../../support/basic_test_catalog.dart';
import '../../support/image_server.dart';
import '../../support/surface_harness.dart';

final WidgetCatalog _catalog = basicTestCatalog([
  BasicComponents.column,
  BasicComponents.image,
]);

const String _wide = 'https://images.test/wide.png';
const String _tall = 'https://images.test/tall.png';
const String _missing = 'https://images.test/missing.png';

final Map<String, List<int>> _images = {_wide: widePng, _tall: tallPng};

/// Runs [body] with network images served from [_images] and an empty image
/// cache.
void _testImages(
  String description,
  Future<void> Function(WidgetTester tester, ImageServer server) body,
) {
  testWidgets(description, (tester) async {
    final server = ImageServer(_images);
    await withImageServer(server, () => body(tester, server));
  });
}

/// Pumps [components] and waits for every image on screen to load or fail.
Future<SurfaceHarness> _pumpImages(
  WidgetTester tester,
  List<Map<String, Object?>> components, {
  Map<String, Object?>? data,
}) async {
  final SurfaceHarness harness = await pumpComponents(
    tester,
    components,
    catalog: _catalog,
    data: data,
  );
  await settleImages(tester);
  return harness;
}

Map<String, Object?> _image(Map<String, Object?> properties) => {
  'id': 'root',
  'component': 'Image',
  ...properties,
};

/// The size of one image of [variant] at [url], alone in a Column aligned by
/// [align]. The surface is 800 wide.
Future<Size> _sizeOf(
  WidgetTester tester,
  String? variant, {
  String url = _wide,
  String align = 'start',
}) async {
  await _pumpImages(tester, [
    {
      'id': 'root',
      'component': 'Column',
      'align': align,
      'children': ['image'],
    },
    {'id': 'image', 'component': 'Image', 'url': url, 'variant': ?variant},
  ]);
  return tester.getSize(find.byType(Image));
}

Image _imageWidget(WidgetTester tester) =>
    tester.widget<Image>(find.byType(Image));

void main() {
  _testImages('loads a network URL', (tester, server) async {
    await _pumpImages(tester, [
      _image({'url': _wide}),
    ]);

    expect(_imageWidget(tester).image, const NetworkImage(_wide));
    expect(server.requested, [_wide]);
    expect(find.byIcon(Icons.broken_image), findsNothing);
    expect(tester.takeException(), isNull);
  });

  group('fit', () {
    for (final (String? fit, String? variant, BoxFit expected) in [
      (null, null, BoxFit.fill),
      ('contain', null, BoxFit.contain),
      ('cover', null, BoxFit.cover),
      ('fill', null, BoxFit.fill),
      ('none', null, BoxFit.none),
      ('scaleDown', null, BoxFit.scaleDown),
      (null, 'header', BoxFit.cover),
      ('contain', 'header', BoxFit.contain),
    ]) {
      final on = variant == null ? '' : ' on a $variant';
      _testImages('${fit ?? 'omitted'}$on maps to $expected', (
        tester,
        _,
      ) async {
        await _pumpImages(tester, [
          _image({'url': _wide, 'fit': ?fit, 'variant': ?variant}),
        ]);

        expect(_imageWidget(tester).fit, expected);
      });
    }
  });

  group('description', () {
    _testImages('labels the image for accessibility', (tester, _) async {
      final SemanticsHandle semantics = tester.ensureSemantics();
      await _pumpImages(tester, [
        _image({'url': _wide, 'description': 'A wide test image'}),
      ]);

      expect(_imageWidget(tester).semanticLabel, 'A wide test image');
      expect(_imageWidget(tester).excludeFromSemantics, isFalse);
      expect(find.bySemanticsLabel('A wide test image'), findsOneWidget);
      semantics.dispose();
    });

    _testImages('leaves an undescribed image out of semantics', (
      tester,
      _,
    ) async {
      await _pumpImages(tester, [
        _image({'url': _wide}),
      ]);

      expect(_imageWidget(tester).excludeFromSemantics, isTrue);
    });
  });

  _testImages('shows a placeholder when the load fails', (tester, _) async {
    final SurfaceHarness harness = await _pumpImages(tester, [
      _image({'url': _missing}),
    ]);

    expect(find.byIcon(Icons.broken_image), findsOneWidget);
    expect(tester.takeException(), isNull);
    expect(harness.errors, isEmpty);
  });

  for (final url in ['assets/photo.png', 'file:///tmp/photo.png']) {
    _testImages('shows a placeholder for $url', (tester, server) async {
      await _pumpImages(tester, [
        _image({'url': url}),
      ]);

      expect(find.byType(Image), findsNothing);
      expect(server.requested, isEmpty);
      expect(find.byIcon(Icons.broken_image), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }

  for (final (String description, Map<String, Object?> data) in [
    ('an empty URL', {'url': ''}),
    ('missing URL data', <String, Object?>{}),
  ]) {
    _testImages('renders nothing for $description', (tester, server) async {
      await _pumpImages(tester, [
        _image({
          'url': {'path': '/url'},
        }),
      ], data: data);

      expect(find.byType(Image), findsNothing);
      expect(server.requested, isEmpty);
    });
  }

  group('variant', () {
    _testImages('mediumFeature, the default, keeps the natural size', (
      tester,
      _,
    ) async {
      expect(await _sizeOf(tester, null), const Size(200, 100));
      expect(await _sizeOf(tester, 'mediumFeature'), const Size(200, 100));
    });

    for (final align in ['start', 'stretch']) {
      _testImages('icon is 24 square under $align', (tester, _) async {
        expect(
          await _sizeOf(tester, 'icon', align: align),
          const Size.square(24),
        );
      });

      _testImages('avatar is a 40 circle under $align', (tester, _) async {
        expect(
          await _sizeOf(tester, 'avatar', align: align),
          const Size.square(40),
        );
        expect(
          find.ancestor(
            of: find.byType(Image),
            matching: find.byType(ClipOval),
          ),
          findsOneWidget,
        );
      });

      _testImages('smallFeature is at most 100 wide under $align', (
        tester,
        _,
      ) async {
        expect(
          await _sizeOf(tester, 'smallFeature', align: align),
          const Size(100, 50),
        );
      });
    }

    _testImages('largeFeature is at most 400 tall', (tester, _) async {
      expect(
        await _sizeOf(tester, 'largeFeature', url: _tall, align: 'stretch'),
        const Size(800, 400),
      );
      expect(
        await _sizeOf(tester, 'largeFeature', url: _tall),
        const Size(100, 200),
      );
    });

    _testImages('header is 200 tall and fills a stretched width', (
      tester,
      _,
    ) async {
      expect(
        await _sizeOf(tester, 'header', align: 'stretch'),
        const Size(800, 200),
      );
    });

    _testImages('header keeps its aspect ratio in a loose width', (
      tester,
      _,
    ) async {
      expect(await _sizeOf(tester, 'header'), const Size(400, 200));
    });
  });
}
