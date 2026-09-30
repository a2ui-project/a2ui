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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:yaml/yaml.dart';

/// Reads the cases of the suite at [path], relative to `conformance/`, as
/// plain Dart maps.
List<Map<String, Object?>> loadSuite(String path) => [
  for (final Object? node
      in loadYaml(File('$_root/$path').readAsStringSync()) as YamlList)
    _plain(node)! as Map<String, Object?>,
];

/// The catalog a suite names by [entry]: a path relative to `conformance/`,
/// or a map with the path under `catalog` and the transformers registered
/// with it under `transformers`.
CatalogConfig catalogConfig(Object? entry) => switch (entry) {
  final String path => CatalogConfig(_catalog(path)),
  {'catalog': final String path} => CatalogConfig(
    _catalog(path),
    transformers: [
      for (final Object? transformer
          in (entry as Map)['transformers'] as List<Object?>? ?? const [])
        _transformer(transformer),
    ],
  ),
  _ => throw ArgumentError.value(entry, 'entry', 'Not a catalog entry'),
};

CatalogTransformer _transformer(Object? spec) => switch (spec) {
  {'component_pruning': final List<Object?> names} =>
    ComponentPruningTransformer(names.cast<String>()),
  {'function_pruning': final List<Object?> names} => FunctionPruningTransformer(
    names.cast<String>(),
  ),
  _ => throw ArgumentError.value(spec, 'spec', 'Unknown transformer'),
};

final Map<String, SchemaCatalog> _catalogCache = {};

SchemaCatalog _catalog(String path) => _catalogCache.putIfAbsent(
  path,
  () => Catalog.fromJson(
    jsonDecode(File('$_root/$path').readAsStringSync()) as Map<String, Object?>,
  ),
);

/// Converts YAML nodes into plain Dart maps, lists and scalars.
Object? _plain(Object? node) => switch (node) {
  YamlMap() => {
    for (final MapEntry<Object?, Object?> entry in node.entries)
      entry.key.toString(): _plain(entry.value),
  },
  YamlList() => node.map(_plain).toList(),
  _ => node,
};

/// The `conformance/` directory, found by walking up from the working
/// directory.
final String _root = () {
  Directory dir = Directory.current;
  while (!File(
    '${dir.path}/conformance/conformance_schema.json',
  ).existsSync()) {
    if (dir.parent.path == dir.path) {
      throw StateError('No conformance/ directory above ${Directory.current}.');
    }
    dir = dir.parent;
  }
  return '${dir.path}/conformance';
}();
