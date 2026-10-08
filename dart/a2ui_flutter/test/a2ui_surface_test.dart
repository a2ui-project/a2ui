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
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture_catalog.dart';

void main() {
  group('A2uiSurface on a surface model', () {
    late FixtureLog log;

    setUp(() => log = FixtureLog());

    SurfaceModel<ComponentImplementation> surface([String id = 's']) {
      final s = SurfaceModel<ComponentImplementation>(
        id,
        defaultCatalog: fixtureCatalog(log),
      );
      addTearDown(s.dispose);
      return s;
    }

    void add(
      SurfaceModel<ComponentImplementation> surface,
      String id,
      String type,
      Map<String, Object?> properties,
    ) {
      surface.componentsModel.addComponent(
        ComponentModel(id, type, properties),
      );
    }

    Widget host(SurfaceModel<ComponentImplementation> surface) => MaterialApp(
      home: Scaffold(body: A2uiSurface(surface: surface)),
    );

    ComponentNode<ComponentImplementation> nodeOf(String componentId) =>
        log.nodes[componentId]!;

    testWidgets('shows a progress indicator until the root arrives', (
      tester,
    ) async {
      final SurfaceModel<ComponentImplementation> s = surface();

      await tester.pumpWidget(host(s));
      expect(log.builds, isEmpty);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      add(s, 'root', 'Text', {'text': 'Root'});
      await tester.pump();

      expect(find.text('Root'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });

    testWidgets('moves to a new resolver when given another surface', (
      tester,
    ) async {
      final SurfaceModel<ComponentImplementation> a = surface('a');
      add(a, 'root', 'Probe', {'label': 'From a'});
      final SurfaceModel<ComponentImplementation> b = surface('b');
      add(b, 'root', 'Probe', {'label': 'From b'});

      await tester.pumpWidget(host(a));
      final ComponentNode<ComponentImplementation> rootA = nodeOf('root');

      await tester.pumpWidget(host(b));

      expect(find.text('From b'), findsOneWidget);
      expect(rootA.disposed, isTrue);
      expect(log.probeStates, ['root', 'root']);
    });

    testWidgets('applies a change made during a build after the frame', (
      tester,
    ) async {
      final SurfaceModel<ComponentImplementation> s = surface();
      s.dataModel.set('/message', 'Before');
      add(s, 'root', 'Text', {
        'text': {'path': '/message'},
      });
      var changed = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Column(
              children: [
                A2uiSurface(surface: s),
                Builder(
                  builder: (context) {
                    if (!changed) {
                      changed = true;
                      s.dataModel.set('/message', 'After');
                    }
                    return const SizedBox();
                  },
                ),
              ],
            ),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
      await tester.pump();

      expect(find.text('After'), findsOneWidget);
    });

    testWidgets('reports a mount-time diagnostic to a listener that defers '
        'its setState', (tester) async {
      final SurfaceModel<ComponentImplementation> s = surface();
      add(s, 'root', 'Bogus', {});

      await tester.pumpWidget(MaterialApp(home: _ErrorCountingHost(s)));
      expect(tester.takeException(), isNull);
      await tester.pump();

      expect(find.text('errors: 1'), findsOneWidget);
      expect(find.text('Unknown component type "Bogus"'), findsOneWidget);
    });
  });
}

/// A host that counts its surface's errors and defers the resulting
/// `setState`, since an error can arrive while the surface builds.
class _ErrorCountingHost extends StatefulWidget {
  const _ErrorCountingHost(this.surface);

  final SurfaceModel<ComponentImplementation> surface;

  @override
  State<_ErrorCountingHost> createState() => _ErrorCountingHostState();
}

class _ErrorCountingHostState extends State<_ErrorCountingHost> {
  int _errors = 0;

  void _onError(A2uiClientError error) {
    SchedulerBinding.instance.addPostFrameCallback((_) {
      if (mounted) setState(() => _errors++);
    });
  }

  @override
  void initState() {
    super.initState();
    widget.surface.onError.addListener(_onError);
  }

  @override
  void dispose() {
    widget.surface.onError.removeListener(_onError);
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
