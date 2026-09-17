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

// ignore_for_file: specify_nonobvious_local_variable_types

import 'dart:io';
import 'package:build/build.dart';

Builder schemaBuilder(BuilderOptions options) => SchemaBuilder();

class SchemaBuilder implements Builder {
  @override
  Map<String, List<String>> get buildExtensions => const {
    'pubspec.yaml': ['lib/src/primitives/embedded_schemas.g.dart'],
  };

  @override
  Future<void> build(BuildStep buildStep) async {
    // Find the repository root by traversing upwards until we find the
    // specification directory.
    const specPath = 'specification/v0_9/json';
    Directory dir = Directory.current;
    while (!Directory('${dir.path}/$specPath').existsSync()) {
      if (dir.path == dir.parent.path) {
        throw StateError(
          'Could not find a repository root containing $specPath starting '
          'from ${Directory.current.path}. Run the build from within the a2ui '
          'repository.',
        );
      }
      dir = dir.parent;
    }
    final sourceDir = Directory('${dir.path}/$specPath');

    final files = {
      'common_types.json': 'commonTypesSchemaJson',
      'server_to_client.json': 'serverToClientSchemaJson',
    };

    final buffer = StringBuffer();
    buffer.write(_license);
    buffer.writeln();
    buffer.writeln('// GENERATED FILE. DO NOT EDIT MANUALLY.');
    buffer.writeln('// To regenerate, run: dart run build_runner build');
    buffer.writeln();

    for (final entry in files.entries) {
      final filename = entry.key;
      final variableName = entry.value;
      final sourceFile = File('${sourceDir.path}/$filename');

      if (!sourceFile.existsSync()) {
        throw StateError('Source file ${sourceFile.path} not found.');
      }

      final content = sourceFile.readAsStringSync().trim();
      buffer.writeln('/// Embedded schema contents of \'$filename\'.');
      buffer.writeln('const String $variableName = r\'\'\'');
      buffer.writeln(content);
      buffer.writeln('\'\'\';');
      buffer.writeln();
    }

    final outputId = AssetId(
      buildStep.inputId.package,
      'lib/src/primitives/embedded_schemas.g.dart',
    );
    await buildStep.writeAsString(outputId, buffer.toString());
  }
}

const String _license = r'''
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
