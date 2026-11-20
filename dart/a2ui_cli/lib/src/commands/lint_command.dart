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

import '../analyzer/catalog_lint.dart';

/// CLI command that validates freestanding A2UI catalog JSON files against
/// deterministic protocol schema rules.
class LintCommand extends Command<int> {
  /// Output sink for usage messages.
  final StringSink outSink;

  /// Error sink for lint diagnostics and I/O errors.
  final StringSink errSink;

  @override
  final String name = 'lint';

  @override
  final String description =
      'Validates A2UI catalog JSON schemas against protocol lint rules.';

  /// Creates a [LintCommand].
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
        'fatal-warnings',
        negatable: false,
        help: 'Treat warning findings as fatal and exit with code 1.',
      );
  }

  @override
  void printUsage() {
    outSink.writeln(usage);
  }

  @override
  Future<int> run() async {
    final catalogArg = argResults!['catalog'] as String;
    final fatalWarnings = argResults!['fatal-warnings'] as bool;

    final String catalogPath = p.canonicalize(catalogArg);
    final catalogFile = io.File(catalogPath);
    if (!catalogFile.existsSync()) {
      errSink.writeln('Error: Catalog file not found at: $catalogPath');
      return 1;
    }

    final Object? decoded;
    try {
      final String rawContent = catalogFile.readAsStringSync();
      decoded = jsonDecode(rawContent);
    } on Object catch (e) {
      errSink.writeln('Error reading or parsing catalog JSON: $e');
      return 1;
    }

    if (decoded is! Map) {
      errSink.writeln(
        'Error: Catalog JSON root must be a JSON object, got '
        '${decoded.runtimeType}.',
      );
      return 1;
    }

    final catalogJson = <String, Object?>{
      for (final MapEntry<Object?, Object?> entry in decoded.entries)
        if (entry.key is String) entry.key! as String: entry.value,
    };

    var hasError = false;
    var hasWarning = false;
    for (final CatalogLintFinding finding in lintCatalog(catalogJson)) {
      errSink.writeln('$catalogPath: $finding');
      switch (finding.severity) {
        case LintSeverity.error:
          hasError = true;
        case LintSeverity.warning:
          hasWarning = true;
      }
    }

    if (hasError || (fatalWarnings && hasWarning)) {
      return 1;
    }
    return 0;
  }
}
