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
import 'package:flutter_test/flutter_test.dart';

import 'fixture_catalog.dart';

/// The surface id the message helpers use unless given another.
const String testSurfaceId = 'main';

/// A v0.9 `createSurface` message.
Map<String, Object?> createSurface(
  String catalogId, {
  String surfaceId = testSurfaceId,
  Map<String, Object?>? theme,
}) => {
  'version': 'v0.9',
  'createSurface': {
    'surfaceId': surfaceId,
    'catalogId': catalogId,
    'theme': ?theme,
  },
};

/// A v0.9 `updateComponents` message.
Map<String, Object?> updateComponents(
  List<Map<String, Object?>> components, {
  String surfaceId = testSurfaceId,
}) => {
  'version': 'v0.9',
  'updateComponents': {'surfaceId': surfaceId, 'components': components},
};

/// A v0.9 `updateDataModel` message.
Map<String, Object?> updateDataModel(
  Object? value, {
  String path = '/',
  String surfaceId = testSurfaceId,
}) => {
  'version': 'v0.9',
  'updateDataModel': {'surfaceId': surfaceId, 'path': path, 'value': value},
};

/// A v0.9 `deleteSurface` message.
Map<String, Object?> deleteSurface({String surfaceId = testSurfaceId}) => {
  'version': 'v0.9',
  'deleteSurface': {'surfaceId': surfaceId},
};

/// Lays out the surface widgets as the test app's body.
typedef SurfaceHost = Widget Function(List<Widget> surfaces);

/// Stacks the surfaces in a vertical scroll view, the usual host: each
/// surface gets the screen's width and an unbounded height.
Widget scrollingHost(List<Widget> surfaces) => SingleChildScrollView(
  child: Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: surfaces,
  ),
);

/// Splits the screen's height between the surfaces, so each gets a tight
/// width and height.
Widget boundedHost(List<Widget> surfaces) => Column(
  crossAxisAlignment: CrossAxisAlignment.stretch,
  children: [for (final s in surfaces) Expanded(child: s)],
);

/// Puts the surfaces in a horizontal scroll view: each gets an unbounded width.
Widget unboundedWidthHost(List<Widget> surfaces) => SingleChildScrollView(
  scrollDirection: Axis.horizontal,
  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: surfaces),
);

/// A message processor whose surfaces a widget test renders.
///
/// [actions] and [errors] collect what every surface reports, in order.
class SurfaceHarness {
  SurfaceHarness._(this._tester, this.processor);

  final WidgetTester _tester;

  /// The processor the messages go through.
  final MessageProcessor<ComponentImplementation> processor;

  /// Actions dispatched by any surface.
  final List<A2uiClientAction> actions = [];

  /// Errors reported on any surface's `onError`.
  final List<A2uiClientError> errors = [];

  final ValueNotifier<List<SurfaceModel<ComponentImplementation>>> _surfaces =
      ValueNotifier(const []);

  /// The codes of [errors].
  List<String> get errorCodes => [for (final e in errors) e.code];

  /// The live surface with [surfaceId].
  SurfaceModel<ComponentImplementation> surface([
    String surfaceId = testSurfaceId,
  ]) => processor.groupModel.getSurface(surfaceId)!;

  /// The data model value at [path].
  Object? data(String path, {String surfaceId = testSurfaceId}) =>
      surface(surfaceId).dataModel.get(path);

  /// Processes [messages] without pumping a frame. Processing errors are
  /// thrown.
  void process(List<Map<String, Object?>> messages) {
    processor.processMessages(
      AgentToRendererMessagePayload.fromJson(
        messages,
        protocolVersion: A2uiProtocolVersion.v0_9,
      ),
    );
  }

  /// Processes [messages] and pumps a frame.
  Future<void> send(List<Map<String, Object?>> messages) async {
    process(messages);
    await _tester.pump();
  }
}

/// Builds a processor over [catalog] (the fixture catalog by default),
/// processes [messages], and pumps an app that renders every surface the
/// processor creates, in creation order, each in an [A2uiSurface].
///
/// A null [validationConfig] builds the processor without one.
///
/// [host] lays the surfaces out as a `Scaffold` body inside a `MaterialApp`;
/// the default scrolls. The processor is disposed when the test ends.
Future<SurfaceHarness> pumpSurface(
  WidgetTester tester,
  List<Map<String, Object?>> messages, {
  WidgetCatalog? catalog,
  ValidationConfig? validationConfig = ValidationConfig.strict,
  SurfaceHost host = scrollingHost,
}) async {
  final harness = SurfaceHarness._(
    tester,
    MessageProcessor<ComponentImplementation>(
      catalogs: [catalog ?? fixtureCatalog()],
      defaultVersion: A2uiProtocolVersion.v0_9,
      validationConfig: validationConfig,
    ),
  );
  final SurfaceGroupModel<ComponentImplementation> group =
      harness.processor.groupModel;
  group.onAction.addListener(harness.actions.add);
  group.onSurfaceCreated.addListener((surface) {
    surface.onError.addListener(harness.errors.add);
    harness._surfaces.value = [...harness._surfaces.value, surface];
  });
  group.onSurfaceDeleted.addListener((id) {
    harness._surfaces.value = [
      for (final s in harness._surfaces.value)
        if (s.id != id) s,
    ];
  });
  addTearDown(harness._surfaces.dispose);
  addTearDown(group.dispose);

  harness.process(messages);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body:
            ValueListenableBuilder<List<SurfaceModel<ComponentImplementation>>>(
              valueListenable: harness._surfaces,
              builder: (context, surfaces, _) => host([
                for (final s in surfaces)
                  A2uiSurface(key: ObjectKey(s), surface: s),
              ]),
            ),
      ),
    ),
  );
  return harness;
}

/// Creates a surface on [catalog], sets its data model to [data] when given,
/// adds [components], and pumps it, as [pumpSurface] does.
Future<SurfaceHarness> pumpComponents(
  WidgetTester tester,
  List<Map<String, Object?>> components, {
  WidgetCatalog? catalog,
  Map<String, Object?>? data,
  ValidationConfig? validationConfig = ValidationConfig.strict,
  SurfaceHost host = scrollingHost,
}) {
  final WidgetCatalog resolved = catalog ?? fixtureCatalog();
  return pumpSurface(
    tester,
    [
      createSurface(resolved.id),
      if (data != null) updateDataModel(data),
      updateComponents(components),
    ],
    catalog: resolved,
    validationConfig: validationConfig,
    host: host,
  );
}
