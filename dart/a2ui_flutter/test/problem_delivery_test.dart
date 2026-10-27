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

Map<String, Object?> _create(String surfaceId) => {
  'version': 'v0.9',
  'createSurface': {'surfaceId': surfaceId, 'catalogId': basicCatalog().id},
};

Map<String, Object?> _root(String surfaceId, String type) => {
  'version': 'v0.9',
  'updateComponents': {
    'surfaceId': surfaceId,
    'components': [
      {'id': 'root', 'component': type, 'text': 'ready'},
    ],
  },
};

void main() {
  late MessageProcessor<ComponentImplementation> processor;

  setUp(() {
    processor = MessageProcessor<ComponentImplementation>(
      catalogs: [basicCatalog()],
      defaultVersion: A2uiProtocolVersion.v0_9,
    );
    addTearDown(processor.model.dispose);
  });

  SurfaceModel<ComponentImplementation> surface(String id) =>
      processor.model.getSurface(id)!;

  testWidgets('every surface a jump builds and drops reports', (tester) async {
    const count = 200;
    processor.processMessages([
      for (var i = 0; i < count; i++) ...[
        _create('s$i'),
        _root('s$i', 'Bogus'),
      ],
    ]);
    final reported = <String>{};
    for (var i = 0; i < count; i++) {
      surface(
        's$i',
      ).onError.subscribe((error) => reported.add(error.surfaceId!));
    }
    final controller = ScrollController();
    addTearDown(controller.dispose);
    final built = <int>{};
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ListView.builder(
            controller: controller,
            itemCount: count,
            itemBuilder: (context, index) {
              built.add(index);
              return SizedBox(
                height: 100,
                child: A2uiSurface(surface: surface('s$index')),
              );
            },
          ),
        ),
      ),
    );

    controller.jumpTo(4700);
    await tester.pump();

    expect(built, containsAll(<int>[0, 47]));
    expect(reported, {for (final index in built) 's$index'});
  });

  testWidgets('a mounted surface error is delivered after a deleteSurface in '
      'the same payload', (tester) async {
    processor.processMessages([_create('s'), _root('s', 'Text')]);
    final errors = <String>[];
    final SurfaceModel<ComponentImplementation> s = surface('s');
    s.onError.subscribe((error) => errors.add(error.code));
    final mounted = ValueNotifier<bool>(true);
    addTearDown(mounted.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ValueListenableBuilder(
            valueListenable: mounted,
            builder: (context, mounted, _) =>
                mounted ? A2uiSurface(surface: s) : const SizedBox(),
          ),
        ),
      ),
    );
    expect(find.text('ready'), findsOneWidget);

    processor.processMessages([
      _root('s', 'Bogus'),
      {
        'version': 'v0.9',
        'deleteSurface': {'surfaceId': 's'},
      },
    ]);
    mounted.value = false;
    await tester.pump();

    expect(errors, ['UNKNOWN_COMPONENT_TYPE']);
  });
}
