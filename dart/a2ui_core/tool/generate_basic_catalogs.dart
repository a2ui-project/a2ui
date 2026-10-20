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

/// Generates the Dart definitions of the basic catalogs from the published
/// catalog documents, so `BasicCatalog` defines its components, function
/// signatures and theme in code rather than reading a copy of the document.
///
/// Each document is read with `Catalog.fromJson`, and the resulting model is
/// written out as `ComponentApi` and `FunctionApi` definitions and a
/// `Catalog` with the document's metadata and shared definitions. The output
/// is formatted with `dart format`.
///
/// Run from the package directory after editing a published catalog:
///
/// ```sh
/// dart run tool/generate_basic_catalogs.dart
/// ```
///
/// With `--check`, nothing is written, and the tool exits with status 1 when
/// a checked-in file differs from what it would generate.
/// `test/basic_catalog_test.dart` runs the check, and also compares the
/// `toJson` of each built-in catalog with its published document.
library;

import 'dart:convert';
import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

/// A published catalog document and the Dart library generated from it.
typedef BasicCatalogSource = ({
  String source,
  String output,
  String suffix,
  String label,
  A2uiProtocolVersion version,
});

/// The documents to read, relative to the repository root, and the files to
/// write, relative to the package directory.
const List<BasicCatalogSource> sources = [
  (
    source: 'specification/v0_9/catalogs/basic/catalog.json',
    output: 'lib/src/basic_catalog/v0_9/catalog.g.dart',
    suffix: 'V0_9',
    label: 'v0.9',
    version: A2uiProtocolVersion.v0_9,
  ),
  (
    source: 'catalogs/basic/v1/catalog.json',
    output: 'lib/src/basic_catalog/v1_0/catalog.g.dart',
    suffix: 'V1_0',
    label: 'v1.0',
    version: A2uiProtocolVersion.v1_0,
  ),
];

Future<void> main(List<String> arguments) async {
  final bool check = arguments.contains('--check');
  var stale = false;
  for (final BasicCatalogSource entry in sources) {
    final document =
        jsonDecode(readSource(entry.source)) as Map<String, Object?>;
    final String generated = await format(render(entry, document));
    final file = File(entry.output);
    if (check) {
      if (!file.existsSync() || file.readAsStringSync() != generated) {
        stderr.writeln(
          '${entry.output} is out of date with ${entry.source}. Run '
          '`dart run tool/generate_basic_catalogs.dart`.',
        );
        stale = true;
      }
    } else {
      file.writeAsStringSync(generated);
      stdout.writeln('Wrote ${entry.output} from ${entry.source}.');
    }
  }
  if (stale) exitCode = 1;
}

/// Reads [source], searching upwards for the repository root so the tool runs
/// from the package directory or the workspace root.
String readSource(String source) {
  Directory dir = Directory.current;
  while (true) {
    final candidate = File('${dir.path}/$source');
    if (candidate.existsSync()) return candidate.readAsStringSync();
    final Directory parent = dir.parent;
    if (parent.path == dir.path) {
      throw StateError(
        'Could not find $source above ${Directory.current.path}.',
      );
    }
    dir = parent;
  }
}

/// The `dart` CLI executable (`Platform.resolvedExecutable` when running under
/// `dart`, or `dart` on `PATH` when running under `flutter_tester`).
String get dartExecutable {
  final String exe = Platform.resolvedExecutable;
  final String name = exe.split(Platform.pathSeparator).last;
  return (name == 'dart' || name == 'dart.exe') ? exe : 'dart';
}

/// [source] formatted by `dart format` as a library of this package.
///
/// The source is formatted in a scratch file under `.dart_tool`, so the
/// formatter applies this package's language version, as it does to the
/// checked-in file.
Future<String> format(String source) async {
  final scratch = Directory('.dart_tool/generate_basic_catalogs');
  scratch.createSync(recursive: true);
  final file = File('${scratch.path}/catalog.g.dart');
  file.writeAsStringSync(source);
  final ProcessResult result = await Process.run(dartExecutable, [
    'format',
    file.path,
  ]);
  if (result.exitCode != 0) {
    throw StateError('dart format failed:\n${result.stdout}${result.stderr}');
  }
  final String formatted = file.readAsStringSync();
  scratch.deleteSync(recursive: true);
  return formatted;
}

