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

  /// The example's file, minified.
  final String json;

  /// The example's messages, in order.
  List<Map<String, Object?>> get messages => [
    for (final Object? message
        in (jsonDecode(json) as Map<String, Object?>)['messages']! as List)
      message! as Map<String, Object?>,
  ];
}
