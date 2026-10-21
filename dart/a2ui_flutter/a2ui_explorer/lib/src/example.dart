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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:flutter/services.dart';

/// One of the basic catalog examples of a protocol version.
class Example {
  const Example({
    required this.version,
    required this.fileName,
    required this.name,
    required this.description,
    required this.json,
  });

  /// The protocol version of the example's messages.
  final A2uiProtocolVersion version;

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

/// The asset directory of each protocol version's examples, a link to that
/// version's basic catalog examples.
const Map<A2uiProtocolVersion, String> examplesDirectories = {
  A2uiProtocolVersion.v0_9: 'assets/examples/v0_9/',
  A2uiProtocolVersion.v1_0: 'assets/examples/v1_0/',
};

/// Every example in [examplesDirectories] of [bundle], by version in the
/// order of [examplesDirectories], then by file name.
Future<List<Example>> loadExamples(AssetBundle bundle) async {
  final AssetManifest manifest = await AssetManifest.loadFromAssetBundle(
    bundle,
  );
  return [
    for (final MapEntry(key: version, value: directory)
        in examplesDirectories.entries)
      for (final String path
          in manifest
              .listAssets()
              .where((p) => p.startsWith(directory) && p.endsWith('.json'))
              .toList()
            ..sort())
        _example(
          version,
          path.substring(directory.length),
          await bundle.loadString(path),
        ),
  ];
}

Example _example(A2uiProtocolVersion version, String fileName, String json) {
  final document = jsonDecode(json) as Map<String, Object?>;
  return Example(
    version: version,
    fileName: fileName,
    name: document['name']! as String,
    description: document['description']! as String,
    json: json,
  );
}
