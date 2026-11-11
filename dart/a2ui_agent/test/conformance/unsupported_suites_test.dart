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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

import 'suites.dart';

/// Conformance suites executed in the default test run by the per-suite
/// `*_conformance_test.dart` files.
const Set<String> activeAgentSuites = {
  'agent/agent_functions.yaml',
  'agent/catalog_provider.yaml',
  'agent/catalog_resolution.yaml',
  'agent/catalog_transformer.yaml',
  'agent/direct_json/compiler.yaml',
  'agent/direct_json/decompiler.yaml',
  'agent/direct_json/prompt_generator.yaml',
  'agent/direct_json/response_parser.yaml',
  'agent/direct_json/response_streaming.yaml',
  'agent/express/compiler.yaml',
  'agent/express/decompiler.yaml',
  'agent/express/prompt_generator.yaml',
  'agent/express/response_parser.yaml',
  'agent/express/response_streaming.yaml',
  'agent/multi_catalog_formats.yaml',
  'agent/renderer_capabilities.yaml',
  'agent/renderer_function_calls.yaml',
  'agent/renderer_state.yaml',
  'agent/request_processor.yaml',
  'agent/streamed_answer.yaml',
};

/// Timing suites tagged `performance` and executed in the performance CI job
/// via `dart test -P performance` (`scaling_conformance_test.dart`).
const Set<String> performanceAgentSuites = {
  'agent/direct_json/scaling.yaml',
  'agent/express/scaling.yaml',
};

/// `agent/**/*.yaml` suites not implemented by `a2ui_agent` for Dart,
/// paired with the reason recorded in the executed-case manifest.
const Map<String, String> unsupportedAgentSuites = {
  'agent/atom/compiler.yaml':
      'Elemental and Atom are experimental and Python-only',
  'agent/builder/builder.yaml':
      'The fluent builder AST suite targets the Python builder API, which '
      'a2ui_agent for Dart does not implement.',
  'agent/legacy/inference_format.yaml':
      'Pre-blueprint legacy suite retained only for backward compatibility; '
      'superseded by the current agent suites.',
  'agent/legacy/parser.yaml':
      'Pre-blueprint legacy suite retained only for backward compatibility; '
      'superseded by the current agent suites.',
  'agent/elemental/compiler.yaml':
      'Elemental and Atom are experimental and Python-only',
  'agent/legacy/streaming_parser.yaml':
      'Pre-blueprint legacy suite retained only for backward compatibility; '
      'superseded by the current agent suites.',
  'agent/macros/macros.yaml':
      'The composite macro suite targets the Python macro API, which '
      'a2ui_agent for Dart does not implement.',
  'agent/skill.yaml':
      'a2ui_agent for Dart does not implement the skill generation API.',
};

