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
import 'dart:io' as io;

import 'package:a2ui_core/a2ui_core.dart';
import 'package:args/command_runner.dart';
import 'package:path/path.dart' as p;

import '../analyzer/catalog_analyzer.dart';
import '../analyzer/types.dart';
import '../emitters/python/python_emitter.dart';

class CodegenCommand extends Command<int> {
  final StringSink outSink;
  final StringSink errSink;

  @override
  final String name = 'codegen';

  @override
  final String description =
      'Generates typesafe A2UI component libraries from catalog schemas.';

  CodegenCommand({StringSink? outSink, StringSink? errSink})
    : outSink = outSink ?? io.stdout,
      errSink = errSink ?? io.stderr {
    argParser
      ..addOption(
        'catalog',
        abbr: 'c',
        mandatory: true,
        help: 'Path to the catalog JSON Schema file.',
      )
      ..addOption(
        'out',
        abbr: 'o',
        mandatory: true,
        help: 'Output directory or file where generated code will be written.',
      )
      ..addOption(
        'lang',
        defaultsTo: 'python',
        help: 'Target language for code generation (python).',
      )
      ..addOption(
        'base-import',
        help: 'Base module from which ComponentBuilderNode, etc. are imported.',
      )
      ..addOption(
        'catalog-name',
        help: 'Override the inferred catalog module name.',
      );
  }

  @override
  void printUsage() {
    outSink.writeln(usage);
  }

  @override
  Future<int> run() async {
    final catalogArg = argResults!['catalog'] as String;
    final outArg = argResults!['out'] as String;

    final String catalogPath = p.canonicalize(catalogArg);
    final catalogFile = io.File(catalogPath);
    if (!catalogFile.existsSync()) {
      errSink.writeln('Error: Catalog file not found at: $catalogPath');
      return 1;
    }

    Map<String, dynamic> catalogJson;
    try {
      final String rawContent = catalogFile.readAsStringSync();
      catalogJson = jsonDecode(rawContent) as Map<String, dynamic>;
    } catch (e) {
      errSink.writeln('Error reading or parsing catalog JSON: $e');
      return 1;
    }

    final String lang = argResults?['lang'] as String? ?? 'python';
    if (lang != 'python') {
      errSink.writeln('Unsupported target language: $lang');
      return 1;
    }

    final CatalogApi catalog = Catalog.fromJson(catalogJson);
    final String specVersion = catalog.protocolVersion ?? 'v0.9.1';
    final String cleanVersion = specVersion.startsWith('v')
        ? specVersion.substring(1)
        : specVersion;
    final bool isV09 = cleanVersion == '0.9' || cleanVersion == '0.9.1';
    final bool isV10 = cleanVersion == '1.0' ||
        cleanVersion == '1.0.0' ||
        cleanVersion.startsWith('1.0.') ||
        cleanVersion.startsWith('1.0.0-');
    if (!isV09 && !isV10) {
      errSink.writeln(
        "Unsupported catalog protocol version '$specVersion'. Code generation is "
        'currently supported for protocol versions 0.9, 0.9.1, and 1.0 catalogs.',
      );
      return 1;
    }

    final AnalysedCatalog analysed = CatalogAnalyzer.analyze(catalog);

    final String outPath = p.canonicalize(outArg);
    final baseImport = argResults?['base-import'] as String?;
    final catalogName = argResults?['catalog-name'] as String?;

    final emitter = PythonEmitter(
      analysed,
      baseImport: baseImport,
      catalogName: catalogName,
    );

    final List<String> written = emitter.emit(outPath);
    outSink.writeln('Successfully generated ${written.length} file(s):');
    for (final f in written) {
      outSink.writeln('  - $f');
    }
    return 0;
  }
}
