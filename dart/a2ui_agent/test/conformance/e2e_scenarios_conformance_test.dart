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

import 'suites.dart';

const Map<String, Set<String>> _knownKeys = {
  'scenario': {
    ...caseMetadataKeys,
    'protocolVersion',
    'catalogPaths',
    'formats',
    'source',
    'turns',
  },
  'source': {'kind', 'from', 'model', 'recordedAt'},
  'turn': {
    'userText',
    'modelChunks',
    'expectWire',
    'expectViewTree',
    'expectErrors',
    'uiOps',
    'expectDataModel',
    'expectOutbound',
  },
  'uiOp': {'op', 'surfaceId', 'targetNode', 'inputValue', 'userActivation'},
};

void main() {
  final List<String> suitePaths = _findE2eSuites();
  if (suitePaths.isEmpty) {
    throw StateError('Expected E2E suites in conformance/e2e');
  }

  for (final String suitePath in suitePaths) {
    group('conformance $suitePath', () {
      final List<Map<String, Object?>> scenarios = loadSuite(suitePath);
      test('suite is not empty', () => expect(scenarios, isNotEmpty));
      for (final Map<String, Object?> scenario in scenarios) {
        final name = scenario['name']! as String;
        test(name, () => _runScenario(scenario));
      }
    });
  }
}

