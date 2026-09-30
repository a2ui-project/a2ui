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

import 'dart:async';
import 'dart:io';

import 'package:a2ui_cli/src/cli.dart';
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

/// Helper that runs [runCli] while capturing [stdout] and [stderr].
Future<({int exitCode, String stdout, String stderr})> _captureCli(
  List<String> args,
) async {
  final stdoutBuf = StringBuffer();
  final stderrBuf = StringBuffer();

  final spec = ZoneSpecification(
    print: (self, parent, zone, line) => stdoutBuf.writeln(line),
  );

  final int exitCode = await runZoned(
    () => runCli(args),
    zoneSpecification: spec,
    zoneValues: {#stdout: stdoutBuf, #stderr: stderrBuf},
  );

  return (
    exitCode: exitCode,
    stdout: stdoutBuf.toString(),
    stderr: stderrBuf.toString(),
  );
}

void main() {
  final String repoRoot = _findRepoRoot();
  final String minimalCatalogPath = p.join(
    repoRoot,
    'dart/a2ui_cli/test/fixtures/catalogs/minimal.json',
  );

  group('A2UI CLI Command & Option Parsing (cli_test.dart)', () {
    test('displays top-level help with --help and -h', () async {
      for (final flag in ['--help', '-h']) {
        final ({int exitCode, String stdout, String stderr}) result =
            await _captureCli([flag]);
        expect(result.exitCode, equals(0));
      }
    });

    test('displays codegen command help with codegen --help', () async {
      final ({int exitCode, String stdout, String stderr}) result =
          await _captureCli(['codegen', '--help']);
      expect(result.exitCode, equals(0));
    });

    test('outputs current version with --version and -v', () async {
      for (final flag in ['--version', '-v']) {
        final ({int exitCode, String stdout, String stderr}) result =
            await _captureCli([flag]);
        expect(result.exitCode, equals(0));
      }
    });

    test('generates code successfully using long flags', () async {
      final Directory tmpDir = Directory.systemTemp.createTempSync(
        'cli-test-long-',
      );
      try {
        final int exitCode = await runCli([
          'codegen',
          '--catalog',
          minimalCatalogPath,
          '--out',
          tmpDir.path,
        ]);
        expect(exitCode, equals(0));
        expect(
          File(p.join(tmpDir.path, 'minimal_catalog.py')).existsSync(),
          isTrue,
        );
      } finally {
        tmpDir.deleteSync(recursive: true);
      }
    });

    test('generates code successfully using short flags (-c and -o)', () async {
      final Directory tmpDir = Directory.systemTemp.createTempSync(
        'cli-test-short-',
      );
      try {
        final int exitCode = await runCli([
          'codegen',
          '-c',
          minimalCatalogPath,
          '-o',
          tmpDir.path,
        ]);
        expect(exitCode, equals(0));
        expect(
          File(p.join(tmpDir.path, 'minimal_catalog.py')).existsSync(),
          isTrue,
        );
      } finally {
        tmpDir.deleteSync(recursive: true);
      }
    });

    test('supports GNU-style --option=value syntax', () async {
      final Directory tmpDir = Directory.systemTemp.createTempSync(
        'cli-test-gnu-',
      );
      try {
        final int exitCode = await runCli([
          'codegen',
          '--catalog=$minimalCatalogPath',
          '--out=${tmpDir.path}',
          '--lang=python',
        ]);
        expect(exitCode, equals(0));
        expect(
          File(p.join(tmpDir.path, 'minimal_catalog.py')).existsSync(),
          isTrue,
        );
      } finally {
        tmpDir.deleteSync(recursive: true);
      }
    });

    test('supports writing directly to an output file', () async {
      final Directory tmpDir = Directory.systemTemp.createTempSync(
        'cli-test-file-',
      );
      try {
        final outFile = File(p.join(tmpDir.path, 'custom_output.py'));
        final int exitCode = await runCli([
          'codegen',
          '-c',
          minimalCatalogPath,
          '-o',
          outFile.path,
        ]);
        expect(exitCode, equals(0));
        expect(outFile.existsSync(), isTrue);
        expect(
          outFile.readAsStringSync(),
          contains('class Heading(ComponentBuilderNode):'),
        );
      } finally {
        tmpDir.deleteSync(recursive: true);
      }
    });

    test('fails with exit code 1 when required --catalog is missing', () async {
      final Directory tmpDir = Directory.systemTemp.createTempSync(
        'cli-test-nocat-',
      );
      try {
        final int exitCode = await runCli(['codegen', '--out', tmpDir.path]);
        expect(exitCode, equals(1));
      } finally {
        tmpDir.deleteSync(recursive: true);
      }
    });

    test('fails with exit code 1 when required --out is missing', () async {
      final int exitCode = await runCli([
        'codegen',
        '--catalog',
        minimalCatalogPath,
      ]);
      expect(exitCode, equals(1));
    });

    test('fails with exit code 1 when catalog file does not exist', () async {
      final Directory tmpDir = Directory.systemTemp.createTempSync(
        'cli-test-nonexist-',
      );
      try {
        final int exitCode = await runCli([
          'codegen',
          '-c',
          'nonexistent_file_path.json',
          '-o',
          tmpDir.path,
        ]);
        expect(exitCode, equals(1));
      } finally {
        tmpDir.deleteSync(recursive: true);
      }
    });

    test('fails with exit code 1 on malformed JSON catalog', () async {
      final Directory tmpDir = Directory.systemTemp.createTempSync(
        'cli-test-badjson-',
      );
      try {
        final badJsonFile = File(p.join(tmpDir.path, 'malformed.json'))
          ..writeAsStringSync('{ invalid_json: [');
        final int exitCode = await runCli([
          'codegen',
          '-c',
          badJsonFile.path,
          '-o',
          tmpDir.path,
        ]);
        expect(exitCode, equals(1));
      } finally {
        tmpDir.deleteSync(recursive: true);
      }
    });

    test('fails with exit code 1 on unsupported target language', () async {
      final Directory tmpDir = Directory.systemTemp.createTempSync(
        'cli-test-lang-',
      );
      try {
        final int exitCode = await runCli([
          'codegen',
          '-c',
          minimalCatalogPath,
          '-o',
          tmpDir.path,
          '--lang',
          'dart',
        ]);
        expect(exitCode, equals(1));
      } finally {
        tmpDir.deleteSync(recursive: true);
      }
    });

    test('fails with exit code 1 on unknown option', () async {
      final Directory tmpDir = Directory.systemTemp.createTempSync(
        'cli-test-unknown-',
      );
      try {
        final int exitCode = await runCli([
          'codegen',
          '-c',
          minimalCatalogPath,
          '-o',
          tmpDir.path,
          '--unknown-flag',
        ]);
        expect(exitCode, equals(1));
      } finally {
        tmpDir.deleteSync(recursive: true);
      }
    });
  });
}
