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

import '../../inference_format.dart';
import 'parser.dart';
import 'prompt_generator.dart';

/// The direct JSON format: A2UI messages written as JSON inside `<a2ui-json>`
/// tags, which can be read while the response streams.
class DirectJsonFormatFactory extends InferenceFormatFactory {
  const DirectJsonFormatFactory();

  @override
  InferenceFormat createFormat(
    List<SchemaCatalog> catalogs, {
    List<List<AgentToRendererMessage>> examples = const [],
  }) => DirectJsonFormat(catalogs, examples: examples);
}

/// The direct JSON format bound to the catalogs of one request.
class DirectJsonFormat extends InferenceFormat {
  /// [allowedMessages] names the message types the model may write, such as
  /// `createSurface`; null allows all of them.
  DirectJsonFormat(
    List<SchemaCatalog> catalogs, {
    List<List<AgentToRendererMessage>> examples = const [],
    List<String>? allowedMessages,
  }) : promptGenerator = DirectJsonPromptGenerator(
         List.unmodifiable(catalogs),
         examples: List.unmodifiable(examples),
         allowedMessages: allowedMessages,
       );

  @override
  final DirectJsonPromptGenerator promptGenerator;

  @override
  DirectJsonParser createParser() => DirectJsonParser(promptGenerator.catalogs);
}
