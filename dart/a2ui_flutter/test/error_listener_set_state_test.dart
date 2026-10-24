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

void main() {
  for (final processorListener in [false, true]) {
    final variant = processorListener ? 'processor' : 'surface';

    testWidgets('a $variant error listener may call setState directly', (
      tester,
    ) async {
      final processor = MessageProcessor<ComponentImplementation>(
        catalogs: [basicCatalog()],
        defaultVersion: A2uiProtocolVersion.v0_9,
      );
      addTearDown(processor.model.dispose);
      processor.processMessages(
        AgentToRendererMessagePayload.fromJson([
          {
            'version': 'v0.9',
            'createSurface': {'surfaceId': 's', 'catalogId': basicCatalog().id},
          },
          {
            'version': 'v0.9',
            'updateComponents': {
              'surfaceId': 's',
              'components': [
                {'id': 'root', 'component': 'Bogus'},
              ],
            },
          },
        ], protocolVersion: A2uiProtocolVersion.v0_9),
      );
      final SurfaceModel<ComponentImplementation> surface = processor.model
          .getSurface('s')!;

      await tester.pumpWidget(
        MaterialApp(
          home: _ErrorCountingHost(
            surface,
            processorListener ? processor.model.onError : surface.onError,
          ),
        ),
      );
      expect(tester.takeException(), isNull);
      await tester.pump();

      expect(tester.takeException(), isNull);
      expect(find.text('errors: 1'), findsOneWidget);
    });

    testWidgets(
      'a $variant error listener may call setState for a malformed check rule',
      (tester) async {
        final processor = MessageProcessor<ComponentImplementation>(
          catalogs: [basicCatalog()],
          defaultVersion: A2uiProtocolVersion.v0_9,
        );
        addTearDown(processor.model.dispose);
        processor.processMessages(
          AgentToRendererMessagePayload.fromJson([
            {
              'version': 'v0.9',
              'createSurface': {
                'surfaceId': 's',
                'catalogId': basicCatalog().id,
              },
            },
          ], protocolVersion: A2uiProtocolVersion.v0_9),
        );
        final SurfaceModel<ComponentImplementation> surface = processor.model
            .getSurface('s')!;
        surface.componentsModel.addComponent(
          ComponentModel('root', 'TextField', {
            'label': 'Name',
            'checks': [42],
          }),
        );

        await tester.pumpWidget(
          MaterialApp(
            home: _ErrorCountingHost(
              surface,
              processorListener ? processor.model.onError : surface.onError,
            ),
          ),
        );
        expect(tester.takeException(), isNull);
        await tester.pump();

        expect(tester.takeException(), isNull);
        expect(find.text('errors: 1'), findsOneWidget);
      },
    );
  }
}

/// Counts the errors [errors] emits with a plain `setState`, as an app would.
class _ErrorCountingHost extends StatefulWidget {
  const _ErrorCountingHost(this.surface, this.errors);

  final SurfaceModel<ComponentImplementation> surface;
  final EventSource<A2uiRendererError> errors;

  @override
  State<_ErrorCountingHost> createState() => _ErrorCountingHostState();
}

class _ErrorCountingHostState extends State<_ErrorCountingHost> {
  int _errors = 0;
  late final Subscription _subscription;

  @override
  void initState() {
    super.initState();
    _subscription = widget.errors.subscribe((_) => setState(() => _errors++));
  }

  @override
  void dispose() {
    _subscription.unsubscribe();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Column(
      children: [
        Text('errors: $_errors'),
        A2uiSurface(surface: widget.surface),
      ],
    ),
  );
}
