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
import 'package:args/command_runner.dart';
import 'package:path/path.dart' as p;
import '../analyzer/catalog_analyzer.dart';
import '../emitters/python/python_emitter.dart';

class CodegenCommand extends Command<int> {
  @override
  final String name = 'codegen';

  @override
  final String description =
      'Generates typesafe A2UI component libraries from catalog schemas.';

  CodegenCommand() {
    argParser
      ..addOption(
        'catalog',
        abbr: 'c',
        help: 'Path to the catalog JSON Schema file.',
      )
      ..addOption(
        'out',
        abbr: 'o',
        help: 'Output directory or file where generated code will be written.',
      )
      ..addOption(
        'lang',
        defaultsTo: 'python',
        help: 'Target language for code generation (python).',
      )
      ..addOption(
        'base-import',
        defaultsTo: 'a2ui.builder.base',
        help: 'Base module from which ComponentBuilderNode, etc. are imported.',
      )
      ..addOption(
        'catalog-name',
        help: 'Override the inferred catalog module name.',
      );
  }

  @override
  Future<int> run() async {
    final catalogArg = argResults?['catalog'] as String?;
    if (catalogArg == null || catalogArg.isEmpty) {
      stderr.writeln(
        "error: required option '-c, --catalog <path>' not specified",
      );
      return 1;
    }

    final outArg = argResults?['out'] as String?;
    if (outArg == null || outArg.isEmpty) {
      stderr.writeln("error: required option '-o, --out <dir>' not specified");
      return 1;
    }

    final catalogPath = p.canonicalize(catalogArg);
    final catalogFile = File(catalogPath);
    if (!catalogFile.existsSync()) {
      stderr.writeln('Error: Catalog file not found at: $catalogPath');
      return 1;
    }

    Map<String, dynamic> catalogJson;
    try {
      final rawContent = catalogFile.readAsStringSync();
      catalogJson = jsonDecode(rawContent) as Map<String, dynamic>;
    } catch (e) {
      stderr.writeln('Error reading or parsing catalog JSON: $e');
      return 1;
    }

    final lang = argResults?['lang'] as String? ?? 'python';
    if (lang != 'python') {
      stderr.writeln('Unsupported target language: $lang');
      return 1;
    }

    final catalog = Catalog.fromJson(catalogJson);
    final analysed = CatalogAnalyzer.analyze(catalog);

    final outPath = p.canonicalize(outArg);
    final baseImport = argResults?['base-import'] as String?;
    final catalogName = argResults?['catalog-name'] as String?;

    final emitter = PythonEmitter(
      analysed,
      baseImport: baseImport,
      catalogName: catalogName,
    );

    final written = emitter.emit(outPath);
    stdout.writeln('Successfully generated ${written.length} file(s):');
    for (final f in written) {
      stdout.writeln('  - $f');
    }
    return 0;
  }
}
