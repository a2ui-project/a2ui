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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

import 'suites.dart';

const String _defaultCatalogPath =
    'test_data/catalogs/simplified_catalog_v1_0.json';

const Map<String, Set<String>> _knownKeys = {
  'case:renderer_state_turns': {...caseMetadataKeys, 'catalogs', 'turns'},
  'turn:renderer_state_turns': {
    'format',
    'payload',
    'response',
    'expect_surfaces',
    'expectError',
    'expect_error',
  },
  'expect_surface:renderer_state_turns': {'components', 'data'},
};

const String _noSystemFunctions =
    'v0.9 defines no system functions, so a call to @index runs as written '
    'in v1.0 only.';

const Map<String, String> _v1OnlyCases = {
  'test_renderer_state_express_index_at_root_rejected': _noSystemFunctions,
  'test_renderer_state_direct_json_index_on_static_child_rejected':
      _noSystemFunctions,
  'test_renderer_state_shared_template_and_static_child_index_rejected':
      _noSystemFunctions,
  'test_renderer_state_template_and_nested_static_child_index_accepted_'
          'and_orphan_preserved':
      _noSystemFunctions,
};

void main() {
  const path = 'agent/renderer_state.yaml';
  final allCaseNames = <String>{};
  for (final SuiteVersion version in SuiteVersion.values) {
    group('conformance $path ${version.label}', () {
      final List<Map<String, Object?>> cases = loadSuite(path);
      test('suite is not empty', () => expect(cases, isNotEmpty));
      for (final testCase in cases) {
        final name = testCase['name']! as String;
        allCaseNames.add(name);
        test(name, () {
          if (version == SuiteVersion.v0_9) {
            if (_v1OnlyCases[name] case final String reason) {
              markTestSkipped(reason);
              return;
            }
            final args = <String, Object?>{
              'catalogs': testCase['catalogs'] ?? const [_defaultCatalogPath],
            };
            if (caseCatalogVersion(args) case final String catVer
                when catVer == '0.8' ||
                    catVer == 'v0.8' ||
                    catVer == '0.9' ||
                    catVer == 'v0.9') {
              markTestSkipped('Case already targets protocol version $catVer.');
              return;
            }
          }
          _runCase(testCase, version);
        });
      }
    });
  }
  verifyNoUnusedEntries('renderer_state', allCaseNames, _v1OnlyCases.keys);
}

void _runCase(Map<String, Object?> testCase, SuiteVersion version) {
  expect(testCase['action'], 'renderer_state_turns');
  assertKnownKeys(
    testCase,
    _knownKeys['case:renderer_state_turns']!,
    'case:renderer_state_turns',
  );
  final List<CatalogApi> catalogs = version.catalogs({
    'catalogs': testCase['catalogs'] ?? const [_defaultCatalogPath],
  });
  final String? injectedId = version == SuiteVersion.v0_9
      ? catalogs.first.id
      : null;
  final state = RendererState(catalogs);

  final turns = testCase['turns']! as List<Object?>;
  for (final rawTurn in turns) {
    final turn = rawTurn! as Map<String, Object?>;
    assertKnownKeys(
      turn,
      _knownKeys['turn:renderer_state_turns']!,
      'turn:renderer_state_turns',
    );
    final Object? error = turn['expect_error'] ?? turn['expectError'];
    final void Function() applyTurn;
    if (turn['payload'] case final List<Object?> rawPayload) {
      final List<AgentToRendererMessage> messages = version.messages(
        rawPayload,
      );
      applyTurn = () =>
          state.transaction(() => state.checkTopology(state.apply(messages)));
    } else {
      final formatName = (turn['format'] ?? 'direct_json') as String;
      final isExpress = formatName == 'express';
      final InferenceFormat format = isExpress
          ? const ExpressFormatFactory().createFormat(catalogs)
          : const DirectJsonFormatFactory().createFormat(catalogs);
      final Parser parser = format.createParser();
      final rawResponse = turn['response']! as String;
      final String? catId = rawResponse.contains('"catalogId"')
          ? null
          : injectedId;
      final String turnInput = isExpress
          ? rawResponse
          : version.text(rawResponse, catalogId: catId);
      applyTurn = () => parser.parseResponse(turnInput, state: state);
    }
    if (error != null) {
      expectThrowsCategory(applyTurn, error);
      continue;
    }
    applyTurn();
    if (turn['expect_surfaces']
        case final Map<String, Object?> expectSurfaces) {
      _assertExpectedSurfaces(state, expectSurfaces, version);
    }
  }
}

void _assertExpectedSurfaces(
  RendererState state,
  Map<String, Object?> expectSurfaces,
  SuiteVersion version,
) {
  expect(state.surfaceIds.toSet(), expectSurfaces.keys.toSet());
  for (final MapEntry<String, Object?>(:String key, :Object? value)
      in expectSurfaces.entries) {
    final expectedSurface = value! as Map<String, Object?>;
    assertKnownKeys(
      expectedSurface,
      _knownKeys['expect_surface:renderer_state_turns']!,
      'expect_surfaces.$key',
    );
    final SurfaceModel<ComponentApi>? surface = state.getSurface(key);
    expect(surface, isNotNull, reason: 'Missing surface $key');
    if (expectedSurface['components']
        case final Map<String, Object?> expectedComps) {
      expect(surface!.componentsModel.keys.toSet(), expectedComps.keys.toSet());
      for (final MapEntry<String, Object?>(
            key: String compId,
            value: Object? expVal,
          )
          in expectedComps.entries) {
        final expectedComp = expVal! as Map<String, Object?>;
        final ComponentModel? comp = surface.componentsModel.get(compId);
        expect(comp, isNotNull, reason: 'Missing component $compId on $key');
        expect({
          'component': comp!.type,
          ...version.liftProperties(comp.properties),
        }, expectedComp);
      }
    }
    if (expectedSurface.containsKey('data')) {
      final Object actualData =
          surface!.dataModel.get('/') ?? const <String, Object?>{};
      expect(actualData, expectedSurface['data']);
    }
  }
}
