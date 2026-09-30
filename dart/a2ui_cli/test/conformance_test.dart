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
import 'package:path/path.dart' as p;
import 'package:test/test.dart';
import 'package:yaml/yaml.dart';

String _findRepoRoot() {
  Directory dir = Directory.current;
  while (!File(p.join(dir.path, 'pubspec.yaml')).existsSync() ||
      !Directory(p.join(dir.path, 'conformance')).existsSync()) {
    final Directory parent = dir.parent;
    if (parent.path == dir.path) break;
    dir = parent;
  }
  return dir.path;
}

String _findDartExecutable() {
  final String resolved = Platform.resolvedExecutable;
  if (!resolved.contains('flutter_tester')) {
    return resolved;
  }
  final String flutterBinDir = p.dirname(resolved);
  final candidates = <String>[
    'dart',
    p.normalize(
      p.join(flutterBinDir, '../../../../bin/cache/dart-sdk/bin/dart'),
    ),
    p.normalize(p.join(flutterBinDir, '../../../../bin/dart')),
    p.normalize(p.join(flutterBinDir, '../../../dart-sdk/bin/dart')),
  ];
  for (final String candidate in candidates) {
    if (File(candidate).existsSync()) {
      return candidate;
    }
  }
  return 'dart';
}

void main() {
  group('A2UI CLI Conformance Test Suite (conformance/cli/codegen.yaml)', () {
    final dartBin = _findDartExecutable();
    final String repoRoot = _findRepoRoot();
    final String packageRoot =
        Directory(p.join(repoRoot, 'dart/a2ui_cli')).existsSync()
        ? p.join(repoRoot, 'dart/a2ui_cli')
        : Directory.current.path;
    final String yamlPath = p.join(repoRoot, 'conformance/cli/codegen.yaml');
    final yamlFile = File(yamlPath);

    if (!yamlFile.existsSync()) {
      fail('Conformance YAML file not found at: $yamlPath');
    }

    final String yamlContent = yamlFile.readAsStringSync();
    final testCases = loadYaml(yamlContent) as YamlList;

    for (final Object? rawTc in testCases) {
      final tc = Map<String, dynamic>.from(rawTc as YamlMap);
      final name = tc['name'] as String;
      final String description = tc['description'] as String? ?? '';

      test('[conformance] $name: $description', () {
        final Directory tmpDir = Directory.systemTemp.createTempSync(
          'a2ui-dart-conformance-',
        );
        final catalogFile = File(p.join(tmpDir.path, 'catalog.json'));
        final outDir = Directory(p.join(tmpDir.path, 'out'));
        final outFile = File(p.join(tmpDir.path, 'direct_output.py'));

        try {
          if (tc.containsKey('catalog_schema')) {
            catalogFile.writeAsStringSync(jsonEncode(tc['catalog_schema']));
          } else if (tc.containsKey('raw_catalog_content')) {
            catalogFile.writeAsStringSync(tc['raw_catalog_content'] as String);
          }

          final List<String> rawArgs = (tc['args'] as YamlList)
              .map((e) => e.toString())
              .toList();
          final List<String> args = rawArgs.map((arg) {
            return arg
                .replaceAll(r'${CATALOG_PATH}', catalogFile.path)
                .replaceAll(r'${OUT_DIR}', outDir.path)
                .replaceAll(r'${OUT_FILE}', outFile.path)
                .replaceAll(r'${REPO_ROOT}', repoRoot);
          }).toList();

          final ProcessResult result = Process.runSync(dartBin, [
            'run',
            p.join(packageRoot, 'bin/a2ui.dart'),
            ...args,
          ], workingDirectory: packageRoot);

          final expectMap = tc['expect'] as YamlMap;
          final expectedExit = expectMap['exit_code'] as int;

          expect(
            result.exitCode,
            equals(expectedExit),
            reason:
                'Exit code mismatch for test $name.\n'
                'Stdout: ${result.stdout}\nStderr: ${result.stderr}',
          );

          if (expectMap['stdout_contains'] != null) {
            for (final Object? sub
                in expectMap['stdout_contains'] as YamlList) {
              expect(
                result.stdout.toString(),
                contains(sub.toString()),
                reason: 'Stdout expected to contain "$sub"',
              );
            }
          }

          if (expectMap['stderr_contains'] != null) {
            for (final Object? sub
                in expectMap['stderr_contains'] as YamlList) {
              expect(
                result.stderr.toString(),
                contains(sub.toString()),
                reason: 'Stderr expected to contain "$sub"',
              );
            }
          }

          if (expectMap['files'] != null) {
            final filesMap = expectMap['files'] as YamlMap;
            for (final MapEntry<Object?, Object?> entry in filesMap.entries) {
              final relPath = entry.key as String;
              final fileExpect = entry.value as YamlMap;

              var targetFile = File(p.join(outDir.path, relPath));
              if (!targetFile.existsSync() &&
                  outFile.existsSync() &&
                  relPath == p.basename(outFile.path)) {
                targetFile = outFile;
              }

              expect(
                targetFile.existsSync(),
                isTrue,
                reason: 'Expected generated file at: ${targetFile.path}',
              );

              final String actualContent = targetFile
                  .readAsStringSync()
                  .replaceAll('\r\n', '\n')
                  .trim();

              if (fileExpect['exact_content'] != null) {
                final String expectedExact =
                    (fileExpect['exact_content'] as String)
                        .replaceAll('\r\n', '\n')
                        .trim();
                expect(
                  actualContent,
                  equals(expectedExact),
                  reason: 'Exact content mismatch for $relPath in $name.',
                );
              }

              if (fileExpect['content_contains'] != null) {
                for (final Object? sub
                    in fileExpect['content_contains'] as YamlList) {
                  expect(
                    actualContent,
                    contains(sub.toString()),
                    reason: 'Content of $relPath expected to contain "$sub"',
                  );
                }
              }

              if (fileExpect['content_not_contains'] != null) {
                for (final Object? sub
                    in fileExpect['content_not_contains'] as YamlList) {
                  expect(
                    actualContent,
                    isNot(contains(sub.toString())),
                    reason: 'Content of $relPath should NOT contain "$sub"',
                  );
                }
              }
            }
          }
        } finally {
          tmpDir.deleteSync(recursive: true);
        }
      });
    }
  });
}
