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
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

// import 'package:a2ui_flutter/src/model/catalog.dart'; // Exceptions should be exported by genui.dart, but if not we might need this.
// Assuming CatalogItemNotFoundException is exported or available.

void main() {
  group('Catalog Exception', () {
    testWidgets(
      'buildWidget throws CatalogItemNotFoundException when item is missing',
      (tester) async {
        final catalog = const Catalog([], catalogId: 'test_catalog');

        await tester.pumpWidget(Container());
        final BuildContext context = tester.element(find.byType(Container));

        final itemContext = CatalogItemContext(
          data: {},
          id: 'test_id',
          type: 'NonExistentWidget',
          buildChild: (id, [context]) => const SizedBox(),
          dispatchEvent: (event) {},
          buildContext: context,
          dataContext: DataContext(InMemoryDataModel(), DataPath.root),
          getComponent: (id) => null,
          getCatalogItem: (type) => null,
          surfaceId: 'test_surface',
          reportError: (e, s) {},
        );

        expect(
          () => catalog.buildWidget(itemContext),
          throwsA(
            isA<CatalogItemNotFoundException>()
                .having((e) => e.widgetType, 'widgetType', 'NonExistentWidget')
                .having((e) => e.catalogId, 'catalogId', 'test_catalog')
                .having(
                  (e) => e.toString(),
                  'toString',
                  contains(
                    'CatalogItemNotFoundException: Item "NonExistentWidget" '
                    'was not found in catalog "test_catalog"',
                  ),
                ),
          ),
        );
      },
    );

    testWidgets(
      'buildWidget throws CatalogItemNotFoundException without catalogId',
      (tester) async {
        final catalog = const Catalog([]);

        await tester.pumpWidget(Container());
        final BuildContext context = tester.element(find.byType(Container));

        final itemContext = CatalogItemContext(
          data: {},
          id: 'test_id',
          type: 'MissingWidget',
          buildChild: (id, [context]) => const SizedBox(),
          dispatchEvent: (event) {},
          buildContext: context,
          dataContext: DataContext(InMemoryDataModel(), DataPath.root),
          getComponent: (id) => null,
          getCatalogItem: (type) => null,
          surfaceId: 'test_surface',
          reportError: (e, s) {},
        );

        expect(
          () => catalog.buildWidget(itemContext),
          throwsA(
            isA<CatalogItemNotFoundException>()
                .having((e) => e.widgetType, 'widgetType', 'MissingWidget')
                .having((e) => e.catalogId, 'catalogId', isNull)
                .having(
                  (e) => e.toString(),
                  'toString',
                  contains(
                    'CatalogItemNotFoundException: Item "MissingWidget" '
                    'was not found in catalog',
                  ),
                )
                .having(
                  (e) => e.toString(),
                  'toString',
                  isNot(contains('"null"')),
                ),
          ),
        );
      },
    );

    test('A2uiFunctionException toString formatting', () {
      final exc1 = A2uiFunctionException(
        'some message',
        functionName: 'myFunc',
      );
      expect(
        exc1.toString(),
        'A2uiFunctionException inside myFunc: some message',
      );

      final exc2 = A2uiFunctionException(
        'some message',
        functionName: 'myFunc',
        argumentKey: 'myArg',
      );
      expect(
        exc2.toString(),
        'A2uiFunctionException inside myFunc: some message (argument: myArg)',
      );

      final exc3 = A2uiFunctionException(
        'some message',
        functionName: 'myFunc',
        cause: 'underlying error',
      );
      expect(
        exc3.toString(),
        'A2uiFunctionException inside myFunc: some message\n'
        'Cause: underlying error',
      );

      final exc4 = A2uiFunctionException(
        'some message',
        functionName: 'myFunc',
        argumentKey: 'myArg',
        cause: 'underlying error',
      );
      expect(
        exc4.toString(),
        'A2uiFunctionException inside myFunc: some message (argument: myArg)\n'
        'Cause: underlying error',
      );
    });
  });
}
