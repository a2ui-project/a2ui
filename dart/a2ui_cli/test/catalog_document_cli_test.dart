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
import 'package:a2ui_core/a2ui_core.dart' show Catalog, CatalogApi;
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

void main() {
  final String repoRoot = _findRepoRoot();

  group('a2ui codegen on Catalog Documents (formatVersion: 1.0)', () {
    test('basic v1.0 Catalog Document generates byte-for-byte identical Python '
        'to checked-in basic.py golden', () async {
      final legacyJson = jsonDecode(
        File(p.join(repoRoot, 'catalogs/basic/v1/catalog.json'))
            .readAsStringSync(),
      ) as Map<String, Object?>;
      final CatalogApi parsed = Catalog.fromJson(legacyJson);
      final Map<String, Object?> catalogDoc = parsed.toDocument();

      final Directory tmpDir = Directory.systemTemp.createTempSync(
        'a2ui-cli-doc-',
      );
      addTearDown(() => tmpDir.deleteSync(recursive: true));

      final docFile = File(p.join(tmpDir.path, 'basic_v1.catalog.json'))
        ..writeAsStringSync(jsonEncode(catalogDoc));
      final String outPy = p.join(tmpDir.path, 'basic.py');

      final lintOut = StringBuffer();
      final lintErr = StringBuffer();
      final int lintCode = await runCli(
        ['lint', '--fatal-warnings', '-c', docFile.path],
        stdout: lintOut,
        stderr: lintErr,
      );
      expect(lintCode, 0, reason: lintErr.toString());
      expect(lintErr.toString(), isEmpty);

      final genOut = StringBuffer();
      final genErr = StringBuffer();
      final int genCode = await runCli(
        ['codegen', '-c', docFile.path, '-o', outPy],
        stdout: genOut,
        stderr: genErr,
      );
      expect(genCode, 0, reason: genErr.toString());

      final String generated = File(outPy).readAsStringSync();
      final String golden = File(
        p.join(
          repoRoot,
          'python/a2ui_agent/src/a2ui/builder/v1_0/catalogs/basic.py',
        ),
      ).readAsStringSync();
      expect(generated, equals(golden));
    });

    test('fixture Catalog Documents produce byte-for-byte identical Python goldens', () {
      final String fixturesDir = p.join(
        repoRoot,
        'dart/a2ui_cli/test/fixtures',
      );
      final cases = <String, String>{
        'minimal.json': 'minimal.py',
        'empty_comp.json': 'empty_comp.py',
        'enums.json': 'enums.py',
        'keywords.json': 'keywords.py',
      };
      for (final MapEntry<String, String> entry in cases.entries) {
        final legacyJson = jsonDecode(
          File(p.join(fixturesDir, 'catalogs', entry.key)).readAsStringSync(),
        ) as Map<String, Object?>;
        final Map<String, Object?> doc = Catalog.fromJson(legacyJson)
            .toDocument();
        // Preserve v0.9.1 when legacy fixture omitted protocolVersion.
        doc.putIfAbsent('protocolVersion', () => '0.9.1');
        final catalog = CodegenCatalog.fromJson(doc);
        final AnalysedCatalog analysed = CatalogAnalyzer.analyzeCodegen(
          catalog,
        );
        final String generated = PythonEmitter(analysed).generate().trim();
        final String expected = File(
          p.join(fixturesDir, 'goldens/python', entry.value),
        ).readAsStringSync().replaceAll('\r\n', '\n').trim();
        expect(
          generated,
          equals(expected),
          reason: 'Catalog Document mismatch for ${entry.key}',
        );
      }
    });
  });

  group('a2ui lint on Catalog Documents (formatVersion: 1.0)', () {
    test('accepts valid Catalog Document with Unicode UAX #31 and '
        'allowedParents: [Surface]', () {
      final List<CatalogLintFinding> findings = lintCatalog({
        'formatVersion': '1.0',
        'catalogId': 'urn:a2ui:lint-valid',
        'metadata': {
          'extensions': {'αβ_ext': 1},
        },
        'types': {
          'Weight': {'type': 'number', 'min': 0},
        },
        'components': [
          {
            'name': 'Κάρτα',
            'allowedParents': ['Surface'],
            'parameters': [
              {'name': 'τίτλος', 'type': 'string', 'dynamic': true},
              {'name': 'weight', 'type': 'ref', 'ref': 'Weight'},
            ],
          },
        ],
        'functions': [
          {
            'name': 'checkRange',
            'returnType': 'validationResult',
            'parameters': [
              {'name': 'min', 'type': 'number'},
              {'name': 'max', 'type': 'number'},
            ],
            'atLeastOneOf': [
              ['min', 'max'],
            ],
          },
        ],
      });
      expect(findings, isEmpty);
    });

    test(
      'reports all semantic errors with accurate codes and JSON Pointers',
      () {
        final List<CatalogLintFinding> findings = lintCatalog({
          'formatVersion': '1.0',
          'catalogId': 'urn:a2ui:lint-bad',
          'unknownRoot': true,
          'types': {
            'BadType': {'type': 'child'},
          },
          'components': [
            {'name': 'Surface'},
            {
              'name': 'Card',
              'allowedParents': ['MissingParent'],
              'allowedChildren': ['Surface'],
              'parameters': [
                {'name': 'dup', 'type': 'string'},
                {'name': 'dup', 'type': 'ref', 'ref': 'NoSuchType'},
                {'name': '123bad', 'type': 'boolean'},
              ],
              'atLeastOneOf': [
                ['dup', 'missingParam'],
              ],
            },
            {'name': 'Card'},
          ],
          'functions': [
            {'name': '@reserved', 'returnType': 'boolean'},
            {
              'name': 'dangerous',
              'returnType': 'void',
              'requiresUserActivation': true,
              'allowedCallers': 'rendererOrAgent',
              'parameters': [
                {'name': 'slot', 'type': 'action'},
              ],
            },
          ],
        });

        final Set<String> codes = findings.map((f) => f.code).toSet();
        expect(
          codes,
          containsAll([
            'invalid_catalog_schema',
            'reserved_component_name',
            'reserved_function_name',
            'invalid_identifier',
            'duplicate_name',
            'unresolved_local_ref',
            'user_activation_allows_agent',
            'invalid_constraint',
          ]),
        );
      },
    );
  });
}