/// The Dart library defining the catalog [document] describes.
String render(BasicCatalogSource entry, Map<String, Object?> document) {
  final CatalogApi catalog = Catalog.fromJson(
    document,
    protocolVersion: entry.version,
  );
  final String suffix = entry.suffix;
  final String label = entry.label;
  final out = StringBuffer()
    ..writeln(_license)
    ..writeln('// Generated by tool/generate_basic_catalogs.dart from')
    ..writeln('// ${entry.source}. Do not edit by hand: edit the published')
    ..writeln('// catalog and run the tool again.')
    ..writeln()
    ..writeln('// ignore_for_file: lines_longer_than_80_chars')
    ..writeln()
    ..writeln("import 'package:json_schema_builder/json_schema_builder.dart';")
    ..writeln()
    ..writeln("import '../../core/catalog.dart';")
    ..writeln("import '../../primitives/protocol_version.dart';")
    ..writeln()
    ..writeln('/// The components of the $label basic catalog.')
    ..writeln('List<ComponentApi> basicComponents$suffix() => [');
  for (final ComponentApi component in catalog.components.values) {
    out
      ..writeln('  ComponentApi(')
      ..writeln('    name: ${_literal(component.name)},')
      ..writeln('    schema: ${_schema(component.schema)},');
    if (component.allowedParents case final List<String> parents) {
      out.writeln('    allowedParents: ${_literal(parents)},');
    }
    if (component.allowedChildren case final List<String> children) {
      out.writeln('    allowedChildren: ${_literal(children)},');
    }
    out.writeln('  ),');
  }
  out
    ..writeln('];')
    ..writeln()
    ..writeln('/// The function signatures of the $label basic catalog.')
    ..writeln('List<FunctionApi> basicFunctionSignatures$suffix() => [');
  for (final FunctionApi function in catalog.functions.values) {
    out
      ..writeln('  FunctionApi(')
      ..writeln('    name: ${_literal(function.name)},');
    if (function.description case final String description) {
      out.writeln('    description: ${_literal(description)},');
    }
    out
      ..writeln('    returnType: A2uiReturnType.${function.returnType.name},')
      ..writeln('    argumentSchema: ${_schema(function.argumentSchema)},');
    if (function.declaredAllowedCallers case final AllowedCallers callers) {
      out.writeln('    allowedCallers: AllowedCallers.${callers.name},');
    }
    if (function.declaredRequiresUserActivation case final bool activation) {
      out.writeln('    requiresUserActivation: $activation,');
    }
    out.writeln('  ),');
  }
  out
    ..writeln('];')
    ..writeln()
    ..writeln('/// The $label basic catalog, with [functions] implementing')
    ..writeln('/// [basicFunctionSignatures$suffix].')
    ..writeln(
      'Catalog<ComponentApi, F> basicCatalog$suffix'
      '<F extends FunctionApi>(',
    )
    ..writeln('  List<F> functions,')
    ..writeln(') =>')
    ..writeln('    Catalog<ComponentApi, F>(')
    ..writeln('      id: ${_literal(catalog.id)},');
  if (catalog.schemaDialect != Catalog.jsonSchemaDialect) {
    out.writeln('      schemaDialect: ${_literal(catalog.schemaDialect)},');
  }
  for (final (String name, String? value) in [
    ('schemaId', catalog.schemaId),
    ('title', catalog.title),
    ('description', catalog.description),
    ('instructions', catalog.instructions),
  ]) {
    if (value != null) out.writeln('      $name: ${_literal(value)},');
  }
  out.writeln(
    '      protocolVersion: A2uiProtocolVersion.${entry.version.name},',
  );
  if (!document.containsKey('protocolVersion')) {
    out.writeln('      declaresProtocolVersion: false,');
  }
  out
    ..writeln('      components: basicComponents$suffix(),')
    ..writeln('      functions: functions,');
  if (catalog.themeSchema case final Schema theme) {
    out.writeln('      themeSchema: ${_schema(theme)},');
  }
  if (catalog.definitions.isNotEmpty) {
    out.writeln('      definitions: const ${_literal(catalog.definitions)},');
  }
  out.writeln('    );');
  return out.toString();
}

/// [schema] as a Dart expression.
String _schema(Schema schema) =>
    'Schema.fromMap(const ${_literal(schema.value)})';

/// The JSON [value] as a Dart literal, with the types `jsonDecode` gives.
String _literal(Object? value) => switch (value) {
      null => 'null',
      bool() || num() => '$value',
      final String string => _string(string),
      final List<Object?> list => list.isEmpty
          ? '<Object?>[]'
          : '<Object?>[${list.map(_literal).join(', ')},]',
      final Map<Object?, Object?> map => map.isEmpty
          ? '<String, Object?>{}'
          : '<String, Object?>{${_mapEntries(map)},}',
      _ => throw ArgumentError.value(value, 'value', 'is not JSON'),
    };

String _mapEntries(Map<Object?, Object?> map) => [
      for (final MapEntry<Object?, Object?> entry in map.entries)
        '${_string(entry.key! as String)}: ${_literal(entry.value)}',
    ].join(', ');

/// [value] as a Dart string literal: single-quoted, or double-quoted when it
/// holds a single quote and no double quote, and raw when that spares
/// escaping a `$`.
String _string(String value) {
  final quote = value.contains("'") && !value.contains('"') ? '"' : "'";
  if (value.contains(r'$') &&
      !value.contains(quote) &&
      !value.contains(r'\') &&
      !value.runes.any((int rune) => rune < 0x20)) {
    return 'r$quote$value$quote';
  }
  final escaped = StringBuffer();
  for (final int rune in value.runes) {
    final char = String.fromCharCode(rune);
    escaped.write(switch (char) {
      r'\' => r'\\',
      r'$' => r'\$',
      '\n' => r'\n',
      '\r' => r'\r',
      '\t' => r'\t',
      _ when char == quote => '\\$quote',
      _ when rune < 0x20 => '\\u{${rune.toRadixString(16)}}',
      _ => char,
    });
  }
  return '$quote$escaped$quote';
}

const String _license = '''
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
''';
