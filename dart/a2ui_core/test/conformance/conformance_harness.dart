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

import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:yaml/yaml.dart';

/// Resolves a case's path against the `conformance/` directory, for example
/// `../specification/v0_9_1/catalogs/basic/catalog.json`.
String resolveConformancePath(String relativePath) =>
    p.normalize(p.join(_conformanceRoot(), relativePath));

String _conformanceRoot() {
  // Walk up, so the harness works from the package directory and the
  // workspace root.
  Directory dir = Directory.current;
  while (true) {
    final candidate = Directory(p.join(dir.path, 'conformance'));
    if (candidate.existsSync() &&
        File(p.join(candidate.path, 'conformance_schema.json')).existsSync()) {
      return candidate.path;
    }
    final Directory parent = dir.parent;
    if (parent.path == dir.path) {
      throw StateError(
        'Could not locate the conformance/ directory above '
        '${Directory.current.path}.',
      );
    }
    dir = parent;
  }
}

/// Loads a conformance suite, for example `core/data_model.yaml`.
List<Map<String, Object?>> loadConformanceSuite(String suite) {
  final file = File(resolveConformancePath(suite));
  if (!file.existsSync()) {
    throw StateError('Conformance suite not found: ${file.path}');
  }
  final Object? parsed = loadYaml(file.readAsStringSync());
  if (parsed is! YamlList) {
    throw StateError('Conformance suite $suite must be a list of cases.');
  }
  return [
    for (final Object? node in parsed)
      normalizeYaml(node)! as Map<String, Object?>,
  ];
}

/// Converts YAML nodes into plain Dart maps, lists and scalars, which
/// `YamlMap` and `YamlList` are not.
Object? normalizeYaml(Object? node) {
  if (node is YamlMap || node is Map) {
    return <String, Object?>{
      for (final MapEntry<Object?, Object?> entry
          in (node as Map).cast<Object?, Object?>().entries)
        entry.key.toString(): normalizeYaml(entry.value),
    };
  }
  if (node is YamlList || node is List) {
    return <Object?>[
      for (final Object? item in node as List) normalizeYaml(item),
    ];
  }
  return node;
}

/// The protocol version a case targets, or null when it declares none.
String? caseVersion(Map<String, Object?> testCase) {
  final Object? catalog = testCase['catalog'];
  if (catalog is Map<String, Object?>) return catalog['version'] as String?;
  return null;
}