Set<String> _discoverAgentSuites() {
  final agentDir = Directory('$conformanceRoot/agent');
  final suites = <String>{};
  for (final FileSystemEntity entity in agentDir.listSync(recursive: true)) {
    if (entity is File && entity.path.endsWith('.yaml')) {
      final String relative = entity.path
          .substring(conformanceRoot.length + 1)
          .replaceAll(r'\', '/');
      suites.add(relative);
    }
  }
  return suites;
}

void main() {
  group('agent suite coverage and unsupported suites', () {
    test('accounts for every conformance/agent/**/*.yaml file', () {
      final Set<String> onDisk = _discoverAgentSuites();
      final Set<String> unsupported = unsupportedAgentSuites.keys.toSet();
      expect(
        activeAgentSuites.intersection(unsupported),
        isEmpty,
        reason:
            'A suite cannot be in both activeAgentSuites and '
            'unsupportedAgentSuites.',
      );
      expect(
        activeAgentSuites.intersection(performanceAgentSuites),
        isEmpty,
        reason:
            'A suite cannot be in both activeAgentSuites and '
            'performanceAgentSuites.',
      );
      expect(
        performanceAgentSuites.intersection(unsupported),
        isEmpty,
        reason:
            'A suite cannot be in both performanceAgentSuites and '
            'unsupportedAgentSuites.',
      );
      expect(
        activeAgentSuites.union(performanceAgentSuites).union(unsupported),
        equals(onDisk),
        reason:
            'Every conformance/agent/**/*.yaml file must be in '
            'activeAgentSuites, performanceAgentSuites, or '
            'unsupportedAgentSuites.',
      );
    });

    for (final MapEntry<String, String>(:String key, :String value)
        in unsupportedAgentSuites.entries) {
      test('$key records skipped manifest entries with a reason', () {
        final String reason = value.trim();
        expect(reason, isNotEmpty);
        final List<Map<String, Object?>> cases = loadSuite(key);
        expect(cases, isNotEmpty);
        for (final testCase in cases) {
          final name = (testCase['id'] ?? testCase['name'])! as String;
          recordCase(key, name, status: 'skipped', reason: reason);
        }
      });
    }
  });

  group('recordCase', () {
    test(
      'merges outcomes across SuiteVersions and preserves v0.9 skip reasons',
      () {
        final Directory tempDir = Directory.systemTemp.createTempSync(
          'a2ui_agent_manifest_test_',
        );
        addTearDown(() => tempDir.deleteSync(recursive: true));

        recordCase(
          'agent/sample.yaml',
          'case_both_pass',
          status: 'passed',
          version: SuiteVersion.v0_9,
          manifestDir: tempDir.path,
        );
        recordCase(
          'agent/sample.yaml',
          'case_both_pass',
          status: 'passed',
          version: SuiteVersion.v1_0,
          manifestDir: tempDir.path,
        );

        recordCase(
          'agent/sample.yaml',
          'case_v09_skipped_v10_passed',
          status: 'skipped',
          reason: 'v0.9 cannot state what the case carries.',
          version: SuiteVersion.v0_9,
          manifestDir: tempDir.path,
        );
        recordCase(
          'agent/sample.yaml',
          'case_v09_skipped_v10_passed',
          status: 'passed',
          version: SuiteVersion.v1_0,
          manifestDir: tempDir.path,
        );

        recordCase(
          'agent/sample.yaml',
          'case_either_failed',
          status: 'passed',
          version: SuiteVersion.v0_9,
          manifestDir: tempDir.path,
        );
        recordCase(
          'agent/sample.yaml',
          'case_either_failed',
          status: 'failed',
          reason: 'Expected 1, got 2.',
          version: SuiteVersion.v1_0,
          manifestDir: tempDir.path,
        );

        final List<File> files = tempDir.listSync().whereType<File>().toList();
        expect(files, hasLength(1));
        final List<Map<String, Object?>> records = files.single
            .readAsLinesSync()
            .map((line) => jsonDecode(line) as Map<String, Object?>)
            .toList();
        expect(
          records,
          equals([
            {
              'harness': 'dart-agent',
              'suite': 'agent/sample.yaml',
              'case': 'case_both_pass',
              'status': 'passed',
            },
            {
              'harness': 'dart-agent',
              'suite': 'agent/sample.yaml',
              'case': 'case_v09_skipped_v10_passed',
              'status': 'passed',
              'reason': 'v0.9 cannot state what the case carries.',
            },
            {
              'harness': 'dart-agent',
              'suite': 'agent/sample.yaml',
              'case': 'case_either_failed',
              'status': 'failed',
              'reason': 'Expected 1, got 2.',
            },
          ]),
        );
      },
    );
  });

  group('Stage 2B conformance harness lowering and lifting', () {
    test('SuiteTextLowerer lowers @child, @action, and @functionCall '
        'across chunks', () {
      final lowerer = SuiteTextLowerer(catalogId: 'cat:v09');
      const chunks = <String>[
        '<a2ui-json>[{"version": "1.0", '
            '"createSurface": {"surfaceId": "s1"}, ',
        '"updateComponents": {"surfaceId": "s1", "components": [',
        '{"id": "card", "component": "Card", "child": {"@child": "bo',
        'dy"}}, {"id": "list", "component": "List", '
            '"children": {"@child": "tpl"',
        ', "@path": "/items"}}, {"id": "btn", "component": "Button", '
            '"action": ',
        '{"@action": {"name": "go", "context": {"x": {"@path": "/x"}}}}}, ',
        '{"id": "btn2", "component": "Button", "action": {"@functionCall": ',
        '{"@call": "openUrl", "args": {"url": "https://a2ui.org"}}}}]}}, ',
        '{"version": "1.0", "updateDataModel": {"surfaceId": "s1", ',
        '"path": "/x", "value": {"@@child": "keep", '
            '"@child": "literal"}}}]</a2ui-json>',
      ];
      final lowered = StringBuffer();
      for (final chunk in chunks) {
        lowered.write(lowerer.feed(chunk));
      }
      lowered.write(lowerer.close());

      final raw = lowered.toString();
      expect(raw, startsWith('<a2ui-json>'));
      expect(raw, endsWith('</a2ui-json>'));
      final parsed =
          jsonDecode(
                raw.substring(
                  '<a2ui-json>'.length,
                  raw.length - '</a2ui-json>'.length,
                ),
              )!
              as List<Object?>;

      expect((parsed[0]! as Map)['version'], 'v0.9');
      expect(
        ((parsed[0]! as Map)['createSurface']! as Map)['catalogId'],
        'cat:v09',
      );
      final comps =
          ((parsed[0]! as Map)['updateComponents']! as Map)['components']!
              as List<Object?>;
      expect(comps[0], {'id': 'card', 'component': 'Card', 'child': 'body'});
      expect(comps[1], {
        'id': 'list',
        'component': 'List',
        'children': {'componentId': 'tpl', 'path': '/items'},
      });
      expect(comps[2], {
        'id': 'btn',
        'component': 'Button',
        'action': {
          'event': {
            'name': 'go',
            'context': {
              'x': {'path': '/x'},
            },
          },
        },
      });
      expect(comps[3], {
        'id': 'btn2',
        'component': 'Button',
        'action': {
          'functionCall': {
            'call': 'openUrl',
            'args': {'url': 'https://a2ui.org'},
          },
        },
      });
      expect(((parsed[1]! as Map)['updateDataModel']! as Map)['value'], {
        '@@child': 'keep',
        '@child': 'literal',
      });
    });

    test('lowerText handles curly quotes in version/keys and raw newlines '
        'inside @child', () {
      const smartQuoted =
          '[{“version”: “1.0”, “deleteSurface”: {“surfaceId”: “s1”}}]';
      expect(
        lowerText(smartQuoted),
        '[{“version”: “v0.9”, “deleteSurface”: {“surfaceId”: “s1”}}]',
      );

      const typographicText =
          '[{"version": "1.0", "updateComponents": {"surfaceId": "s1", '
          '"components": [{"id": "root", "component": "Text", '
          '"text": "Willkommen im „Café Central“"}]}}]';
      expect(
        lowerText(typographicText),
        '[{"version": "v0.9", "updateComponents": {"surfaceId": "s1", '
        '"components": [{"id": "root", "component": "Text", '
        '"text": "Willkommen im „Café Central“"}]}}]',
      );

      const rawNewlineChild =
              '[{"version": "1.0", "updateComponents": {"surfaceId": "s1", '
              '"components": [{"id": "root", "component": "Card", '
              '"child": {"@child": "bo\ndy"}}, '
              '{"id": "list", "component": "List", '
              '"children": {"@child": "t\npl", "@path": "/items"}}]}}]',
          expectedLowered =
              '[{"version": "v0.9", "updateComponents": {"surfaceId": "s1", '
              '"components": [{"id": "root", "component": "Card", '
              '"child": "bo\ndy"}, '
              '{"id": "list", "component": "List", '
              '"children": {"componentId": "t\npl", "path": "/items"}}]}}]';
      final String result = lowerText(rawNewlineChild);
      expect(result, expectedLowered);
    });

    test(
      'liftMessages lifts v0.9 Child, ChildList, Action, and nested Tabs Child '
      'using v1.0 catalog',
      () {
        final CatalogApi v1Catalog = Catalog.fromJson({
          'catalogId': 'test:v1',
          'protocolVersion': '1.0',
          'components': {
            'Card': {
              'type': 'object',
              'properties': {
                'component': {'const': 'Card'},
                'child': {r'$ref': r'common_types.json#/$defs/Child'},
              },
            },
            'Column': {
              'type': 'object',
              'properties': {
                'component': {'const': 'Column'},
                'children': {r'$ref': r'common_types.json#/$defs/ChildList'},
              },
            },
            'Button': {
              'type': 'object',
              'properties': {
                'component': {'const': 'Button'},
                'child': {r'$ref': r'common_types.json#/$defs/Child'},
                'action': {r'$ref': r'common_types.json#/$defs/Action'},
              },
            },
            'Tabs': {
              'type': 'object',
              'properties': {
                'component': {'const': 'Tabs'},
                'tabs': {
                  'type': 'array',
                  'items': {
                    'type': 'object',
                    'properties': {
                      'title': {'type': 'string'},
                      'child': {r'$ref': r'common_types.json#/$defs/Child'},
                    },
                  },
                },
              },
            },
          },
        });

        final List<AgentToRendererMessage> v09Messages =
            AgentToRendererMessage.parseAll([
              {
                'version': 'v0.9',
                'createSurface': {'surfaceId': 's1', 'catalogId': 'test:v1'},
              },
              {
                'version': 'v0.9',
                'updateComponents': {
                  'surfaceId': 's1',
                  'components': [
                    {'id': 'card', 'component': 'Card', 'child': 'col'},
                    {
                      'id': 'col',
                      'component': 'Column',
                      'children': ['btn', 'btn2'],
                    },
                    {
                      'id': 'list',
                      'component': 'Column',
                      'children': {'componentId': 'tpl', 'path': '/items'},
                    },
                    {
                      'id': 'btn',
                      'component': 'Button',
                      'child': 'lbl',
                      'action': {
                        'event': {
                          'name': 'save',
                          'context': {
                            'x': {'path': '/x'},
                          },
                        },
                      },
                    },
                    {
                      'id': 'btn2',
                      'component': 'Button',
                      'child': 'lbl2',
                      'action': {
                        'functionCall': {
                          'call': 'openUrl',
                          'args': {'url': 'https://a2ui.org'},
                        },
                      },
                    },
                    {
                      'id': 'tabs',
                      'component': 'Tabs',
                      'tabs': [
                        {'title': 'One', 'child': 'pane1'},
                      ],
                    },
                  ],
                },
              },
            ], protocolVersion: A2uiProtocolVersion.v0_9).messages;

        final List<Object?> lifted = liftMessages(
          v09Messages,
          join: true,
          injectedCatalogId: 'test:v1',
          catalogs: [v1Catalog],
        );
        expect(lifted, [
          {
            'version': '1.0',
            'createSurface': {
              'surfaceId': 's1',
              'components': [
                {
                  'id': 'card',
                  'component': 'Card',
                  'child': {'@child': 'col'},
                },
                {
                  'id': 'col',
                  'component': 'Column',
                  'children': {
                    '@child': ['btn', 'btn2'],
                  },
                },
                {
                  'id': 'list',
                  'component': 'Column',
                  'children': {'@child': 'tpl', '@path': '/items'},
                },
                {
                  'id': 'btn',
                  'component': 'Button',
                  'child': {'@child': 'lbl'},
                  'action': {
                    '@action': {
                      'name': 'save',
                      'context': {
                        'x': {'@path': '/x'},
                      },
                    },
                  },
                },
                {
                  'id': 'btn2',
                  'component': 'Button',
                  'child': {'@child': 'lbl2'},
                  'action': {
                    '@functionCall': {
                      '@call': 'openUrl',
                      'args': {'url': 'https://a2ui.org'},
                    },
                  },
                },
                {
                  'id': 'tabs',
                  'component': 'Tabs',
                  'tabs': [
                    {
                      'title': 'One',
                      'child': {'@child': 'pane1'},
                    },
                  ],
                },
              ],
            },
          },
        ]);
      },
    );
  });
}
