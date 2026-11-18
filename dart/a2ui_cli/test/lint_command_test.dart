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
import 'package:yaml/yaml.dart';

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

Object? _yamlToJson(Object? node) {
  if (node is YamlMap) {
    return <String, Object?>{
      for (final MapEntry<Object?, Object?> entry in node.entries)
        '${entry.key}': _yamlToJson(entry.value),
    };
  }
  if (node is YamlList) {
    return <Object?>[for (final Object? item in node) _yamlToJson(item)];
  }
  return node;
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
    'catalogs/basic/v0_9/catalog.json',
    'catalogs/minimal/v0_9/catalog.json',
    'catalogs/basic/v0_9_1/catalog.json',
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
    test('supports equality, hashCode, path, and toString formatting', () {
      const a = CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'reserved_component_name',
        path: '/components/Surface',
        message: 'Reserved Surface name.',
      );
      const b = CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'reserved_component_name',
        path: '/components/Surface',
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
      expect(
        a.toString(),
        equals(
          'error[reserved_component_name] (/components/Surface): '
          'Reserved Surface name.',
        ),
      );
      expect(
        c.toString(),
        equals('warning[redundant_component_common]: Redundant wrapper.'),
      );
    });
  });

  group('lintCatalog deterministic rules', () {
    test('forbids reserved Surface component name while allowing it in '
        'allowedParents', () {
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
              )
              .having(
                (CatalogLintFinding f) => f.path,
                'path',
                '/components/Surface',
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
    });

    test(
      'enforces UAX 31 identifiers in v1.0 while allowing hyphenated names in '
      'v0.9',
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

        final List<CatalogLintFinding> validV09Hyphens = lintCatalog(
          <String, Object?>{
            'catalogId': 'https://example.com/v09/hyphen_allowed.json',
            'protocolVersion': '0.9.1',
            'components': {
              'My-Component': {
                'type': 'object',
                'properties': {
                  'component': {'const': 'My-Component'},
                  'aria-label': {'type': 'string'},
                },
              },
            },
            'functions': {
              'my-func': {
                'type': 'object',
                'properties': {
                  'call': {'const': 'my-func'},
                  'args': {
                    'type': 'object',
                    'properties': {
                      'bad-arg': {'type': 'string'},
                    },
                  },
                  'returnType': {'const': 'string'},
                },
              },
            },
          },
        );
        expect(validV09Hyphens, isEmpty);

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

    test(r'skips $-prefixed keywords in shorthand parameters and traverses '
        'anyOf/oneOf branches', () {
      final List<CatalogLintFinding> cleanShorthand = lintCatalog(
        _v1Catalog(
          functions: {
            'lookupItem': {
              'returnType': 'string',
              'parameters': {
                r'$comment': 'Shorthand map with JSON Schema keywords.',
                r'$defs': {
                  'ItemId': {'type': 'string'},
                },
                'itemId': {'type': 'string'},
              },
            },
          },
        ),
      );
      expect(cleanShorthand, isEmpty);

      final List<CatalogLintFinding> unionBranchErrors = lintCatalog(
        _v1Catalog(
          functions: {
            'unionArgs': {
              'type': 'object',
              'returnType': 'string',
              'properties': {
                '@call': {'const': 'unionArgs'},
                'args': {
                  'anyOf': [
                    {
                      'type': 'object',
                      'properties': {
                        'bad-anyof-arg': {'type': 'string'},
                      },
                    },
                  ],
                  'oneOf': [
                    {
                      'type': 'object',
                      'properties': {
                        'bad-oneof-arg': {'type': 'number'},
                      },
                    },
                  ],
                },
              },
            },
          },
        ),
      );
      expect(
        unionBranchErrors.map((CatalogLintFinding f) => f.message),
        containsAll(<Matcher>[
          contains("argument identifier 'bad-anyof-arg'"),
          contains("argument identifier 'bad-oneof-arg'"),
        ]),
      );
    });

    test(
      'flags requiresUserActivation: true on agent-callable functions in v1.0 '
      'while allowing v0.9',
      () {
        final List<CatalogLintFinding> invalidV1 = lintCatalog(
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

        expect(invalidV1, hasLength(2));
        expect(
          invalidV1.every(
            (CatalogLintFinding f) =>
                f.severity == LintSeverity.error &&
                f.code == 'user_activation_allows_agent',
          ),
          isTrue,
        );

        final List<CatalogLintFinding> validV1 = lintCatalog(
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
        expect(validV1, isEmpty);

        final List<CatalogLintFinding> validV09 = lintCatalog(<String, Object?>{
          'catalogId': 'https://example.com/v09/user_activation.json',
          'protocolVersion': 'v0.9',
          'functions': {
            'openUrl': {
              'returnType': 'void',
              'allowedCallers': 'agentOnly',
              'requiresUserActivation': true,
              'properties': {
                'call': {'const': 'openUrl'},
              },
            },
          },
        });
        expect(validV09, isEmpty);
      },
    );

    test(
      'warns on redundant ComponentCommon and FunctionCommon wrapping in v1.0',
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
            functions: {
              'wrappedFn': {
                'type': 'object',
                'returnType': 'void',
                'allOf': [
                  {r'$ref': r'common_types.json#/$defs/FunctionCommon'},
                  {
                    'type': 'object',
                    'properties': {
                      '@call': {'const': 'wrappedFn'},
                      'catalogId': {'type': 'string'},
                    },
                  },
                ],
              },
            },
          ),
        );

        expect(findings, hasLength(4));
        expect(
          findings.every(
            (CatalogLintFinding f) => f.severity == LintSeverity.warning,
          ),
          isTrue,
        );
        expect(
          findings.map((CatalogLintFinding f) => f.code),
          containsAll(<String>[
            'redundant_component_common',
            'redundant_function_common',
          ]),
        );
        expect(
          findings.map((CatalogLintFinding f) => f.message),
          containsAll(<Matcher>[
            contains("wraps 'ComponentCommon'"),
            contains(
              "redeclares 'ComponentCommon' envelope property 'accessibility'",
            ),
            contains("wraps 'FunctionCommon'"),
            contains(
              "redeclares 'FunctionCommon' envelope property 'catalogId'",
            ),
          ]),
        );
      },
    );

    test('allows single ComponentCommon in v0.9 and warns on duplicate refs or '
        'redeclared properties', () {
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
                    'https://a2ui.org/specification/v0_9/'
                    r'common_types.json#/$defs/ComponentCommon',
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
    });

    test(r'validates catalog.json#/... pointers, trailing $ref subpaths, '
        r'versioned common_types, and nested leaf $defs', () {
      final List<CatalogLintFinding> badSchemaFindings = lintCatalog(
        <String, Object?>{
          'catalogId': '',
          'protocolVersion': 'v0.8',
          'metadata': {'unexpected': true},
          r'$defs': {
            'NestedHiddenComp': {
              'type': 'object',
              'allOf': [
                {
                  'allOf': [
                    {
                      'type': 'object',
                      'properties': {
                        'component': {'const': 'NestedHiddenComp'},
                      },
                    },
                  ],
                },
              ],
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

      final List<CatalogLintFinding> v1RefFindings = lintCatalog(
        _v1Catalog(
          extraRoot: {'customRootKey': 'notAllowed'},
          defs: {
            'theme': {'type': 'object'},
            'ValidToken': {'type': 'string'},
          },
          components: {
            'ExternalWidget': {
              'type': 'object',
              'properties': {
                'component': {'const': 'ExternalWidget'},
                'okSelf': {r'$ref': r'catalog.json#/$defs/ValidToken'},
                'other': {r'$ref': 'other_catalog.json#/components/Text'},
                'missingLocal': {r'$ref': r'#/$defs/DoesNotExist'},
                'missingSelf': {r'$ref': r'catalog.json#/$defs/DoesNotExist'},
                'bogusTrailingLocal': {r'$ref': r'#/$defs/DynamicString/bogus'},
                'bogusTrailingCommon': {
                  r'$ref': r'common_types.json#/$defs/DynamicString/bogus',
                },
                'disallowedSurface': {
                  r'$ref': r'common_types.json#/$defs/Surface',
                },
                'disallowedCallId': {
                  r'$ref': r'common_types.json#/$defs/CallId',
                },
              },
            },
          },
        ),
      );
      expect(
        v1RefFindings.map((CatalogLintFinding f) => f.code),
        containsAll(<String>[
          'invalid_catalog_schema',
          'unsupported_external_ref',
          'unresolved_local_ref',
        ]),
      );
      expect(
        v1RefFindings.map((CatalogLintFinding f) => f.path),
        containsAll(<String>[
          '/customRootKey',
          r'/$defs/theme',
          r'/components/ExternalWidget/properties/other/$ref',
          r'/components/ExternalWidget/properties/missingLocal/$ref',
          r'/components/ExternalWidget/properties/missingSelf/$ref',
          r'/components/ExternalWidget/properties/bogusTrailingLocal/$ref',
          r'/components/ExternalWidget/properties/bogusTrailingCommon/$ref',
          r'/components/ExternalWidget/properties/disallowedSurface/$ref',
          r'/components/ExternalWidget/properties/disallowedCallId/$ref',
        ]),
      );
      expect(
        v1RefFindings.map((CatalogLintFinding f) => f.path),
        isNot(contains(r'/components/ExternalWidget/properties/okSelf/$ref')),
      );

      final List<CatalogLintFinding> v09DisallowedCommonRef = lintCatalog(
        <String, Object?>{
          'catalogId': 'https://example.com/v09/bad_common_ref.json',
          'protocolVersion': '0.9.1',
          'components': {
            'Card': {
              'type': 'object',
              'properties': {
                'component': {'const': 'Card'},
                'child': {r'$ref': r'common_types.json#/$defs/Child'},
              },
            },
          },
        },
      );
      expect(
        v09DisallowedCommonRef,
        contains(
          isA<CatalogLintFinding>()
              .having(
                (CatalogLintFinding f) => f.code,
                'code',
                'unresolved_local_ref',
              )
              .having(
                (CatalogLintFinding f) => f.path,
                'path',
                r'/components/Card/properties/child/$ref',
              ),
        ),
      );
    });

    test(
      'validates returnType enums, v1.0 list-form functions, and component or '
      'function const discriminators',
      () {
        final List<CatalogLintFinding> v1ListFunctions = lintCatalog(
          _v1Catalog(
            functions: [
              {'name': 'legacyListFn', 'returnType': 'string'},
            ],
          ),
        );
        expect(
          v1ListFunctions,
          contains(
            isA<CatalogLintFinding>()
                .having(
                  (CatalogLintFinding f) => f.code,
                  'code',
                  'invalid_catalog_schema',
                )
                .having((CatalogLintFinding f) => f.path, 'path', '/functions'),
          ),
        );

        final List<CatalogLintFinding> v1DiscriminatorAndReturnErrors =
            lintCatalog(
              _v1Catalog(
                components: {
                  'MissingDisc': {
                    'type': 'object',
                    'properties': {
                      'text': {'type': 'string'},
                    },
                  },
                  'WrongDisc': {
                    'type': 'object',
                    'properties': {
                      'component': {'const': 'OtherName'},
                    },
                  },
                },
                functions: {
                  'missingReturn': {
                    'type': 'object',
                    'properties': {
                      '@call': {'const': 'missingReturn'},
                    },
                  },
                  'typoReturn': {
                    'type': 'object',
                    'returnType': 'bool',
                    'properties': {
                      '@call': {'const': 'typoReturn'},
                    },
                  },
                  'numericReturn': {
                    'type': 'object',
                    'returnType': 123,
                    'properties': {
                      '@call': {'const': 'numericReturn'},
                    },
                  },
                  'wrongCallConst': {
                    'type': 'object',
                    'returnType': 'string',
                    'properties': {
                      '@call': {'const': 'differentFn'},
                    },
                  },
                  'missingCallConst': {
                    'type': 'object',
                    'returnType': 'string',
                    'properties': <String, Object?>{},
                  },
                },
              ),
            );

        expect(
          v1DiscriminatorAndReturnErrors.map((CatalogLintFinding f) => f.path),
          containsAll(<String>[
            '/components/MissingDisc',
            '/components/WrongDisc/properties/component',
            '/functions/missingReturn/returnType',
            '/functions/typoReturn/returnType',
            '/functions/numericReturn/returnType',
            '/functions/wrongCallConst/properties/@call',
            '/functions/missingCallConst',
          ]),
        );

        final List<CatalogLintFinding> preV1Findings = lintCatalog(
          <String, Object?>{
            'catalogId': 'inline_fn_catalog',
            'functions': [
              {
                'name': 'checkValue',
                'returnType': 'validationResult',
                'requiresUserActivation': true,
                'allowedCallers': 'agentOnly',
                'parameters': {
                  'hyphen-param': {'type': 'string'},
                },
              },
              {'name': 'typoFn', 'returnType': 'bool'},
            ],
          },
        );
        expect(
          preV1Findings.map((CatalogLintFinding f) => f.path),
          equals(<String?>[
            '/functions/0/returnType',
            '/functions/1/returnType',
          ]),
        );
      },
    );

    test(r'handles shorthand parameter maps with $comment or $defs, v0.9 '
        r'@-prefixed functions, and broken #/components/... refs without '
        'duplicate pathless findings', () {
      final List<CatalogLintFinding> validShorthandWithDollarKeys = lintCatalog(
        _v1Catalog(
          functions: {
            'formatVal': {
              'type': 'object',
              'returnType': 'string',
              'properties': {
                '@call': {'const': 'formatVal'},
              },
              'parameters': {
                r'$comment': r'shorthand parameter map with $comment',
                r'$defs': {
                  'Helper': {'type': 'string'},
                },
                'validParam': {'type': 'string'},
              },
            },
          },
        ),
      );
      expect(validShorthandWithDollarKeys, isEmpty);

      final List<CatalogLintFinding> invalidShorthandWithComment = lintCatalog(
        _v1Catalog(
          functions: {
            'formatVal': {
              'type': 'object',
              'returnType': 'string',
              'properties': {
                '@call': {'const': 'formatVal'},
              },
              'parameters': {
                r'$comment': r'shorthand parameter map with $comment',
                'bad-param': {'type': 'string'},
              },
            },
          },
        ),
      );
      expect(
        invalidShorthandWithComment,
        contains(
          isA<CatalogLintFinding>()
              .having(
                (CatalogLintFinding f) => f.code,
                'code',
                'invalid_identifier',
              )
              .having(
                (CatalogLintFinding f) => f.path,
                'path',
                '/functions/formatVal',
              ),
        ),
      );

      final List<CatalogLintFinding> v09ReservedFunction = lintCatalog(
        <String, Object?>{
          'catalogId': 'https://example.com/v09/reserved_fn.json',
          'protocolVersion': '0.9',
          'functions': [
            {'name': '@index', 'returnType': 'number'},
          ],
        },
      );
      expect(
        v09ReservedFunction,
        contains(
          isA<CatalogLintFinding>()
              .having(
                (CatalogLintFinding f) => f.code,
                'code',
                'reserved_function_name',
              )
              .having((CatalogLintFinding f) => f.path, 'path', '/functions/0'),
        ),
      );

      final List<CatalogLintFinding> brokenComponentRef = lintCatalog(
        _v1Catalog(
          defs: {
            'BadProps': {
              'type': 'object',
              'properties': {
                'bad-prop': {'type': 'string'},
              },
            },
          },
          components: {
            'BrokenRefComp': {
              'type': 'object',
              'properties': {
                'component': {'const': 'BrokenRefComp'},
                'child': {r'$ref': '#/components/DoesNotExist'},
              },
            },
            'InlinedDefComp': {
              'type': 'object',
              'allOf': [
                {r'$ref': r'#/$defs/BadProps'},
                {
                  'type': 'object',
                  'properties': {
                    'component': {'const': 'InlinedDefComp'},
                  },
                },
              ],
            },
          },
        ),
      );
      final List<CatalogLintFinding> unresolvedFindings = [
        for (final CatalogLintFinding f in brokenComponentRef)
          if (f.code == 'unresolved_local_ref') f,
      ];
      expect(unresolvedFindings, hasLength(1));
      expect(
        unresolvedFindings.single.path,
        equals(r'/components/BrokenRefComp/properties/child/$ref'),
      );
      expect(
        brokenComponentRef,
        contains(
          isA<CatalogLintFinding>()
              .having(
                (CatalogLintFinding f) => f.code,
                'code',
                'invalid_identifier',
              )
              .having(
                (CatalogLintFinding f) => f.path,
                'path',
                '/components/InlinedDefComp/properties/bad-prop',
              ),
        ),
      );
    });
  });

  group('conformance/core/catalog.yaml from_json parity', () {
    final yamlFile = File(p.join(repoRoot, 'conformance/core/catalog.yaml'));
    final rawCases =
        _yamlToJson(loadYaml(yamlFile.readAsStringSync()))! as List<Object?>;
    final List<Map<String, Object?>> fromJsonCases = [
      for (final Object? item in rawCases)
        if (item is Map<String, Object?> && item['action'] == 'from_json') item,
    ];

    test('discovers from_json conformance cases', () {
      expect(fromJsonCases, isNotEmpty);
    });

    for (final testCase in fromJsonCases) {
      final caseName = testCase['name']! as String;
      final caseVersion = testCase['protocolVersion'] as String?;
      if (caseVersion == 'v0.8') {
        continue;
      }

      test('matches Catalog.fromJson outcome for $caseName', () {
        final Map<String, Object?> doc;
        final bool isPublishedFile;
        if (testCase['catalogPath'] case final String relPath) {
          isPublishedFile = true;
          doc = Map<String, Object?>.of(
            jsonDecode(File(p.join(repoRoot, relPath)).readAsStringSync())
                as Map<String, Object?>,
          );
        } else {
          isPublishedFile = false;
          doc = Map<String, Object?>.of(
            testCase['catalog']! as Map<String, Object?>,
          );
        }

        if (testCase['catalogId'] case final String overrideId) {
          doc['catalogId'] = overrideId;
        }
        if (!doc.containsKey('protocolVersion') && caseVersion != null) {
          doc['protocolVersion'] = caseVersion;
        }

        final List<CatalogLintFinding> findings = lintCatalog(doc);
        final List<CatalogLintFinding> errors = [
          for (final CatalogLintFinding f in findings)
            if (f.severity == LintSeverity.error) f,
        ];
        // Inline `Catalog.fromJson` test fixtures omit standalone-file
        // wire discriminators (`missing_discriminator`), and
        // `test_v10_catalog_from_json_leaf_defs` exercises non-standard root
        // `metadata.displayName` that `Catalog.fromJson` ignores.
        final List<CatalogLintFinding> coreParityErrors = isPublishedFile
            ? errors
            : [
                for (final CatalogLintFinding f in errors)
                  if (f.code != 'missing_discriminator' &&
                      !(caseName == 'test_v10_catalog_from_json_leaf_defs' &&
                          f.path == '/metadata'))
                    f,
              ];

        if (testCase.containsKey('expectError')) {
          expect(
            coreParityErrors,
            isNotEmpty,
            reason:
                'Expected non-discriminator lint error for $caseName, '
                'got: $findings',
          );
        } else if (isPublishedFile) {
          expect(findings, isEmpty, reason: 'Unexpected findings: $findings');
        } else {
          expect(
            coreParityErrors,
            isEmpty,
            reason: 'Unexpected lint errors for $caseName: $coreParityErrors',
          );
        }
      });
    }
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

          final String canonicalWarnPath = p.canonicalize(warnFile.path);
          final ({int exitCode, String stdout, String stderr}) defaultResult =
              await _captureCli(['lint', '-c', warnFile.path]);
          expect(defaultResult.exitCode, equals(0));
          expect(defaultResult.stdout, isEmpty);
          expect(
            defaultResult.stderr,
            contains(
              '$canonicalWarnPath: '
              'warning[redundant_component_common] (/components/LegacyWrapped): '
              "Component 'LegacyWrapped' wraps 'ComponentCommon'",
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
              '$canonicalWarnPath: '
              'warning[redundant_component_common] (/components/LegacyWrapped): '
              "Component 'LegacyWrapped' wraps 'ComponentCommon'",
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
          final String canonicalBadPath = p.canonicalize(badCatalogFile.path);
          final ({int exitCode, String stdout, String stderr})
          badCatalogResult = await _captureCli([
            'lint',
            '--catalog',
            badCatalogFile.path,
          ]);
          expect(badCatalogResult.exitCode, equals(1));
          expect(
            badCatalogResult.stderr,
            contains(
              '$canonicalBadPath: '
              'error[reserved_component_name] (/components/Surface): '
              "Component name 'Surface' is reserved",
            ),
          );
        } finally {
          tmpDir.deleteSync(recursive: true);
        }
      },
    );
  });
}
