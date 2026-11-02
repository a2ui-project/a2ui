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

import 'package:a2ui_cli/a2ui_cli.dart';
import 'package:path/path.dart' as p;
import 'package:test/test.dart';

String _findRepoRoot() {
  Directory dir = Directory.current;
  while (!File(p.join(dir.path, 'pubspec.yaml')).existsSync() ||
      !Directory(p.join(dir.path, 'specification')).existsSync()) {
    final Directory parent = dir.parent;
    if (parent.path == dir.path) break;
    dir = parent;
  }
  return dir.path;
}

Future<({int exitCode, String stdout, String stderr})> _captureCli(
  List<String> args,
) async {
  final stdoutBuf = StringBuffer();
  final stderrBuf = StringBuffer();

  final int exitCode = await runCli(args, stdout: stdoutBuf, stderr: stderrBuf);

  return (
    exitCode: exitCode,
    stdout: stdoutBuf.toString(),
    stderr: stderrBuf.toString(),
  );
}

AnalysedCatalog _analyzeSingleComponent(
  String name,
  Map<String, Object?> componentSchema,
) {
  final catalog = CodegenCatalog.fromJson(<String, Object?>{
    'catalogId':
        'https://a2ui.org/specification/v1_0/catalogs/test/single.json',
    'protocolVersion': '1.0',
    'components': <String, Object?>{name: componentSchema},
  });
  return CatalogAnalyzer.analyzeCodegen(catalog);
}

