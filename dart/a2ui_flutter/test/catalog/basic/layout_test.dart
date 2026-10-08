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
import 'package:json_schema_builder/json_schema_builder.dart';

import '../../support/basic_test_catalog.dart';
import '../../support/fixture_catalog.dart';
import '../../support/surface_harness.dart';

/// The width of the default test surface.
const double _width = 800;

final WidgetCatalog _catalog = basicTestCatalog([
  BasicComponents.row,
  BasicComponents.column,
  BasicComponents.list,
  BasicComponents.text,
  BasicComponents.icon,
  BasicComponents.button,
  BasicComponents.image,
  BasicComponents.checkBox,
  BasicComponents.textField,
  BasicComponents.choicePicker,
  BasicComponents.slider,
  BasicComponents.dateTimeInput,
]);

Map<String, Object?> _text(String id, String text, {num? weight}) => {
  'id': id,
  'component': 'Text',
  'text': text,
  'weight': ?weight,
};

Map<String, Object?> _flex(
  String id,
  String type,
  List<String> children, {
  String? justify,
  String? align,
}) => {
  'id': id,
  'component': type,
  'children': children,
  'justify': ?justify,
  'align': ?align,
};

Size _size(WidgetTester tester, String text) => tester.getSize(find.text(text));

/// A component built from [builder] alone, with no properties.
ComponentImplementation _plain(String name, WidgetBuilder builder) =>
    ComponentImplementation(
      name: name,
      schema: Schema.object(properties: {}),
      builder: (context, node, props, buildChild) => builder(context),
    );

