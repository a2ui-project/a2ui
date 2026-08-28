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

import 'package:a2ui_core/a2ui_core.dart';

import '../../prompt/generator.dart';

/// Renders system instructions for the DIRECT_JSON format.
///
/// Embeds the catalog schemas in `<a2ui_schema>` tags and asks the model for
/// payloads in `<a2ui-json>` tags.
class DirectJsonPromptGenerator<C extends ComponentApi, F extends FunctionApi>
    extends PromptGenerator<C, F> {
  /// The envelope names the model may emit; null allows every envelope of
  /// the active protocol version.
  final List<String>? allowedMessages;

  DirectJsonPromptGenerator(
    super.catalogs, {
    super.examples,
    this.allowedMessages,
  });

  @override
  String generate() {
    throw UnimplementedError('DirectJsonPromptGenerator.generate');
  }
}