void main() {
  final String repoRoot = _findRepoRoot();
  final String fixturePath = p.join(
    repoRoot,
    'dart/a2ui_cli/test/fixtures/catalogs/a11y_labels.json',
  );
  final String basicV1CatalogPath = p.join(
    repoRoot,
    'catalogs/basic/v1/catalog.json',
  );

  group('lintAccessibilityLabels heuristic', () {
    test('reports a component with an action and no label property', () {
      final AnalysedCatalog analysed = _analyzeSingleComponent('IconTap', {
        'type': 'object',
        'properties': {
          'component': {'const': 'IconTap'},
          'action': {r'$ref': r'common_types.json#/$defs/Action'},
        },
        'required': ['component', 'action'],
      });

      expect(
        lintAccessibilityLabels(analysed),
        equals([
          const LabelLintFinding(component: 'IconTap', reason: 'action'),
        ]),
      );
      expect(
        lintAccessibilityLabels(analysed, strict: true),
        equals([
          const LabelLintFinding(component: 'IconTap', reason: 'action'),
        ]),
      );
    });

    test(
      'passes a Checkable component with optional label by default and reports it under strict',
      () {
        final AnalysedCatalog analysed = _analyzeSingleComponent('RangeInput', {
          'type': 'object',
          'allOf': [
            {r'$ref': r'common_types.json#/$defs/Checkable'},
            {
              'type': 'object',
              'properties': {
                'component': {'const': 'RangeInput'},
                'label': {r'$ref': r'common_types.json#/$defs/DynamicString'},
                'value': {r'$ref': r'common_types.json#/$defs/DynamicNumber'},
              },
              'required': ['component', 'value'],
            },
          ],
        });

        expect(lintAccessibilityLabels(analysed), isEmpty);
        expect(
          lintAccessibilityLabels(analysed, strict: true),
          equals([
            const LabelLintFinding(component: 'RangeInput', reason: 'input'),
          ]),
        );
      },
    );

    test('passes an interactive component with a required child reference', () {
      final AnalysedCatalog analysed = _analyzeSingleComponent('ActionButton', {
        'type': 'object',
        'properties': {
          'component': {'const': 'ActionButton'},
          'child': {r'$ref': r'common_types.json#/$defs/Child'},
          'action': {r'$ref': r'common_types.json#/$defs/Action'},
        },
        'required': ['component', 'child', 'action'],
      });

      expect(lintAccessibilityLabels(analysed), isEmpty);
      expect(lintAccessibilityLabels(analysed, strict: true), isEmpty);
    });

    test(
      'reports an interactive component whose only string property is value',
      () {
        final AnalysedCatalog analysed = _analyzeSingleComponent(
          'BareTextInput',
          {
            'type': 'object',
            'allOf': [
              {r'$ref': r'common_types.json#/$defs/Checkable'},
              {
                'type': 'object',
                'properties': {
                  'component': {'const': 'BareTextInput'},
                  'value': {r'$ref': r'common_types.json#/$defs/DynamicString'},
                },
                'required': ['component', 'value'],
              },
            ],
          },
        );

        expect(
          lintAccessibilityLabels(analysed),
          equals([
            const LabelLintFinding(component: 'BareTextInput', reason: 'input'),
          ]),
        );
        expect(
          lintAccessibilityLabels(analysed, strict: true),
          equals([
            const LabelLintFinding(component: 'BareTextInput', reason: 'input'),
          ]),
        );
      },
    );

    test(
      'passes an interactive component with an array of objects declaring label',
      () {
        final AnalysedCatalog analysed = _analyzeSingleComponent('Picker', {
          'type': 'object',
          'allOf': [
            {r'$ref': r'common_types.json#/$defs/Checkable'},
            {
              'type': 'object',
              'properties': {
                'component': {'const': 'Picker'},
                'options': {
                  'type': 'array',
                  'items': {
                    'type': 'object',
                    'properties': {
                      'label': {
                        r'$ref': r'common_types.json#/$defs/DynamicString',
                      },
                      'value': {'type': 'string'},
                    },
                    'required': ['label', 'value'],
                  },
                },
                'value': {
                  r'$ref': r'common_types.json#/$defs/DynamicStringList',
                },
              },
              'required': ['component', 'options', 'value'],
            },
          ],
        });

        expect(lintAccessibilityLabels(analysed), isEmpty);
        expect(lintAccessibilityLabels(analysed, strict: true), isEmpty);
      },
    );

    test(
      'reports under strict when an array of objects has only an optional label',
      () {
        final AnalysedCatalog analysed = _analyzeSingleComponent(
          'OptionalItemPicker',
          {
            'type': 'object',
            'allOf': [
              {r'$ref': r'common_types.json#/$defs/Checkable'},
              {
                'type': 'object',
                'properties': {
                  'component': {'const': 'OptionalItemPicker'},
                  'options': {
                    'type': 'array',
                    'items': {
                      'type': 'object',
                      'properties': {
                        'label': {
                          r'$ref': r'common_types.json#/$defs/DynamicString',
                        },
                        'value': {'type': 'string'},
                      },
                      'required': ['value'],
                    },
                  },
                  'value': {
                    r'$ref': r'common_types.json#/$defs/DynamicStringList',
                  },
                },
                'required': ['component', 'options', 'value'],
              },
            ],
          },
        );

        expect(lintAccessibilityLabels(analysed), isEmpty);
        expect(
          lintAccessibilityLabels(analysed, strict: true),
          equals([
            const LabelLintFinding(
              component: 'OptionalItemPicker',
              reason: 'input',
            ),
          ]),
        );
      },
    );

    test('evaluates the a11y_labels.json fixture across all branches', () {
      final catalogJson =
          jsonDecode(File(fixturePath).readAsStringSync())
              as Map<String, dynamic>;
      final AnalysedCatalog analysed = CatalogAnalyzer.analyzeCodegen(
        CodegenCatalog.fromJson(catalogJson),
      );

      expect(
        lintAccessibilityLabels(analysed),
        equals([
          const LabelLintFinding(component: 'IconAction', reason: 'action'),
          const LabelLintFinding(component: 'ValueOnlyField', reason: 'input'),
        ]),
      );

      expect(
        lintAccessibilityLabels(analysed, strict: true),
        equals([
          const LabelLintFinding(component: 'IconAction', reason: 'action'),
          const LabelLintFinding(
            component: 'OptionalLabelInput',
            reason: 'input',
          ),
          const LabelLintFinding(component: 'ValueOnlyField', reason: 'input'),
        ]),
      );
    });
  });

  group('a2ui lint CLI command', () {
    test('exits 1 and prints warnings for unignored findings', () async {
      final ({int exitCode, String stdout, String stderr}) result =
          await _captureCli(['lint', '--catalog', fixturePath]);

      expect(result.exitCode, equals(1));
      expect(result.stdout, isEmpty);
      expect(
        result.stderr,
        contains(
          'warning: IconAction: accepts action but declares no text-bearing property',
        ),
      );
      expect(
        result.stderr,
        contains(
          'warning: ValueOnlyField: accepts input but declares no text-bearing property',
        ),
      );
      expect(result.stderr, isNot(contains('OptionalLabelInput')));
    });

    test('--strict reports components whose label is optional', () async {
      final ({int exitCode, String stdout, String stderr}) result =
          await _captureCli(['lint', '--catalog', fixturePath, '--strict']);

      expect(result.exitCode, equals(1));
      expect(
        result.stderr,
        contains(
          'warning: OptionalLabelInput: accepts input but declares no text-bearing property',
        ),
      );
    });

    test('--ignore acknowledges findings and exits 0', () async {
      final ({int exitCode, String stdout, String stderr}) result =
          await _captureCli([
            'lint',
            '--catalog',
            fixturePath,
            '--ignore',
            'IconAction',
            '--ignore',
            'ValueOnlyField',
          ]);

      expect(result.exitCode, equals(0));
      expect(result.stderr, isEmpty);
      expect(result.stdout, contains('ignored: IconAction'));
      expect(result.stdout, contains('ignored: ValueOnlyField'));
    });

    test('stale --ignore entry emits warning and exits 0', () async {
      final ({int exitCode, String stdout, String stderr}) result =
          await _captureCli([
            'lint',
            '--catalog',
            fixturePath,
            '--ignore',
            'IconAction',
            '--ignore',
            'ValueOnlyField',
            '--ignore',
            'ChildButton',
          ]);

      expect(result.exitCode, equals(0));
      expect(result.stdout, contains('ignored: IconAction'));
      expect(result.stdout, contains('ignored: ValueOnlyField'));
      expect(
        result.stderr,
        contains('warning: ChildButton: listed in --ignore but has no finding'),
      );
    });

    test(
      'basic v1 catalog passes with zero findings by default and reports DateTimeInput and Slider under --strict',
      () async {
        final ({int exitCode, String stdout, String stderr}) defaultResult =
            await _captureCli(['lint', '--catalog', basicV1CatalogPath]);

        expect(defaultResult.exitCode, equals(0));
        expect(defaultResult.stdout, isEmpty);
        expect(defaultResult.stderr, isEmpty);

        final ({int exitCode, String stdout, String stderr}) strictResult =
            await _captureCli([
              'lint',
              '--catalog',
              basicV1CatalogPath,
              '--strict',
            ]);

        expect(strictResult.exitCode, equals(1));
        expect(
          strictResult.stderr.trim().split('\n'),
          equals([
            'warning: DateTimeInput: accepts input but declares no text-bearing property',
            'warning: Slider: accepts input but declares no text-bearing property',
          ]),
        );
      },
    );

    test('displays lint command help with lint --help', () async {
      final ({int exitCode, String stdout, String stderr}) result =
          await _captureCli(['lint', '--help']);

      expect(result.exitCode, equals(0));
      expect(result.stdout, contains('--catalog'));
      expect(result.stdout, contains('--strict'));
      expect(result.stdout, contains('--ignore'));
    });

    test('exits 1 when catalog file does not exist', () async {
      final ({int exitCode, String stdout, String stderr}) result =
          await _captureCli(['lint', '--catalog', '/nonexistent/catalog.json']);

      expect(result.exitCode, equals(1));
      expect(result.stderr, contains('Error: Catalog file not found at:'));
    });

    test('exits 1 on malformed JSON or invalid catalog schema', () async {
      final Directory tmpDir = Directory.systemTemp.createTempSync(
        'lint-test-bad-',
      );
      try {
        final badJsonFile = File(p.join(tmpDir.path, 'malformed.json'))
          ..writeAsStringSync('{not valid json');
        final ({int exitCode, String stdout, String stderr}) badJsonResult =
            await _captureCli(['lint', '--catalog', badJsonFile.path]);
        expect(badJsonResult.exitCode, equals(1));
        expect(
          badJsonResult.stderr,
          contains('Error reading or parsing catalog JSON:'),
        );

        final badCatalogFile = File(p.join(tmpDir.path, 'bad_catalog.json'))
          ..writeAsStringSync(
            jsonEncode(<String, Object?>{
              'catalogId': 'bad_catalog',
              'protocolVersion': '1.0',
              'components': <String, Object?>{
                'Surface': {'type': 'object'},
              },
            }),
          );
        final ({int exitCode, String stdout, String stderr}) badCatalogResult =
            await _captureCli(['lint', '--catalog', badCatalogFile.path]);
        expect(badCatalogResult.exitCode, equals(1));
        expect(badCatalogResult.stderr, contains('Error analyzing catalog:'));
      } finally {
        tmpDir.deleteSync(recursive: true);
      }
    });
  });
}
