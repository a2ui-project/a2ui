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

import 'package:flutter/services.dart';

/// One of the v0.9 basic catalog examples in the specification.
class Example {
  const Example({
    required this.fileName,
    required this.name,
    required this.description,
    required this.json,
  });

  /// The example's file name, such as `00_simple-text.json`.
  final String fileName;

  /// The example's `name`.
  final String name;

  /// The example's `description`.
  final String description;

  /// The example's file.
  final String json;

  /// The example's messages, in order.
  List<Map<String, Object?>> get messages => [
    for (final Object? message
        in (jsonDecode(json) as Map<String, Object?>)['messages']! as List)
      message! as Map<String, Object?>,
  ];
}

/// The asset directory that holds the examples, a link to the
/// specification's v0.9 basic catalog examples.
const String examplesDirectory = 'assets/examples/';

/// Every example in [examplesDirectory] of [bundle], sorted by file name.
Future<List<Example>> loadExamples(AssetBundle bundle) async {
  final AssetManifest manifest = await AssetManifest.loadFromAssetBundle(
    bundle,
  );
  final List<String> paths =
      manifest
          .listAssets()
          .where((p) => p.startsWith(examplesDirectory) && p.endsWith('.json'))
          .toList()
        ..sort();
  return [
    for (final String path in paths)
      _example(
        path.substring(examplesDirectory.length),
        await bundle.loadString(path),
      ),
  ];
}

Example _example(String fileName, String json) {
  final document = jsonDecode(json) as Map<String, Object?>;
  return Example(
    fileName: fileName,
    name: document['name']! as String,
    description: document['description']! as String,
    json: json,
  );
}
