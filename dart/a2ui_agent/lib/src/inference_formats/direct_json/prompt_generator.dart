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

import '../../prompt/generator.dart';

/// Renders the system prompt snippet teaching a model to write A2UI messages
/// as JSON inside `<a2ui-json>` tags.
class DirectJsonPromptGenerator extends PromptGenerator {
  const DirectJsonPromptGenerator(
    super.catalogs, {
    super.examples,
    this.allowedMessages,
  });

  /// The message types the model may write, such as `createSurface`, or null
  /// for all of them.
  final List<String>? allowedMessages;

  /// Renders the output rules and the JSON schemas of the messages, the
  /// components and the functions [catalogs] declare, pruned to
  /// [allowedMessages].
  @override
  String generate() =>
      throw UnimplementedError('DirectJsonPromptGenerator.generate');
}