void main() {
  testWidgets('maps every justify and align value of the specification', (
    tester,
  ) async {
    Flex flex() => tester.widget<Flex>(
      find.descendant(
        of: find.byType(A2uiSurface),
        matching: find.byType(Flex),
      ),
    );
    for (final (String? justify, MainAxisAlignment expected) in [
      ('start', MainAxisAlignment.start),
      ('center', MainAxisAlignment.center),
      ('end', MainAxisAlignment.end),
      ('spaceBetween', MainAxisAlignment.spaceBetween),
      ('spaceAround', MainAxisAlignment.spaceAround),
      ('spaceEvenly', MainAxisAlignment.spaceEvenly),
      ('stretch', MainAxisAlignment.start),
      (null, MainAxisAlignment.start),
    ]) {
      await pumpComponents(tester, [
        _flex('root', 'Column', ['a'], justify: justify),
        _text('a', 'A'),
      ], catalog: _catalog);
      expect(flex().mainAxisAlignment, expected, reason: justify);
    }
    for (final (String? align, CrossAxisAlignment expected) in [
      ('start', CrossAxisAlignment.start),
      ('center', CrossAxisAlignment.center),
      ('end', CrossAxisAlignment.end),
      ('stretch', CrossAxisAlignment.stretch),
      (null, CrossAxisAlignment.stretch),
    ]) {
      await pumpComponents(tester, [
        _flex('root', 'Column', ['a'], align: align),
        _text('a', 'A'),
      ], catalog: _catalog);
      expect(flex().crossAxisAlignment, expected, reason: align);
    }
  });

  testWidgets('stretches its children on a bounded cross axis by default', (
    tester,
  ) async {
    for (final (String type, SurfaceHost host, double Function(Size) cross) in [
      ('Row', boundedHost, (size) => size.height),
      ('Column', scrollingHost, (size) => size.width),
    ]) {
      await pumpComponents(
        tester,
        [
          _flex('root', type, ['a']),
          _text('a', 'A'),
        ],
        catalog: _catalog,
        host: host,
      );

      expect(
        cross(_size(tester, 'A')),
        cross(tester.getSize(find.byType(A2uiSurface))),
        reason: type,
      );
    }
  });

  testWidgets('aligns its children to the start on an unbounded cross axis', (
    tester,
  ) async {
    const longer = 'Longer\nLonger';
    for (final (String type, SurfaceHost host) in [
      ('Row', scrollingHost),
      ('Column', unboundedWidthHost),
    ]) {
      await pumpComponents(
        tester,
        [
          _flex('root', type, ['a', 'b']),
          _text('a', 'A'),
          _text('b', longer),
        ],
        catalog: _catalog,
        host: host,
      );

      expect(tester.takeException(), isNull, reason: type);
      expect(tester.getTopLeft(find.text('A')), Offset.zero, reason: type);
      final Size a = _size(tester, 'A');
      final Size b = _size(tester, longer);
      expect(a.width, lessThan(b.width), reason: type);
      expect(a.height, lessThan(b.height), reason: type);
    }
  });

  testWidgets('ignores weights on an unbounded main axis', (tester) async {
    for (final (String type, SurfaceHost host) in [
      ('Row', unboundedWidthHost),
      ('Column', scrollingHost),
      ('List', boundedHost),
    ]) {
      await pumpComponents(
        tester,
        [
          _flex('root', type, ['a', 'b']),
          _text('a', 'A', weight: 1),
          _text('b', 'B', weight: 3),
        ],
        catalog: _catalog,
        host: host,
      );

      expect(tester.takeException(), isNull, reason: type);
      final Rect a = tester.getRect(find.text('A'));
      final Rect b = tester.getRect(find.text('B'));
      expect(b.size, a.size, reason: type);
      expect(
        type == 'Row' ? b.left - a.right : b.top - a.bottom,
        flexGap,
        reason: type,
      );
    }
  });

  testWidgets('lays each input out at a finite width under an unbounded '
      'width', (tester) async {
    for (final Map<String, Object?> input in [
      {'component': 'TextField', 'label': 'Name'},
      {'component': 'CheckBox', 'label': 'Agree', 'value': false},
      {
        'component': 'ChoicePicker',
        'options': [
          {'label': 'Apple', 'value': 'apple'},
        ],
        'value': <String>[],
      },
      {'component': 'Slider', 'max': 10, 'value': 1},
      {'component': 'DateTimeInput', 'value': '2025-07-15'},
    ]) {
      await pumpComponents(
        tester,
        [
          {'id': 'root', ...input},
        ],
        catalog: _catalog,
        host: unboundedWidthHost,
      );

      expect(tester.takeException(), isNull, reason: '${input['component']}');
      expect(
        tester.getSize(find.byType(A2uiSurface)).width,
        lessThanOrEqualTo(_width),
        reason: '${input['component']}',
      );
    }
  });

  group('Row', () {
    testWidgets('positions children by justify', (tester) async {
      for (final justify in ['start', 'center', 'end', 'spaceBetween']) {
        await pumpComponents(tester, [
          _flex('root', 'Row', ['a', 'b'], justify: justify),
          _text('a', 'A'),
          _text('b', 'B'),
        ], catalog: _catalog);

        final double aLeft = tester.getTopLeft(find.text('A')).dx;
        final double bRight = tester.getTopRight(find.text('B')).dx;
        final double content =
            _size(tester, 'A').width + flexGap + _size(tester, 'B').width;
        switch (justify) {
          case 'start':
            expect(aLeft, 0);
          case 'center':
            expect(aLeft, moreOrLessEquals((_width - content) / 2));
          case 'end':
            expect(bRight, moreOrLessEquals(_width));
          case 'spaceBetween':
            expect(aLeft, 0);
            expect(bRight, moreOrLessEquals(_width));
        }
      }
    });

    testWidgets('divides the free width by weight', (tester) async {
      await pumpComponents(tester, [
        _flex('root', 'Row', ['label', 'a', 'b']),
        _text('label', 'Label'),
        _text('a', 'A', weight: 1),
        _text('b', 'B', weight: 2),
      ], catalog: _catalog);

      final double free = _width - 2 * flexGap - _size(tester, 'Label').width;
      expect(_size(tester, 'A').width, moreOrLessEquals(free / 3));
      expect(_size(tester, 'B').width, moreOrLessEquals(free * 2 / 3));
      expect(tester.takeException(), isNull);
    });

    testWidgets('renders a weight too large for a flex factor', (tester) async {
      await pumpComponents(tester, [
        _flex('root', 'Row', ['a', 'b']),
        _text('a', 'A', weight: 1e308),
        _text('b', 'B', weight: 1),
      ], catalog: _catalog);

      expect(tester.takeException(), isNull);
      expect(
        _size(tester, 'A').width,
        greaterThan(_size(tester, 'B').width * 1000),
      );
    });

    testWidgets('keeps a child without a weight to an equal share next to '
        'a weighted one', (tester) async {
      final String long = List.filled(60, 'long').join(' ');
      await pumpComponents(
        tester,
        [
          _flex('root', 'Row', ['field', 'text', 'fill']),
          {'id': 'field', 'component': 'Input', 'value': 'note'},
          _text('text', long),
          _text('fill', 'Fill', weight: 1),
        ],
        catalog: basicTestCatalog([
          BasicComponents.row,
          BasicComponents.text,
          fixtureCatalog().components['Input']!,
        ]),
      );

      expect(tester.takeException(), isNull);
      final double share = (_width - 2 * flexGap) / 3;
      expect(
        tester.getSize(find.byType(TextField)).width,
        moreOrLessEquals(share),
      );
      expect(_size(tester, long).width, lessThanOrEqualTo(share));
      expect(tester.getTopRight(find.text('Fill')).dx, _width);
    });

    testWidgets('follows weights that updates to its children alone add, '
        'change and remove', (tester) async {
      final SurfaceHarness harness = await pumpComponents(tester, [
        _flex('root', 'Row', ['a', 'b']),
        _text('a', 'A'),
        _text('b', 'B'),
      ], catalog: _catalog);
      expect(_size(tester, 'A').width, lessThan(_width / 4));

      await harness.send([
        updateComponents([
          _text('a', 'A', weight: 1),
          _text('b', 'B', weight: 1),
        ]),
      ]);
      final double free = _width - flexGap;
      expect(_size(tester, 'A').width, moreOrLessEquals(free / 2));

      await harness.send([
        updateComponents([_text('a', 'A', weight: 3)]),
      ]);
      expect(_size(tester, 'A').width, moreOrLessEquals(free * 3 / 4));
      expect(_size(tester, 'B').width, moreOrLessEquals(free / 4));

      await harness.send([
        updateComponents([_text('a', 'A'), _text('b', 'B')]),
      ]);
      expect(_size(tester, 'A').width, lessThan(_width / 4));
    });

    testWidgets('shares the width equally between long texts', (tester) async {
      final String first = List.filled(30, 'first').join(' ');
      final String second = List.filled(50, 'second').join(' ');
      await pumpComponents(tester, [
        _flex('root', 'Row', ['a', 'b']),
        _text('a', first),
        _text('b', second),
      ], catalog: _catalog);

      expect(tester.takeException(), isNull);
      final double half = (_width - flexGap) / 2;
      expect(_size(tester, first).width, moreOrLessEquals(half, epsilon: 0.01));
      expect(
        _size(tester, second).width,
        moreOrLessEquals(half, epsilon: 0.01),
      );
    });

    testWidgets('gives the rest of the width to a Column next to a child of '
        'its own width', (tester) async {
      final String long = List.filled(40, 'body').join(' ');
      // An image without an http url is a broken-image icon at its size.
      for (final (Map<String, Object?> own, Finder content) in [
        ({'component': 'Icon', 'name': 'home'}, find.byType(Icon)),
        (
          {
            'component': 'Button',
            'child': 'label',
            'action': {
              'event': {'name': 'send'},
            },
          },
          find.byType(OutlinedButton),
        ),
        (
          {'component': 'CheckBox', 'label': 'Agree', 'value': false},
          find.text('Agree'),
        ),
        for (final variant in ['icon', 'avatar'])
          (
            {'component': 'Image', 'url': 'photo.png', 'variant': variant},
            find.byType(Icon),
          ),
      ]) {
        await pumpComponents(tester, [
          _flex('root', 'Row', ['own', 'body']),
          {'id': 'own', ...own},
          if (own['component'] == 'Button') _text('label', 'Send'),
          _flex('body', 'Column', ['text']),
          _text('text', long),
        ], catalog: _catalog);

        expect(tester.takeException(), isNull, reason: '$own');
        final Rect text = tester.getRect(find.text(long));
        expect(
          text.left,
          moreOrLessEquals(tester.getTopRight(content).dx + flexGap),
          reason: '$own',
        );
        expect(
          text.right,
          moreOrLessEquals(_width, epsilon: 0.01),
          reason: '$own',
        );
      }
    });

    testWidgets('narrows text in a nested Row', (tester) async {
      final String long = List.filled(40, 'nested').join(' ');
      await pumpComponents(tester, [
        _flex('root', 'Row', ['label', 'inner']),
        _text('label', 'Outer'),
        _flex('inner', 'Column', ['row']),
        _flex('row', 'Row', ['name', 'value']),
        _text('name', 'Name:'),
        _text('value', long),
      ], catalog: _catalog);

      expect(tester.takeException(), isNull);
      expect(tester.getTopRight(find.text(long)).dx, lessThanOrEqualTo(_width));
    });

    testWidgets('keeps a child state when the children are reordered', (
      tester,
    ) async {
      final log = FixtureLog();
      final SurfaceHarness harness = await pumpComponents(
        tester,
        [
          _flex('root', 'Row', ['a', 'p']),
          _text('a', 'A'),
          {'id': 'p', 'component': 'Probe', 'label': 'Probe'},
        ],
        catalog: basicTestCatalog([
          BasicComponents.row,
          BasicComponents.text,
          fixtureCatalog(log).components['Probe']!,
        ]),
      );

      await harness.send([
        updateComponents([
          _flex('root', 'Row', ['p', 'a']),
        ]),
      ]);

      expect(
        tester.getTopLeft(find.text('Probe')).dx,
        lessThan(tester.getTopLeft(find.text('A')).dx),
      );
      expect(log.probeStates, ['p']);
    });

    testWidgets('is as wide as its children inside a centered or end-aligned '
        'Column', (tester) async {
      for (final (String align, double at) in [('center', 0.5), ('end', 1)]) {
        await pumpComponents(tester, [
          _flex('root', 'Column', ['title', 'row'], align: align),
          _text('title', 'Title'),
          _flex('row', 'Row', ['left', 'right']),
          _text('left', 'Left'),
          _text('right', 'Right'),
        ], catalog: _catalog);

        final double left = tester.getTopLeft(find.text('Left')).dx;
        final double right = tester.getTopRight(find.text('Right')).dx;
        expect(
          left + (right - left) * at,
          moreOrLessEquals(_width * at),
          reason: align,
        );
        final Rect title = tester.getRect(find.text('Title'));
        expect(
          title.left + title.width * at,
          moreOrLessEquals(_width * at),
          reason: align,
        );
      }
    });

    testWidgets('shares the width between children that fill it', (
      tester,
    ) async {
      await pumpComponents(
        tester,
        [
          _flex('root', 'Row', ['field', 'meter', 'send']),
          {'id': 'field', 'component': 'Input', 'value': 'note'},
          {'id': 'meter', 'component': 'Meter'},
          _text('send', 'Send'),
        ],
        catalog: basicTestCatalog([
          BasicComponents.row,
          BasicComponents.text,
          fixtureCatalog().components['Input']!,
          _plain('Meter', (context) => const LinearProgressIndicator()),
        ]),
      );

      expect(tester.takeException(), isNull);
      expect(
        tester.getSize(find.byType(TextField)).width,
        moreOrLessEquals(
          tester.getSize(find.byType(LinearProgressIndicator)).width,
        ),
      );
      expect(tester.getTopRight(find.text('Send')).dx, lessThan(_width));
    });
  });

  group('Column', () {
    testWidgets('keeps the gap between children', (tester) async {
      await pumpComponents(tester, [
        _flex('root', 'Column', ['a', 'b']),
        _text('a', 'A'),
        _text('b', 'B'),
      ], catalog: _catalog);

      expect(
        tester.getTopLeft(find.text('B')).dy,
        tester.getBottomLeft(find.text('A')).dy + flexGap,
      );
    });

    testWidgets('divides a bounded height by weight', (tester) async {
      await pumpComponents(
        tester,
        [
          _flex('root', 'Column', ['a', 'b']),
          _text('a', 'A', weight: 1),
          _text('b', 'B', weight: 2),
        ],
        catalog: _catalog,
        host: boundedHost,
      );

      final double height = tester.getSize(find.byType(A2uiSurface)).height;
      expect(
        _size(tester, 'A').height,
        moreOrLessEquals((height - flexGap) / 3),
      );
      expect(
        _size(tester, 'B').height,
        moreOrLessEquals((height - flexGap) * 2 / 3),
      );
    });

    testWidgets('renders in an AlertDialog at a fixed width', (tester) async {
      await pumpComponents(
        tester,
        [
          _flex('root', 'Column', ['title', 'body']),
          _text('title', 'Title'),
          _text('body', 'Body'),
        ],
        catalog: _catalog,
        host: (surfaces) => Center(
          child: AlertDialog(
            content: SizedBox(width: 400, child: surfaces.single),
          ),
        ),
      );

      expect(tester.takeException(), isNull);
      expect(_size(tester, 'Body').width, 400);
    });
  });
}
