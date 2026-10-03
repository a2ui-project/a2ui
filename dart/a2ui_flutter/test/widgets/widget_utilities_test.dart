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
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('BoundObject', () {
    testWidgets('rebuilds on in-place map mutation at a parent path', (
      tester,
    ) async {
      final dataModel = InMemoryDataModel();
      dataModel.update(DataPath('/map'), <String, Object?>{'count': 1});

      await tester.pumpWidget(
        Directionality(
          textDirection: TextDirection.ltr,
          child: BoundObject(
            dataContext: DataContext(dataModel, DataPath.root),
            value: const <String, Object?>{'path': '/map'},
            builder: (context, value) {
              if (value is Map) {
                return Text('count=${value['count']}');
              }
              return const Text('no map');
            },
          ),
        ),
      );
      expect(find.text('count=1'), findsOneWidget);

      // Mutate a nested key. a2ui_core's DataModel updates the map in place
      // and bubble-notifies the parent path /map. BoundObject must rebuild
      // even though the resolved value at /map is the same Map instance.
      dataModel.update(DataPath('/map/count'), 2);
      await tester.pump();

      expect(find.text('count=2'), findsOneWidget);
    });
  });

  group('BoundList', () {
    testWidgets('rebuilds on in-place list mutation at the bound path', (
      tester,
    ) async {
      final dataModel = InMemoryDataModel();
      dataModel.update(DataPath('/items'), <Object?>['a', 'b']);

      await tester.pumpWidget(
        Directionality(
          textDirection: TextDirection.ltr,
          child: BoundList(
            dataContext: DataContext(dataModel, DataPath.root),
            value: const <String, Object?>{'path': '/items'},
            builder: (context, value) {
              if (value == null) return const Text('null');
              return Text('count=${value.length}');
            },
          ),
        ),
      );
      expect(find.text('count=2'), findsOneWidget);

      dataModel.update(DataPath('/items/2'), 'c');
      await tester.pump();

      expect(find.text('count=3'), findsOneWidget);
    });
  });
}
