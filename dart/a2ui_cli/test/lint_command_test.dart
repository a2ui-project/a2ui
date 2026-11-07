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

Map<String, Object?> _v1Catalog({
  Map<String, Object?> components = const {},
  Object? functions,
  Map<String, Object?>? defs,
  Map<String, Object?>? metadata,
  Map<String, Object?> extraRoot = const {},
}) => <String, Object?>{
  'catalogId': 'https://a2ui.org/specification/v1_0/catalogs/test/catalog.json',
  'protocolVersion': '1.0',
  'metadata': ?metadata,
  r'$defs': ?defs,
  'components': components,
  'functions': ?functions,
  ...extraRoot,
};

void main() {
  final String repoRoot = _findRepoRoot();

  const canonicalCatalogRelPaths = <String>[
    'catalogs/basic/v1/catalog.json',
    'catalogs/mcp/v1/catalog.json',
    'catalogs/mcp/catalog.json',
    'catalogs/vegachart/v1/catalog.json',
    'catalogs/vegachart/v0_9/catalog.json',
    'specification/v0_9/catalogs/basic/catalog.json',
    'specification/v0_9/catalogs/minimal/catalog.json',
    'specification/v0_9_1/catalogs/basic/catalog.json',
    'specification/v1_0/test/testing_catalog.json',
  ];

  group('canonical repository catalogs', () {
    for (final relPath in canonicalCatalogRelPaths) {
      test('$relPath passes with zero errors and zero warnings', () async {
        final String fullPath = p.join(repoRoot, relPath);
        final ({int exitCode, String stdout, String stderr}) result =
            await _captureCli([
              'lint',
              '--fatal-warnings',
              '--catalog',
              fullPath,
            ]);

        expect(result.exitCode, equals(0), reason: result.stderr);
        expect(result.stdout, isEmpty);
        expect(result.stderr, isEmpty);
      });
    }

    test('all a2ui_cli catalog fixtures pass with zero findings', () {
      final fixturesDir = Directory(
        p.join(repoRoot, 'dart/a2ui_cli/test/fixtures/catalogs'),
      );
      final List<File> files =
          fixturesDir
              .listSync()
              .whereType<File>()
              .where((File f) => f.path.endsWith('.json'))
              .toList()
            ..sort((File a, File b) => a.path.compareTo(b.path));
      expect(files, isNotEmpty);
      for (final file in files) {
        final decoded =
            jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
        expect(lintCatalog(decoded), isEmpty, reason: file.path);
      }
    });
  });

  group('CatalogLintFinding value semantics', () {
    test('supports equality, hashCode, and toString formatting', () {
      const a = CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'reserved_component_name',
        message: 'Reserved Surface name.',
      );
      const b = CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'reserved_component_name',
        message: 'Reserved Surface name.',
      );
      const c = CatalogLintFinding(
        severity: LintSeverity.warning,
        code: 'redundant_component_common',
        message: 'Redundant wrapper.',
      );

      expect(a, equals(b));
      expect(a.hashCode, equals(b.hashCode));
      expect(a, isNot(equals(c)));
      expect(a.toString(), equals('error: Reserved Surface name.'));
      expect(c.toString(), equals('warning: Redundant wrapper.'));
    });
  });

  group('lintCatalog deterministic rules', () {
    test(
      'forbids reserved Surface component name while allowing it in allowedParents',
      () {
        final List<CatalogLintFinding> reservedFindings = lintCatalog(
          _v1Catalog(
            components: {
              'Surface': {
                'type': 'object',
                'properties': {
                  'component': {'const': 'Surface'},
                },
              },
            },
            defs: {
              'anyComponent': {'oneOf': <Object?>[]},
            },
          ),
        );
        expect(
          reservedFindings,
          contains(
            isA<CatalogLintFinding>()
                .having(
                  (CatalogLintFinding f) => f.severity,
                  'severity',
                  LintSeverity.error,
                )
                .having(
                  (CatalogLintFinding f) => f.code,
                  'code',
                  'reserved_component_name',
                ),
          ),
        );

        final List<CatalogLintFinding> allowedParentsFindings = lintCatalog(
          _v1Catalog(
            components: {
              'RootShell': {
                'type': 'object',
                'allowedParents': ['Surface'],
                'properties': {
                  'component': {'const': 'RootShell'},
                },
                'required': ['component'],
              },
            },
          ),
        );
        expect(allowedParentsFindings, isEmpty);
      },
    );

    test(
      'validates UAX 31 identifiers across components, properties, functions, and parameters',
      () {
        final List<CatalogLintFinding> validUnicode = lintCatalog(
          _v1Catalog(
            components: {
              'Component_ℓ1': {
                'type': 'object',
                'properties': {
                  'component': {'const': 'Component_ℓ1'},
                  '_value_1': {'type': 'string'},
                },
                'required': ['component'],
              },
            },
            functions: {
              'format_ℓ': {
                'type': 'object',
                'returnType': 'string',
                'properties': {
                  '@call': {'const': 'format_ℓ'},
                  'args': {
                    'type': 'object',
                    'properties': {
                      'input_1': {'type': 'string'},
                    },
                  },
                },
                'required': ['@call', 'args'],
              },
            },
          ),
        );
        expect(validUnicode, isEmpty);

        final List<CatalogLintFinding> invalidIdentifiers = lintCatalog(
          _v1Catalog(
            defs: {
              'SharedMixin': {
                'type': 'object',
                'properties': {
                  'bad-mixin-prop': {'type': 'string'},
                },
              },
            },
            components: {
              'Bad-Component': {
                'type': 'object',
                'allOf': [
                  {r'$ref': r'#/$defs/SharedMixin'},
                ],
                'properties': {
                  'component': {'const': 'Bad-Component'},
                  '123prop': {'type': 'string'},
                },
              },
            },
            functions: {
              '@index': {'returnType': 'number'},
              'bad-func': {
                'type': 'object',
                'returnType': 'string',
                'properties': {
                  '@call': {'const': 'bad-func'},
                  'args': {
                    'type': 'object',
                    'properties': {
                      'bad-arg!': {'type': 'string'},
                    },
                  },
                },
                'required': ['@call', 'args'],
              },
            },
          ),
        );

        expect(
          invalidIdentifiers.map((CatalogLintFinding f) => f.code),
          containsAll(<String>['invalid_identifier', 'reserved_function_name']),
        );
        expect(
          invalidIdentifiers.map((CatalogLintFinding f) => f.message),
          containsAll(<Matcher>[
            contains("component identifier 'Bad-Component'"),
            contains("property identifier '123prop'"),
            contains("property identifier 'bad-mixin-prop'"),
            contains("Function name '@index' starts with '@'"),
            contains("function identifier 'bad-func'"),
            contains("argument identifier 'bad-arg!'"),
          ]),
        );
      },
    );

    test('flags requiresUserActivation: true on agent-callable functions', () {
      final List<CatalogLintFinding> invalidFindings = lintCatalog(
        _v1Catalog(
          functions: {
            'agentPopup': {
              'type': 'object',
              'returnType': 'void',
              'requiresUserActivation': true,
              'allowedCallers': 'agentOnly',
              'properties': {
                '@call': {'const': 'agentPopup'},
              },
              'required': ['@call'],
            },
            'sharedPopup': {
              'type': 'object',
              'returnType': 'void',
              'requiresUserActivation': true,
              'allowedCallers': 'rendererOrAgent',
              'properties': {
                '@call': {'const': 'sharedPopup'},
              },
              'required': ['@call'],
            },
          },
          defs: {
            'anyFunction': {'oneOf': <Object?>[]},
          },
        ),
      );

      expect(invalidFindings, hasLength(2));
      expect(
        invalidFindings.every(
          (CatalogLintFinding f) =>
              f.severity == LintSeverity.error &&
              f.code == 'user_activation_allows_agent',
        ),
        isTrue,
      );

      final List<CatalogLintFinding> validFindings = lintCatalog(
        _v1Catalog(
          functions: {
            'openUrl': {
              'type': 'object',
              'returnType': 'void',
              'requiresUserActivation': true,
              'allowedCallers': 'rendererOnly',
              'properties': {
                '@call': {'const': 'openUrl'},
              },
              'required': ['@call'],
            },
            'copyText': {
              'type': 'object',
              'returnType': 'void',
              'requiresUserActivation': true,
              'properties': {
                '@call': {'const': 'copyText'},
              },
              'required': ['@call'],
            },
          },
        ),
      );
      expect(validFindings, isEmpty);
    });

    test(
      'warns on redundant ComponentCommon wrapping and property redeclaration in v1.0',
      () {
        final List<CatalogLintFinding> findings = lintCatalog(
          _v1Catalog(
            components: {
              'WrappedButton': {
                'type': 'object',
                'allOf': [
                  {r'$ref': r'common_types.json#/$defs/ComponentCommon'},
                  {
                    'type': 'object',
                    'properties': {
                      'component': {'const': 'WrappedButton'},
                      'accessibility': {
                        r'$ref':
                            r'common_types.json#/$defs/AccessibilityAttributes',
                      },
                    },
                    'required': ['component'],
                  },
                ],
              },
            },
          ),
        );

        expect(findings, hasLength(2));
        expect(
          findings.every(
            (CatalogLintFinding f) =>
                f.severity == LintSeverity.warning &&
                f.code == 'redundant_component_common',
          ),
          isTrue,
        );
        expect(
          findings.map((CatalogLintFinding f) => f.message),
          containsAll(<Matcher>[
            contains("wraps 'ComponentCommon'"),
            contains(
              "redeclares 'ComponentCommon' envelope property 'accessibility'",
            ),
          ]),
        );
      },
    );

    test(
      'allows single ComponentCommon in v0.9 and warns on duplicate refs or redeclared properties',
      () {
        final List<CatalogLintFinding> cleanV09 = lintCatalog(<String, Object?>{
          'catalogId': 'https://example.com/v09/catalog.json',
          'protocolVersion': '0.9.1',
          r'$defs': {
            'CatalogComponentCommon': {
              'type': 'object',
              'properties': {
                'weight': {'type': 'number'},
              },
            },
          },
          'components': {
            'Badge': {
              'type': 'object',
              'allOf': [
                {
                  r'$ref':
                      r'https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentCommon',
                },
                {r'$ref': r'#/$defs/CatalogComponentCommon'},
                {
                  'type': 'object',
                  'properties': {
                    'component': {'const': 'Badge'},
                    'text': {'type': 'string'},
                  },
                  'required': ['component', 'text'],
                },
              ],
            },
          },
        });
        expect(cleanV09, isEmpty);

        final List<CatalogLintFinding> redundantV09 = lintCatalog(
          <String, Object?>{
            'catalogId': 'https://example.com/v09/redundant.json',
            'protocolVersion': '0.9.1',
            'components': {
              'DupBadge': {
                'type': 'object',
                'allOf': [
                  {r'$ref': r'common_types.json#/$defs/ComponentCommon'},
                  {r'$ref': r'common_types.json#/$defs/ComponentCommon'},
                  {
                    'type': 'object',
                    'properties': {
                      'component': {'const': 'DupBadge'},
                      'id': {'type': 'string'},
                    },
                  },
                ],
              },
            },
          },
        );

        expect(redundantV09, hasLength(2));
        expect(
          redundantV09.every(
            (CatalogLintFinding f) =>
                f.severity == LintSeverity.warning &&
                f.code == 'redundant_component_common',
          ),
          isTrue,
        );
      },
    );

    test(
      r'validates core catalog metadata, external refs, local refs, and leaf $defs',
      () {
        final List<CatalogLintFinding> badSchemaFindings = lintCatalog(
          <String, Object?>{
            'catalogId': '',
            'protocolVersion': 'v0.8',
            'metadata': {'unexpected': true},
            r'$defs': {
              'HiddenComp': {
                'type': 'object',
                'properties': {
                  'component': {'const': 'HiddenComp'},
                },
              },
            },
            'components': {
              'UnionCard': {
                'type': 'object',
                'oneOf': [
                  {
                    'type': 'object',
                    'properties': {
                      'component': {'const': 'UnionCard'},
                    },
                  },
                ],
              },
            },
          },
        );
        expect(
          badSchemaFindings.every(
            (CatalogLintFinding f) => f.severity == LintSeverity.error,
          ),
          isTrue,
        );
        expect(badSchemaFindings.length, greaterThanOrEqualTo(4));

        final List<CatalogLintFinding> refFindings = lintCatalog(
          _v1Catalog(
            extraRoot: {'customRootKey': 'notAllowed'},
            components: {
              'ExternalWidget': {
                'type': 'object',
                'properties': {
                  'component': {'const': 'ExternalWidget'},
                  'other': {r'$ref': 'other_catalog.json#/components/Text'},
                  'missing': {r'$ref': r'#/$defs/DoesNotExist'},
                },
              },
            },
          ),
        );
        expect(
          refFindings.map((CatalogLintFinding f) => f.code),
          containsAll(<String>[
            'invalid_catalog_schema',
            'unsupported_external_ref',
            'unresolved_local_ref',
          ]),
        );
      },
    );

    test(
      'handles inline list-form functions and pre-v1.0 validationResult checks',
      () {
        final List<CatalogLintFinding> findings = lintCatalog(<String, Object?>{
          'catalogId': 'inline_fn_catalog',
          'functions': [
            {
              'name': 'checkValue',
              'returnType': 'validationResult',
              'requiresUserActivation': true,
              'allowedCallers': 'agentOnly',
              'parameters': {
                'bad-param': {'type': 'string'},
              },
            },
          ],
        });

        expect(
          findings.map((CatalogLintFinding f) => f.code),
          containsAll(<String>[
            'invalid_identifier',
            'user_activation_allows_agent',
            'invalid_catalog_schema',
          ]),
        );
      },
    );
  });

  group('a2ui lint CLI command', () {
    test('displays lint command help with lint --help', () async {
      final ({int exitCode, String stdout, String stderr}) result =
          await _captureCli(['lint', '--help']);

      expect(result.exitCode, equals(0));
      expect(result.stdout, contains('--catalog'));
      expect(result.stdout, contains('--fatal-warnings'));
    });

    test('exits 1 when catalog file does not exist', () async {
      final ({int exitCode, String stdout, String stderr}) result =
          await _captureCli(['lint', '--catalog', '/nonexistent/catalog.json']);

      expect(result.exitCode, equals(1));
      expect(result.stderr, contains('Error: Catalog file not found at:'));
    });

    test(
      'exits 0 on warnings by default and exits 1 with --fatal-warnings',
      () async {
        final Directory tmpDir = Directory.systemTemp.createTempSync(
          'lint-test-warn-',
        );
        try {
          final warnFile = File(p.join(tmpDir.path, 'warn_catalog.json'))
            ..writeAsStringSync(
              jsonEncode(
                _v1Catalog(
                  components: {
                    'LegacyWrapped': {
                      'type': 'object',
                      'allOf': [
                        {r'$ref': r'common_types.json#/$defs/ComponentCommon'},
                        {
                          'type': 'object',
                          'properties': {
                            'component': {'const': 'LegacyWrapped'},
                          },
                          'required': ['component'],
                        },
                      ],
                    },
                  },
                ),
              ),
            );

          final ({int exitCode, String stdout, String stderr}) defaultResult =
              await _captureCli(['lint', '-c', warnFile.path]);
          expect(defaultResult.exitCode, equals(0));
          expect(defaultResult.stdout, isEmpty);
          expect(
            defaultResult.stderr,
            contains(
              "warning: Component 'LegacyWrapped' wraps 'ComponentCommon'",
            ),
          );

          final ({int exitCode, String stdout, String stderr}) fatalResult =
              await _captureCli([
                'lint',
                '--fatal-warnings',
                '--catalog',
                warnFile.path,
              ]);
          expect(fatalResult.exitCode, equals(1));
          expect(
            fatalResult.stderr,
            contains(
              "warning: Component 'LegacyWrapped' wraps 'ComponentCommon'",
            ),
          );
        } finally {
          tmpDir.deleteSync(recursive: true);
        }
      },
    );

    test(
      'exits 1 on malformed JSON, non-object root, or catalog lint errors',
      () async {
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

          final arrayRootFile = File(p.join(tmpDir.path, 'array_root.json'))
            ..writeAsStringSync('[]');
          final ({int exitCode, String stdout, String stderr}) arrayRootResult =
              await _captureCli(['lint', '--catalog', arrayRootFile.path]);
          expect(arrayRootResult.exitCode, equals(1));
          expect(
            arrayRootResult.stderr,
            contains('Error: Catalog JSON root must be a JSON object'),
          );

          final badCatalogFile = File(p.join(tmpDir.path, 'bad_catalog.json'))
            ..writeAsStringSync(
              jsonEncode(
                _v1Catalog(
                  components: {
                    'Surface': {'type': 'object'},
                  },
                ),
              ),
            );
          final ({int exitCode, String stdout, String stderr})
          badCatalogResult = await _captureCli([
            'lint',
            '--catalog',
            badCatalogFile.path,
          ]);
          expect(badCatalogResult.exitCode, equals(1));
          expect(
            badCatalogResult.stderr,
            contains("error: Component name 'Surface' is reserved"),
          );
        } finally {
          tmpDir.deleteSync(recursive: true);
        }
      },
    );
  });
}