List<String> _findE2eSuites() {
  final e2eDir = Directory('$conformanceRoot/e2e');
  if (!e2eDir.existsSync()) return const [];
  final List<String> paths = [
    for (final FileSystemEntity entity in e2eDir.listSync(recursive: true))
      if (entity is File && entity.path.endsWith('.yaml'))
        entity.path.substring(conformanceRoot.length + 1).replaceAll(r'\', '/'),
  ]..sort();
  return paths;
}

void _assertScenarioKeys(Map<String, Object?> scenario) {
  final name = scenario['name'] as String? ?? '<unnamed>';
  expect(scenario['action'], 'e2e_scenario');
  assertKnownKeys(scenario, _knownKeys['scenario']!, 'scenario($name)');
  if (scenario['source'] case final Map<String, Object?> source) {
    assertKnownKeys(source, _knownKeys['source']!, 'scenario($name).source');
  }
  final turns = scenario['turns']! as List<Object?>;
  expect(turns, isNotEmpty);
  for (final (int turnIdx, Object? rawTurn) in turns.indexed) {
    final turn = rawTurn! as Map<String, Object?>;
    assertKnownKeys(
      turn,
      _knownKeys['turn']!,
      'scenario($name).turns[$turnIdx]',
    );
    if (turn['uiOps'] case final List<Object?> uiOps) {
      for (final (int opIdx, Object? rawOp) in uiOps.indexed) {
        assertKnownKeys(
          rawOp! as Map<String, Object?>,
          _knownKeys['uiOp']!,
          'scenario($name).turns[$turnIdx].uiOps[$opIdx]',
        );
      }
    }
  }
}

A2uiProtocolVersion _parseProtocolVersion(String rawVersion) =>
    rawVersion.startsWith('v0.9') || rawVersion.startsWith('0.9')
    ? A2uiProtocolVersion.v0_9
    : A2uiProtocolVersion.v1_0;

List<CatalogApi> _loadScenarioCatalogs(
  Map<String, Object?> scenario,
  A2uiProtocolVersion version,
) {
  final String repoRoot = Directory(conformanceRoot).parent.path;
  final catalogPaths = scenario['catalogPaths']! as List<Object?>;
  return [
    for (final Object? rawPath in catalogPaths)
      () {
        final path = rawPath! as String;
        final inConformance = File('$conformanceRoot/$path');
        final File file = inConformance.existsSync()
            ? inConformance
            : File('$repoRoot/$path');
        final document =
            jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
        return InMemoryCatalogProvider(
          document,
          catalogId: document.containsKey('catalogId') ? null : path,
          protocolVersion: document.containsKey('protocolVersion')
              ? null
              : version,
        ).load();
      }(),
  ];
}

Parser _buildParser(
  String formatName,
  List<CatalogApi> catalogs,
  A2uiProtocolVersion version,
) => switch (formatName) {
  'direct_json' => DirectJsonFormatFactory(
    bufferIncompleteComponents: version == A2uiProtocolVersion.v1_0,
  ).createFormat(catalogs).createParser(),
  'express' => ExpressFormatFactory().createFormat(catalogs).createParser(),
  _ => throw UnsupportedError('Unknown inference format: $formatName'),
};

List<Object?> _mergeAdjacentText(List<Object?> parts) {
  final merged = <Object?>[];
  for (final Object? part in parts) {
    if (merged.isNotEmpty &&
        merged.last is Map<String, Object?> &&
        part is Map<String, Object?> &&
        (merged.last as Map<String, Object?>).containsKey('text') &&
        part.containsKey('text')) {
      final prev = Map<String, Object?>.from(
        merged.last as Map<String, Object?>,
      );
      prev['text'] = '${prev['text']}${part['text']}';
      merged[merged.length - 1] = prev;
    } else {
      merged.add(part);
    }
  }
  return merged;
}

void _runFormat(
  Map<String, Object?> scenario,
  String formatName,
  List<CatalogApi> catalogs,
  A2uiProtocolVersion version,
) {
  final Parser parser = _buildParser(formatName, catalogs, version);
  final streamState = RendererState(catalogs);
  final singleShotState = RendererState(catalogs);
  try {
    final turns = scenario['turns']! as List<Object?>;
    for (final (int turnIdx, Object? rawTurn) in turns.indexed) {
      final turn = rawTurn! as Map<String, Object?>;
      final modelChunks = turn['modelChunks']! as Map<String, Object?>;
      final rawChunks = modelChunks[formatName] as List<Object?>?;
      expect(
        rawChunks,
        isNotNull,
        reason: 'turn $turnIdx missing chunks for $formatName',
      );
      final List<String> chunks = rawChunks!.cast<String>();
      final expectWire = turn['expectWire']! as List<Object?>;

      for (final Object? rawPart in expectWire) {
        final part = rawPart! as Map<String, Object?>;
        if (part['a2ui'] case final List<Object?> messages) {
          for (final Object? rawMsg in messages) {
            final msg = rawMsg! as Map<String, Object?>;
            if (msg['updateComponents']
                case final Map<String, Object?> updateComp) {
              final sid = updateComp['surfaceId']! as String;
              final createMsg = CreateSurfaceMessage(
                version: version == A2uiProtocolVersion.v0_9_1
                    ? 'v0.9'
                    : version.jsonValue,
                surfaceId: sid,
                catalogId: catalogs.first.id,
              );
              if (streamState.getSurface(sid) == null) {
                streamState.apply([createMsg]);
              }
              if (singleShotState.getSurface(sid) == null) {
                singleShotState.apply([createMsg]);
              }
            }
          }
        }
      }

      final ResponseStream stream = parser.openStream(state: streamState);
      final streamed = <StreamPart>[];
      for (final String chunk in chunks) {
        streamed.addAll(stream.feed(chunk));
      }
      streamed.addAll(stream.close());
      expect(
        _mergeAdjacentText(partsAsWritten(streamed)),
        expectWire,
        reason: '[$formatName] turn $turnIdx streaming wire',
      );

      final List<ResponsePart> singleShot = parser.parseResponse(
        chunks.join(),
        state: singleShotState,
      );
      expect(
        _mergeAdjacentText(partsAsWritten(singleShot)),
        expectWire,
        reason: '[$formatName] turn $turnIdx single-shot wire',
      );
    }
  } finally {
    streamState.dispose();
    singleShotState.dispose();
  }
}

Object? _materializeOutbound(Object? value, [String key = '']) {
  if (value is List<Object?>) {
    return [for (final Object? item in value) _materializeOutbound(item, key)];
  }
  if (value is Map<String, Object?>) {
    if (value.length == 1 && value.containsKey(r'$match')) {
      final Object? kind = value[r'$match'];
      if (kind == 'iso8601' || key == 'timestamp') {
        return '2026-01-01T00:00:00Z';
      }
      if (key == 'functionCallId') {
        return 'call-1';
      }
      return 'match-str';
    }
    return <String, Object?>{
      for (final MapEntry<String, Object?> entry in value.entries)
        entry.key: _materializeOutbound(entry.value, entry.key),
    };
  }
  return value;
}

void _verifyOutboundRoundtrip(
  Map<String, Object?> scenario,
  A2uiProtocolVersion version,
) {
  final turns = scenario['turns']! as List<Object?>;
  for (final (int turnIdx, Object? rawTurn) in turns.indexed) {
    final turn = rawTurn! as Map<String, Object?>;
    final expectOutbound = turn['expectOutbound'] as List<Object?>?;
    if (expectOutbound == null) continue;
    for (final (int outIdx, Object? rawEnvelope) in expectOutbound.indexed) {
      final concrete =
          _materializeOutbound(rawEnvelope)! as Map<String, Object?>;
      final RendererToAgentMessage parsed = parseInboundMessage(
        concrete,
        version,
      );
      final String expectedKind = concrete.containsKey('action')
          ? 'action'
          : 'error';
      expect(
        getInboundMessageKind(parsed),
        expectedKind,
        reason: 'turn $turnIdx expectOutbound[$outIdx] kind',
      );
      final String? formatted = formatInboundForModel(parsed);
      expect(
        formatted != null && formatted.trim().isNotEmpty,
        isTrue,
        reason: 'turn $turnIdx expectOutbound[$outIdx] formatted model input',
      );
      if (expectedKind == 'action') {
        final action = concrete['action']! as Map<String, Object?>;
        expect(formatted, contains(action['name']! as String));
        expect(formatted, contains(action['surfaceId']! as String));
        final context = action['context'] as Map<String, Object?>? ?? const {};
        for (final MapEntry<String, Object?> entry in context.entries) {
          expect(formatted, contains(entry.key));
          expect(formatted, contains('${entry.value}'));
        }
      } else {
        final error = concrete['error']! as Map<String, Object?>;
        expect(formatted, contains(error['code']! as String));
      }
    }
  }
}

void _runScenario(Map<String, Object?> scenario) {
  _assertScenarioKeys(scenario);
  final A2uiProtocolVersion version = _parseProtocolVersion(
    (scenario['protocolVersion'] as String?) ?? '1.0',
  );
  _verifyOutboundRoundtrip(scenario, version);
  final List<CatalogApi> catalogs = _loadScenarioCatalogs(scenario, version);
  final formats = (scenario['formats']! as List<Object?>).cast<String>();
  final failures = <String>[];

  for (final String formatName in formats) {
    try {
      _runFormat(scenario, formatName, catalogs, version);
    } on Object catch (error, stackTrace) {
      failures.add('[$formatName] $error\n$stackTrace');
    }
  }

  if (failures.isNotEmpty) {
    fail(failures.join('\n\n'));
  }
}
