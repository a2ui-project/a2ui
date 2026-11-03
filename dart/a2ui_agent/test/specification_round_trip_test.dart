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

/// Decompiles each published basic catalog example into each format,
/// compiles it back, and checks that a renderer ends up holding the same
/// surfaces, as `conformance/README.md` asks of every format.
///
/// Direct JSON writes every example as it is. Express names a component by
/// the variable holding it and has no notation for `sendDataModel`, so each
/// example is first given ids made of letters, digits and underscores, and
/// `sendDataModel` is left out. The examples Express cannot write at all are
/// listed with the reason, and checked to fail.
void main() {
  group('v0.9 basic catalog', () {
    _roundTrips(
      basic: const FileSystemCatalogProvider(
        '../../specification/v0_9/catalogs/basic/catalog.json',
        protocolVersion: A2uiProtocolVersion.v0_9,
      ).load(),
      examples: '../../specification/v0_9/catalogs/basic/examples',
    );
  });

  group('v1.0 basic catalog', () {
    _roundTrips(
      basic: const FileSystemCatalogProvider(
        '../../catalogs/basic/v1/catalog.json',
      ).load(),
      examples: '../../catalogs/basic/v1/examples',
    );
  });
}

/// Round-trips each example in the directory [examples] through each format
/// bound to [basic].
///
/// [expressCannotWrite] names the examples Express cannot write, with the
/// reason.
void _roundTrips({
  required CatalogApi basic,
  required String examples,
  Map<String, String> expressCannotWrite = const {},
}) {
  final A2uiProtocolVersion version = basic.protocolVersion!;
  final List<File> files =
      Directory(examples)
          .listSync()
          .whereType<File>()
          .where((f) => f.path.endsWith('.json'))
          .toList()
        ..sort((a, b) => a.path.compareTo(b.path));

  test('finds the examples', () => expect(files, isNotEmpty));

  for (final file in files) {
    final String name = file.uri.pathSegments.last;
    final document =
        jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
    final String? skip = document['customComponents'] == null
        ? null
        : 'Uses components the basic catalog does not declare.';
    final List<AgentToRendererMessage> messages = _parse(
      document['messages']! as List<Object?>,
      version,
    );

    group(name, skip: skip, () {
      test('round-trips through direct JSON', () {
        final Parser parser = const DirectJsonFormatFactory().createFormat([
          basic,
        ]).createParser();
        final List<AgentToRendererMessage> recompiled = [
          for (final List<AgentToRendererMessage> payload in _payloads(
            name,
            messages,
          ))
            ...parser.compile(parser.decompile(payload)),
        ];
        expect(_json(recompiled), _json(messages));
      });

      test('round-trips through Express', () {
        final Parser parser = const ExpressFormatFactory().createFormat([
          basic,
        ]).createParser();
        final List<AgentToRendererMessage> written = _forExpress(
          messages,
          version,
        );
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

/// Examples whose later updates replace a placeholder and leave it
/// unreachable, which one payload may not do, since every surface it creates
/// must be whole once it is applied.
const Set<String> _incremental = {'31_incremental-dashboard.json'};

/// The payloads the example [name] arrives in: its [messages] as one, or for
/// an [_incremental] example, the surface and its first components, then
/// each later update in a payload of its own, as later responses send them.
List<List<AgentToRendererMessage>> _payloads(
  String name,
  List<AgentToRendererMessage> messages,
) => _incremental.contains(name)
    ? [
        messages.take(2).toList(),
        for (final AgentToRendererMessage message in messages.skip(2))
          [message],
      ]
    : [messages];

List<AgentToRendererMessage> _parse(
  List<Object?> json,
  A2uiProtocolVersion version,
) => AgentToRendererMessage.parseAll(
  json.cast<Map<String, Object?>>(),
  protocolVersion: version,
).messages;

List<Object?> _json(List<AgentToRendererMessage> messages) =>
    jsonDecode(jsonEncode([for (final m in messages) m.toJson()]))
        as List<Object?>;

/// [messages] with each component id written with underscores for hyphens,
/// and without `sendDataModel`.
List<AgentToRendererMessage> _forExpress(
  List<AgentToRendererMessage> messages,
  A2uiProtocolVersion version,
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
  return _parse(jsonDecode(text) as List<Object?>, version);
}

/// The surfaces a renderer holds after applying [messages]: for each, its
/// catalog, its components and its data model.
Map<String, Object?> _render(
  CatalogApi catalog,
  List<AgentToRendererMessage> messages,
) {
  final MessageProcessor<ComponentApi> renderer = MessageProcessor.forAgent(
    catalogs: [catalog],
    // Some examples replace a placeholder and leave it unreachable.
    validationConfig: ValidationConfig.relaxed,
  );
  addTearDown(renderer.model.dispose);
  renderer.processMessages(AgentToRendererMessagePayload(messages));
  return {
    for (final SurfaceModel<ComponentApi> surface in renderer.model.allSurfaces)
      surface.id: {
        'catalog': surface.defaultCatalog?.id,
        'components': {
          for (final ComponentModel component in surface.componentsModel.all)
            component.id: component.toJson(),
        },
        'data': surface.dataModel.get('/'),
      },
  };
}
