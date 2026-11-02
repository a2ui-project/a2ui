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

import 'package:args/command_runner.dart';
import 'package:path/path.dart' as p;

import '../analyzer/accessibility_lint.dart';
import '../analyzer/catalog_analyzer.dart';
import '../analyzer/catalog_reader.dart';
import '../analyzer/types.dart';

/// CLI command that checks catalog components for declared text-bearing
/// accessibility label properties.
class LintCommand extends Command<int> {
  final StringSink outSink;
  final StringSink errSink;

  @override
  final String name = 'lint';

  @override
  final String description =
      'Checks interactive catalog components for text-bearing label properties.';

  LintCommand({StringSink? outSink, StringSink? errSink})
    : outSink = outSink ?? io.stdout,
      errSink = errSink ?? io.stderr {
    argParser
      ..addOption(
        'catalog',
        abbr: 'c',
        mandatory: true,
        help: 'Path to the catalog JSON Schema file.',
      )
      ..addFlag(
        'strict',
        negatable: false,
        help: 'Require text-bearing label properties to be listed in required.',
      )
      ..addMultiOption(
        'ignore',
        help: 'Component name to acknowledge and ignore when linting.',
      );
  }

  @override
  void printUsage() {
    outSink.writeln(usage);
  }

  @override
  Future<int> run() async {
    final catalogArg = argResults!['catalog'] as String;
    final strict = argResults!['strict'] as bool;
    final List<String> ignoredNames =
        (argResults!['ignore'] as List<String>).toSet().toList()..sort();
    final Set<String> ignoredSet = ignoredNames.toSet();

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

    final AnalysedCatalog analysed;
    try {
      analysed = CatalogAnalyzer.analyzeCodegen(
        CodegenCatalog.fromJson(catalogJson),
      );
    } catch (e) {
      errSink.writeln('Error analyzing catalog: $e');
      return 1;
    }

    final List<LabelLintFinding> findings = lintAccessibilityLabels(
      analysed,
      strict: strict,
    );

    final matchedIgnores = <String>{};
    var unignoredCount = 0;

    for (final finding in findings) {
      if (ignoredSet.contains(finding.component)) {
        matchedIgnores.add(finding.component);
        outSink.writeln('ignored: ${finding.component}');
      } else {
        unignoredCount++;
        errSink.writeln(
          'warning: ${finding.component}: accepts ${finding.reason} but '
          'declares no text-bearing property',
        );
      }
    }

    for (final ignoredName in ignoredNames) {
      if (!matchedIgnores.contains(ignoredName)) {
        errSink.writeln(
          'warning: $ignoredName: listed in --ignore but has no finding',
        );
      }
    }

    return unignoredCount > 0 ? 1 : 0;
  }
}
