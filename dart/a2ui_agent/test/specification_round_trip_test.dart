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

import 'dart:convert';
import 'dart:io';

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

/// Decompiles each published v0.9 basic catalog example into each format,
/// compiles it back, and checks that a renderer ends up holding the same
/// surfaces, as `conformance/README.md` asks of every format.
///
/// Direct JSON writes every example as it is. Express names a component by
/// the variable holding it and has no notation for `sendDataModel`, so each
/// example is first given ids made of letters, digits and underscores, and
/// `sendDataModel` is left out. The examples Express cannot write at all are
/// listed with the reason, and checked to fail.
void main() {
  const catalogPath = '../../specification/v0_9/catalogs/basic/catalog.json';
  final CatalogApi basic = Catalog.fromJson(
    jsonDecode(File(catalogPath).readAsStringSync()) as Map<String, Object?>,
  );
  final List<File> examples =
      Directory('../../specification/v0_9/catalogs/basic/examples')
          .listSync()
          .whereType<File>()
          .where((f) => f.path.endsWith('.json'))
          .toList()
        ..sort((a, b) => a.path.compareTo(b.path));

  const expressCannotWrite = {
    '00_complex-layout.json':
        "sets 'weight', which Express has no notation for",
    '00_incremental.json': 'updates the data model below its root',
    '30_live-invitation-builder.json':
        "sets 'weight', which Express has no notation for",
    '31_incremental-dashboard.json':
        "sets 'weight', which Express has no notation for",
    '33_financial-data-grid.json':
        "sets 'weight', which Express has no notation for",
  };

  test('finds the examples', () => expect(examples, isNotEmpty));

  for (final file in examples) {
    final String name = file.uri.pathSegments.last;
    final document =
        jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
    final String? skip = document['customComponents'] == null
        ? null
        : 'Uses components the basic catalog does not declare.';
    final List<AgentToRendererMessage> messages = _parse(
      document['messages']! as List<Object?>,
    );

    group(name, skip: skip, () {
      test('round-trips through direct JSON', () {
        final Parser parser = const DirectJsonFormatFactory().createFormat([
          basic,
        ]).createParser();
        final List<AgentToRendererMessage> recompiled = parser.compile(
          parser.decompile(messages),
        );
        expect(_json(recompiled), _json(messages));
      });

      test('round-trips through Express', () {
        final Parser parser = const ExpressFormatFactory().createFormat([
          basic,
        ]).createParser();
        final List<AgentToRendererMessage> written = _forExpress(messages);
        if (expressCannotWrite[name] case final String reason) {
          expect(
            () => parser.decompile(written),
            throwsA(isA<A2uiValidationError>()),
            reason: reason,
          );
          return;
        }
        final String express = parser.decompile(written);
        expect(
          _render(basic, parser.compile(express)),
          _render(basic, written),
          reason: 'Express written:\n$express',
        );
      });
    });
  }
}

List<AgentToRendererMessage> _parse(List<Object?> json) =>
    AgentToRendererMessage.parseAll(
      json.cast<Map<String, Object?>>(),
      protocolVersion: A2uiProtocolVersion.v0_9,
    ).messages;

List<Object?> _json(List<AgentToRendererMessage> messages) =>
    jsonDecode(jsonEncode([for (final m in messages) m.toJson()]))
        as List<Object?>;

/// [messages] with each component id written with underscores for hyphens,
/// and without `sendDataModel`.
List<AgentToRendererMessage> _forExpress(
  List<AgentToRendererMessage> messages,
) {
  String text = jsonEncode([for (final m in messages) m.toJson()]);
  final Set<String> ids = {
    for (final Match match in RegExp(r'"id":"([^"]+)"').allMatches(text))
      match[1]!,
  };
  for (final String id in ids.where((id) => id.contains('-'))) {
    text = text.replaceAll('"$id"', '"${id.replaceAll('-', '_')}"');
  }
  text = text.replaceAll('"sendDataModel":true', '"sendDataModel":false');
  return _parse(jsonDecode(text) as List<Object?>);
}

/// The surfaces a renderer holds after applying [messages]: for each, its
/// catalog, its components and its data model.
Map<String, Object?> _render(
  CatalogApi catalog,
  List<AgentToRendererMessage> messages,
) {
  final renderer = MessageProcessor<ComponentApi>(
    catalogs: [_rendererCatalog(catalog)],
    protocolVersion: A2uiProtocolVersion.v0_9,
    // Some examples replace a placeholder and leave it unreachable.
    validationConfig: ValidationConfig.relaxed,
  );
  addTearDown(renderer.groupModel.dispose);
  renderer.processMessages(AgentToRendererMessagePayload(messages));
  return {
    for (final SurfaceModel<ComponentApi> surface
        in renderer.groupModel.allSurfaces)
      surface.id: {
        'catalog': surface.catalog.id,
        'components': {
          for (final ComponentModel component in surface.componentsModel.all)
            component.id: component.toJson(),
        },
        'data': surface.dataModel.get('/'),
      },
  };
}

/// [catalog] as a catalog `MessageProcessor` can hold, with functions that
/// cannot be invoked.
Catalog<ComponentApi, FunctionImplementation> _rendererCatalog(
  CatalogApi catalog,
) => Catalog<ComponentApi, FunctionImplementation>(
  id: catalog.id,
  components: catalog.components.values.toList(),
  functions: catalog.functions.values.map(_Signature.new).toList(),
  themeSchema: catalog.themeSchema,
);

class _Signature extends FunctionImplementation {
  _Signature(FunctionApi api)
    : super(
        name: api.name,
        argumentSchema: api.argumentSchema,
        returnType: api.returnType,
      );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) => throw UnsupportedError('$name is a signature only.');
}
